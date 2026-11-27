/**
 * BACKTEST — nifty_sd_fib_buy_above_st  (NIFTY_SD_FIB_BUY_ABOVE_ST)
 *
 * NIFTY ATM CE + ATM PE of the day, each traded on its own, one fixed strike all day.
 *   - option volatility (sheet method): the last 361 completed NIFTY daily closes before the day -> 360 values of
 *     LN(older close / newer close); daily volatility = average + 1 x sample standard deviation; option volatility
 *     = daily volatility x 100
 *   - strike: ATM from the NIFTY 09:15 one-minute close (nearest 50), CE and PE of that strike, nearest expiry
 *   - per option: base price = its own 09:15 candle open; 1SD range = base x option volatility rounded UP to 2 decimals;
 *     level = base + factor x 1SD range (fib range rounded to 2 decimals); only BUY ABOVE (factor 0.2611) trades,
 *     the other 14 levels are reference lines; the tick trigger is BUY ABOVE + 8
 *   - Supertrend (10, 3) of the option's own 5-minute chart (hl2, Wilder ATR), warmed up on the previous trading
 *     day's candles of the same strike; no entries until 10 candles exist
 *   - entry (1 lot, one trade at a time per option): Supertrend bullish and BUY ABOVE armed (price traded below it
 *     since the last exit; armed at the start of the day; after an exit only if the exit price is below it) and
 *       tick entry:   a tick crosses up through BUY ABOVE + 8 (previous tick below it)
 *       candle entry: a 5-min candle closes above BUY ABOVE and came from below (previous candle closed at or below
 *                     it, or its own low went below it); filled at the first tick after the close
 *     never on the candle close of an exit
 *   - exits: the Supertrend turning bearish (or already bearish) on a 5-min close, filled at the first tick after the
 *     close; square off 15:14. No stop loss, no targets, no day limits.
 */

import { round, minutesBetween, LOTSIZE, TRADE_END } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";
import { cleanCandles, optionMarkers } from "./charts.js";
import { newSt, stStep } from "./supertrend.js";

// =========================
// CONFIG
// =========================

const ST_PERIOD = 10;
const ST_FACTOR = 3;
const CANDLE_MINUTES = 5;
const STRIKE_STEP = 50;
const SELECT_TIME = "09:15";
const LOTS = 1;
const TICK_BUFFER = 8; // tick trigger = BUY ABOVE + 8
const DAILY_CLOSES = 361;
const MIN_DAILY_CLOSES = 60; // fewer completed daily closes than this and the day is skipped

const FIB_LEVELS = [
  ["BUY ABOVE", 0.2611, true],
  ["TGT-1", 0.382],
  ["TGT-2", 0.5],
  ["REV.ZONE 1", 0.618],
  ["REV.ZONE 2", 0.786],
  ["TGT-3", 1.0],
  ["TGT-4", 1.382],
  ["TGT-5", 1.618],
  ["TGT-6", 1.786],
  ["TGT-7", 2.0],
  ["TGT-8", 2.5],
  ["TGT-9", 3.0],
  ["TGT-10", 3.5],
  ["TGT-11", 4.0],
  ["TGT-12", 4.5],
];

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const bucketOf = (hhmm) => Math.floor((toMin(hhmm) - toMin("09:15")) / CANDLE_MINUTES);
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const ceil2 = (x) => Math.ceil(x * 100 - 1e-9) / 100;

/** the sheet's volatility from completed daily closes (oldest first): { avg, sd, dailyVol, optionVol, closes } */
export function sheetVolatility(closesAsc) {
  const newestFirst = [...closesAsc].reverse();
  const logs = [];
  for (let i = 0; i + 1 < newestFirst.length; i++) logs.push(Math.log(newestFirst[i + 1] / newestFirst[i])); // LN(older / newer)
  const n = logs.length;
  const avg = logs.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(logs.reduce((a, b) => a + (b - avg) ** 2, 0) / (n - 1)); // Excel STDEV (sample)
  const dailyVol = avg + sd;
  return { closes: closesAsc.length, values: n, avg, sd, dailyVol, optionVol: dailyVol * 100 };
}

/** the 15 levels of one option from its base price and the option volatility */
export function fibLevels(base, optionVol) {
  const oneSd = ceil2(base * optionVol);
  const rows = FIB_LEVELS.map(([name, factor, traded]) => {
    const fibRange = r2(factor * oneSd);
    return { name, factor, fibRange, price: r2(base + fibRange), traded: !!traded };
  });
  const buyAbove = rows[0].price;
  return { base: round(base), oneSd, rows, buyAbove, trigger: r2(buyAbove + TICK_BUFFER) };
}

/** 5-min candles of one day's 1-min bars (09:15-15:29), aligned to 09:15 */
function dayCandles(bars) {
  const out = [];
  for (const hhmm of minutesBetween("09:15", "15:29")) {
    const b = bars[hhmm];
    if (!b) continue;
    const k = bucketOf(hhmm);
    const c = out[out.length - 1];
    if (!c || c.k !== k) out.push({ k, open: b[0], high: b[1], low: b[2], close: b[3] });
    else {
      c.high = Math.max(c.high, b[1]);
      c.low = Math.min(c.low, b[2]);
      c.close = b[3];
    }
  }
  return out;
}

// =========================
// ONE DAY SIMULATION
// =========================

class SdFibDaySim {
  static needsIndex = true;
  static needsDaily = true;
  static dailyCloses = DAILY_CLOSES;

  constructor(day, todayData, prevData, indexBars, ctx) {
    this.day = day;
    this.index = indexBars || {};
    this.data = todayData;
    this.prev = prevData;
    this.daily = ctx?.daily || [];
    this.legs = { CE: this.initLeg("CE"), PE: this.initLeg("PE") };
    this.dayClosed = false;
    this.closeReason = null;
    this.trades = [];
    this.events = [];
    this.now = null;
    this.atm = null;
    this.spotAtSelect = null;
    this.vol = null;
  }

  initLeg(name) {
    return {
      name, strike: null, strikesUsed: [], levels: null, firstLevels: null,
      pnl: 0, ltp: 0, lot: LOTS,
      position: false, entryPrice: null, entryTime: null, entryType: null, entryReason: null, entrySt: null,
      st: newSt(), stRows: [], stWarm: null,
      armed: true,           // price has traded below BUY ABOVE since the last exit (true at the start of the day)
      prevTick: null,
      prevCandleClose: null, // close of the last completed 5-min candle (history first)
      candle: null, bucket: null,
      tradingDisabled: false,
    };
  }

  log(type, msg, extra = {}) {
    this.events.push({ time: this.now, type, message: msg, ...extra });
  }

  dayExtras() {
    const v = this.vol;
    return {
      atmStrike: this.atm,
      niftyAtSelect: this.spotAtSelect,
      volatility: v && {
        dailyCloses: v.closes,
        values: v.values,
        average: round(v.avg, 6),
        stdev: round(v.sd, 6),
        dailyVolPct: round(v.dailyVol * 100, 4),
        optionVol: round(v.optionVol, 4),
      },
      levels: { CE: this.legs.CE.levels, PE: this.legs.PE.levels },
      supertrend: {
        params: { period: ST_PERIOD, factor: ST_FACTOR },
        warmup: { CE: this.legs.CE.stWarm, PE: this.legs.PE.stWarm },
        CE: this.legs.CE.stRows,
        PE: this.legs.PE.stRows,
      },
      charts: this.buildCharts(),
    };
  }

  /** per option: 5-min candles with the Supertrend, BUY ABOVE and its tick trigger, TGT-1 / TGT-2, entries / exits */
  buildCharts() {
    const charts = [];
    for (const side of ["CE", "PE"]) {
      const leg = this.legs[side];
      if (!leg.strike || !leg.levels) continue;
      const L = leg.levels;
      const rows = leg.stRows;
      charts.push({
        id: `${side}-sd`,
        title: `${side} ${leg.strike} · ${CANDLE_MINUTES}-min · Supertrend (${ST_PERIOD}, ${ST_FACTOR})`,
        subtitle: `blue = BUY ABOVE ${L.buyAbove} and its tick trigger ${L.trigger}, grey dashed = TGT-1 / TGT-2`,
        tf: CANDLE_MINUTES,
        candles: cleanCandles(rows),
        lines: [{
          name: "Supertrend", color: "#2f9e44", width: 1.8,
          values: rows.map((r) => r.supertrend),
          colors: rows.map((r) => (r.trend === "buy" ? "#2f9e44" : r.trend === "sell" ? "#e03131" : null)),
        }],
        levels: [
          { name: `BUY ABOVE ${L.buyAbove}`, value: L.buyAbove, color: "#1c7ed6" },
          { name: `trigger ${L.trigger}`, value: L.trigger, color: "#1c7ed6", dash: "2 3" },
          { name: `TGT-1 ${L.rows[1].price}`, value: L.rows[1].price, color: "#868e96", dash: "4 4" },
          { name: `TGT-2 ${L.rows[2].price}`, value: L.rows[2].price, color: "#868e96", dash: "4 4" },
        ],
        markers: optionMarkers(this.trades.filter((t) => t.side === side)),
      });
    }
    return charts;
  }

  // ---------- setup ----------

  select() {
    if (this.daily.length < MIN_DAILY_CLOSES) return `only ${this.daily.length} completed NIFTY daily closes before this day, the volatility needs ${DAILY_CLOSES}`;
    this.vol = sheetVolatility(this.daily.map((r) => r.close));
    if (this.daily.length < DAILY_CLOSES) {
      this.log("WARN", `only ${this.daily.length} daily closes (${DAILY_CLOSES} wanted), volatility from what exists`);
    }
    if (!(this.vol.optionVol > 0)) return `option volatility ${round(this.vol.optionVol, 4)} is not above 0`;

    let spot = this.index?.[SELECT_TIME]?.[3];
    if (!spot) {
      spot = this.data.spot?.[SELECT_TIME];
      if (spot) this.log("WARN", `NIFTY index ${SELECT_TIME} candle missing, ATM taken from the options feed spot`);
    }
    if (!spot) return `no NIFTY price at ${SELECT_TIME} to pick the ATM strike`;
    this.spotAtSelect = round(spot);
    this.atm = Math.round(spot / STRIKE_STEP) * STRIKE_STEP;

    for (const side of ["CE", "PE"]) {
      const leg = this.legs[side];
      const bars = this.data[side].get(this.atm);
      if (!bars) return `no ${side} ${this.atm} data today`;
      if (!bars[SELECT_TIME]) return `no ${side} ${this.atm} candle at ${SELECT_TIME}, the base price is unknown`;
      leg.strike = this.atm;
      leg.strikesUsed.push(this.atm);
      leg.levels = fibLevels(bars[SELECT_TIME][0], this.vol.optionVol);
      leg.firstLevels = leg.levels.rows.map((r) => [r.name, r.price]);
      this.warmSupertrend(leg, this.prev?.[side]?.get(this.atm));
      const L = leg.levels;
      this.log("SELECT", `${side} ${this.atm} | base ${L.base} | option vol ${round(this.vol.optionVol, 4)} | 1SD ${L.oneSd} | BUY ABOVE ${L.buyAbove} (tick ${L.trigger})`, {
        side, strike: this.atm, levels: L.rows,
      });
      this.log("LEVELS", `${side} levels: ` + L.rows.slice(1).map((r) => `${r.name} ${r.price}`).join(" | "), { side });
    }
    return null;
  }

  /** the previous trading day's 5-min candles of the same strike go through the Supertrend, so today starts like a chart */
  warmSupertrend(leg, prevBars) {
    const candles = prevBars ? dayCandles(prevBars) : [];
    for (const c of candles) stStep(leg.st, c, ST_PERIOD, ST_FACTOR);
    if (candles.length) leg.prevCandleClose = candles[candles.length - 1].close;
    leg.stWarm = { candles: candles.length, ready: leg.st.atr !== null };
    this.now = "09:15";
    if (!candles.length) {
      this.log("WARN", `${leg.name} ${leg.strike}: no previous-day candles for the Supertrend, no entries until it has ${ST_PERIOD} candles of today`, { side: leg.name });
    } else if (candles.length < ST_PERIOD) {
      this.log("WARN", `${leg.name} ${leg.strike}: only ${candles.length} previous-day candles, no entries until the Supertrend has ${ST_PERIOD}`, { side: leg.name });
    }
  }

  // ---------- orders ----------

  stNow(leg) {
    return leg.st.dir === null ? null : { trend: leg.st.dir === -1 ? "buy" : "sell", value: round(leg.st.value) };
  }

  enter(leg, price, how, why) {
    leg.position = true;
    leg.entryPrice = price;
    leg.entryTime = this.now;
    leg.entryType = how;
    leg.armed = false;
    leg.entryReason = why;
    leg.entrySt = this.stNow(leg);
    this.log("ENTRY", `BUY ${leg.name} ${leg.strike} @ ${price.toFixed(2)} | ${why} | Supertrend ${leg.entrySt ? leg.entrySt.trend + " " + leg.entrySt.value : "not ready"}`, {
      side: leg.name, strike: leg.strike, price: round(price), entryType: how,
    });
  }

  exit(leg, price, reason, kind) {
    const tradePnl = (price - leg.entryPrice) * LOTSIZE * leg.lot;
    leg.pnl += tradePnl;
    const L = leg.levels;
    this.trades.push({
      side: leg.name,
      strike: leg.strike,
      lot: leg.lot,
      quantity: leg.lot * LOTSIZE,
      entryTime: leg.entryTime,
      entryPrice: round(leg.entryPrice),
      exitTime: this.now,
      exitPrice: round(price),
      pivot: `BUY_ABOVE ${L.buyAbove}`,
      buyAbove: L.buyAbove,
      entryType: leg.entryType,
      supertrendAtEntry: leg.entrySt,
      supertrendAtExit: this.stNow(leg),
      entryReason: leg.entryReason,
      exitReason: reason,
      exitType: kind,
      points: round(price - leg.entryPrice),
      pnl: round(tradePnl),
      sidePnlAfter: round(leg.pnl),
    });
    this.log("EXIT", `EXIT ${leg.name} ${leg.strike} @ ${price.toFixed(2)} | ${reason} | ${tradePnl.toFixed(0)}`, {
      side: leg.name, strike: leg.strike, price: round(price), pnl: round(tradePnl), exitType: kind,
    });
    leg.position = false;
    leg.entryPrice = null;
    leg.entryTime = null;
    leg.entryType = null;
    leg.entrySt = null;
    // re-entry only after price has traded below BUY ABOVE: right away when the exit itself is below it
    leg.armed = price < L.buyAbove;
  }

  /** 15:14: each option closes at its own price of that minute and is disabled for the day */
  squareOffLeg(leg, price, reason) {
    if (leg.position) this.exit(leg, price, reason, "FORCE");
    leg.tradingDisabled = true;
    if (Object.values(this.legs).every((l) => l.tradingDisabled)) {
      this.dayClosed = true;
      this.closeReason = reason;
    }
  }

  squareOffAll(reason) {
    for (const leg of Object.values(this.legs)) if (!leg.tradingDisabled) this.squareOffLeg(leg, leg.ltp, reason);
  }

  // ---------- strategy ----------

  /** a 5-min candle completed: Supertrend, its exit, and the candle entry (never on the candle close of an exit) */
  onCandleClose(leg, candle, ltp) {
    const L = leg.levels;
    const ref = stStep(leg.st, candle, ST_PERIOD, ST_FACTOR);
    leg.stRows.push({
      time: candle.start, end: toHHMM(toMin(candle.start) + CANDLE_MINUTES),
      open: round(candle.open), high: round(candle.high), low: round(candle.low), close: round(candle.close),
      supertrend: ref.value === null ? null : round(ref.value, 3), trend: ref.dir === null ? null : ref.dir === -1 ? "buy" : "sell",
      flip: ref.prevDir !== null && ref.dir !== ref.prevDir ? (ref.dir === 1 ? "to sell" : "to buy") : null,
    });
    const prevClose = leg.prevCandleClose;
    leg.prevCandleClose = candle.close;

    if (leg.position) {
      if (ref.dir === 1) {
        this.exit(leg, ltp, `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) bearish on the ${CANDLE_MINUTES}-min close ${round(candle.close)} (band ${round(ref.value)})`, "SUPERTREND");
        return true;
      }
      return false;
    }

    if (ref.dir !== -1 || !leg.armed || this.now >= TRADE_END) return false;
    const cameFromBelow = prevClose === null ? candle.low < L.buyAbove : prevClose <= L.buyAbove || candle.low < L.buyAbove;
    if (candle.close > L.buyAbove && cameFromBelow) {
      this.enter(leg, ltp, "CANDLE", `${CANDLE_MINUTES}-min close ${round(candle.close)} > BUY ABOVE ${L.buyAbove}, came from below`);
    }
    return false;
  }

  onTick(leg, ltp, candle = null) {
    leg.ltp = ltp;
    if (this.now >= TRADE_END) {
      if (!leg.tradingDisabled) this.squareOffLeg(leg, ltp, "TIME EXIT 15:14");
      return;
    }
    if (leg.tradingDisabled) return;
    const L = leg.levels;

    const exitedNow = candle ? this.onCandleClose(leg, candle, ltp) : false;

    if (ltp < L.buyAbove) leg.armed = true; // price has traded below BUY ABOVE
    if (!exitedNow && !leg.position && leg.armed && leg.st.dir === -1 && leg.prevTick !== null && leg.prevTick < L.trigger && ltp >= L.trigger) {
      this.enter(leg, ltp, "TICK", `tick ${ltp.toFixed(2)} crossed up through BUY ABOVE ${L.buyAbove} + ${TICK_BUFFER} = ${L.trigger}`);
    }
    leg.prevTick = ltp;
  }

  // ---------- tick path ----------

  levelCandidates(leg) {
    return leg.position ? [] : [leg.levels.trigger];
  }

  walk(leg, a, b) {
    let cur = a;
    for (;;) {
      if (leg.tradingDisabled || this.dayClosed) return;
      let step;
      if (b > cur) {
        const nxt = this.levelCandidates(leg).filter((x) => cur < x && x < b);
        step = nxt.length ? Math.min(...nxt) : b;
      } else if (b < cur) {
        const nxt = this.levelCandidates(leg).filter((x) => b < x && x < cur);
        step = nxt.length ? Math.max(...nxt) : b;
      } else {
        return;
      }
      this.onTick(leg, round(step, 4));
      cur = step;
      if (step === b) return;
    }
  }

  /** feeds the 5-min candle of the leg; returns the candle that just completed (first tick of a new slot) or null */
  feedCandle(leg, hhmm, bar) {
    const [o, h, l, c] = bar;
    const bucket = bucketOf(hhmm);
    if (leg.bucket !== bucket) {
      const closed = leg.candle;
      leg.bucket = bucket;
      leg.candle = { start: hhmm, open: o, high: h, low: l, close: c };
      return closed;
    }
    leg.candle.high = Math.max(leg.candle.high, h);
    leg.candle.low = Math.min(leg.candle.low, l);
    leg.candle.close = c;
    return null;
  }

  runBar(leg, hhmm, bar) {
    const [o, h, l, c] = bar;
    const closed = this.feedCandle(leg, hhmm, bar);
    this.onTick(leg, o, closed);
    const p = c >= o ? [o, l, h, c] : [o, h, l, c];
    for (let i = 0; i < p.length - 1; i++) this.walk(leg, p[i], p[i + 1]);
  }

  run() {
    this.now = "09:16";
    const err = this.select();
    if (err) return err;

    for (const hhmm of minutesBetween("09:15", "15:29")) {
      this.now = hhmm;
      for (const side of ["CE", "PE"]) {
        const leg = this.legs[side];
        const bar = this.data[side].get(leg.strike)?.[hhmm];
        if (hhmm === SELECT_TIME) {
          // the 09:15 candle is closed before the strategy starts (09:16:05): it only feeds the 5-min candle
          if (bar) {
            this.feedCandle(leg, hhmm, bar);
            leg.prevTick = bar[3];
            leg.ltp = bar[3];
          }
          continue;
        }
        if (bar) this.runBar(leg, hhmm, bar);
        else if (hhmm >= TRADE_END) this.onTick(leg, leg.ltp);
      }
      if (this.dayClosed) break;
    }
    if (!this.dayClosed) this.squareOffAll("TIME EXIT 15:14");
    return null;
  }
}

// =========================
// RUNNER
// =========================

/** nothing to choose: the strategy has no settings (validation hook for the job / access routes) */
export const validateSdFibOptions = () => {};

export async function runNiftySdFibBuyAboveStBacktest(input) {
  const assemble = (run) => {
    for (const d of run.days.filter((x) => x.status === "ok")) {
      d.supertrendExits = d.trades.filter((t) => t.exitType === "SUPERTREND").length;
      d.tickEntries = d.trades.filter((t) => t.entryType === "TICK").length;
      d.candleEntries = d.trades.filter((t) => t.entryType === "CANDLE").length;
      if (input.slim) delete d.supertrend;
    }
    const sum = summarize(run.days, LOTS);
    let analysis = ["No traded days in this range."];
    let summary = null;
    if (sum) {
      const { trades, head, tail } = sum;
      summary = { ...sum.summary };
      delete summary.byPivot;
      analysis = [...head];
      if (trades.length) {
        const net = (a) => inr(a.reduce((x, t) => x + t.pnl, 0));
        const by = (k) => trades.filter((t) => t.exitType === k);
        const tick = trades.filter((t) => t.entryType === "TICK");
        const candle = trades.filter((t) => t.entryType === "CANDLE");
        analysis.push(`${trades.length} trades: ${by("SUPERTREND").length} closed by the Supertrend turning bearish (net ${net(by("SUPERTREND"))}), ` +
          `${by("FORCE").length} squared off at ${TRADE_END} (net ${net(by("FORCE"))}). Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
        analysis.push(`${tick.length} tick entries (net ${net(tick)}) and ${candle.length} candle-close entries (net ${net(candle)}).`);
      }
      analysis.push(...tail.filter((x) => !x.startsWith("Best pivot")));
    }
    return {
      success: run.success,
      strategy: "nifty_sd_fib_buy_above_st",
      params: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        lotSize: LOTSIZE,
        lots: LOTS,
        candleMinutes: CANDLE_MINUTES,
        strike: `ATM from the NIFTY ${SELECT_TIME} 1-min close (nearest ${STRIKE_STEP}), CE and PE of that strike, fixed all day`,
        volatility: `average + 1 x sample stdev of LN(older / newer) over the last ${DAILY_CLOSES - 1} daily returns (${DAILY_CLOSES} completed daily closes before the day), x 100`,
        levels: "base = option 09:15 open; 1SD = base x option volatility (rounded up); BUY ABOVE = base + 0.2611 x 1SD; tick trigger = BUY ABOVE + 8; the other 14 fib levels are reference only",
        entry: `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) bullish and armed: tick crossing up through BUY ABOVE + ${TICK_BUFFER}, or a ${CANDLE_MINUTES}-min close above BUY ABOVE that came from below`,
        exit: `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) bearish on a ${CANDLE_MINUTES}-min close (filled at the next tick), or 15:14 square-off; no stop loss, no targets, no day limits`,
        tradeEnd: TRADE_END,
      },
      summary,
      analysis,
      days: run.days,
      errors: run.errors,
      logs: run.logs,
      meta: run.meta,
    };
  };

  const run = await runDays(input, SdFibDaySim, "sd fib buy above", { assemble });
  const out = assemble(run);
  if (run.cancelled) out.cancelled = true;
  if (input.onUpdate) input.onUpdate({ result: out, progress: { done: run.doneDays, total: run.totalDays, date: null } });
  return out;
}
