/**
 * BACKTEST — nifty_option_level_breakout (range levels, 5-min)
 *
 * NIFTY CE + PE option buying, two independent legs, one fixed strike all day.
 *   - strike: NIFTY 09:15 one-minute close rounded to the nearest 50 (ATM),
 *     same strike for CE and PE, no strike change
 *   - levels per option, from its own previous-day high / low and today's open:
 *       range        = (prev high - prev low) * 26.11%
 *       buy above    = open + range,   buy target n  = buy above + n * range  (n = 1..11)
 *       sell below   = open - range,   sell target n = sell below - n * range (reference only)
 *   - 5-minute candles built from the 1-min bars (09:15, 09:20, ...)
 *   - entry: 5-min candle closes above buy above -> buy 1 lot at the next tick
 *   - the ONLY exit (besides the 15:14 square-off): Supertrend (10, 3) of the option's own 5-min chart
 *     turns to sell, read on the candle close and filled at the next tick. No point stop, no target exit;
 *     the targets are reference lines (the trade only records how many were touched).
 *   - Supertrend is recursive (RMA of the true range, band carry-over), so it is warmed up on the same
 *     strike's previous trading day and continues into today, like a chart does.
 *   - after an exit, a 5-min candle must close below buy above before a new entry
 *   - no daily profit / loss limit, everything closed at 15:14
 */

import { round, minutesBetween, LOTSIZE, TRADE_END } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";
import { cleanCandles, optionMarkers } from "./charts.js";

// =========================
// CONFIG
// =========================

const RANGE_PCT = 0.2611;      // range = previous-day (high - low) * 26.11%
const TARGET_COUNT = 11;
const ST_PERIOD = 10;          // Supertrend ATR length
const ST_FACTOR = 3;           // Supertrend band multiplier
const CANDLE_MINUTES = 5;
const STRIKE_STEP = 50;
const SELECT_TIME = "09:15";   // NIFTY 1-min candle whose close picks the ATM (known at 09:16)
const LOTS = 1;
const MIN_PREV_BARS = 300;   // a previous day with fewer 1-min bars than this is treated as missing data

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const bucketOf = (hhmm) => Math.floor((toMin(hhmm) - toMin("09:15")) / CANDLE_MINUTES);

function calculateLevels(prevHigh, prevLow, open) {
  const range = (prevHigh - prevLow) * RANGE_PCT;
  const buyAbove = open + range;
  const sellBelow = open - range;
  return {
    prevHigh: round(prevHigh),
    prevLow: round(prevLow),
    open: round(open),
    range: round(range),
    buyAbove: round(buyAbove),
    buyTargets: Array.from({ length: TARGET_COUNT }, (_, i) => round(buyAbove + (i + 1) * range)),
    sellBelow: round(sellBelow),
    sellTargets: Array.from({ length: TARGET_COUNT }, (_, i) => round(sellBelow - (i + 1) * range)),
  };
}

// =========================
// SUPERTREND (same as TradingView ta.supertrend(3, 10))
// =========================

const newSt = () => ({ n: 0, trs: [], atr: null, prevClose: null, upper: null, lower: null, dir: null, value: null });

/**
 * Feed one completed candle. dir: -1 = uptrend (buy), +1 = downtrend (sell), null until the ATR exists.
 * Returns { dir, prevDir, value } after this candle.
 */
function stStep(st, c) {
  const prevDir = st.dir;
  const tr = st.prevClose === null ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - st.prevClose), Math.abs(c.low - st.prevClose));
  st.n += 1;
  if (st.n <= ST_PERIOD) {
    st.trs.push(tr);
    st.atr = st.n === ST_PERIOD ? st.trs.reduce((a, b) => a + b, 0) / ST_PERIOD : null; // RMA starts from the SMA of the first 10
  } else {
    st.atr = (st.atr * (ST_PERIOD - 1) + tr) / ST_PERIOD;
  }
  if (st.atr === null) {
    st.prevClose = c.close;
    return { dir: null, prevDir: null, value: null };
  }
  const src = (c.high + c.low) / 2;
  let upper = src + ST_FACTOR * st.atr;
  let lower = src - ST_FACTOR * st.atr;
  if (st.lower !== null) {
    lower = lower > st.lower || st.prevClose < st.lower ? lower : st.lower;
    upper = upper < st.upper || st.prevClose > st.upper ? upper : st.upper;
  }
  let dir;
  if (st.dir === null) dir = 1;
  else if (st.dir === 1) dir = c.close > upper ? -1 : 1;
  else dir = c.close < lower ? 1 : -1;
  st.upper = upper;
  st.lower = lower;
  st.dir = dir;
  st.value = dir === -1 ? lower : upper;
  st.prevClose = c.close;
  return { dir, prevDir, value: st.value };
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

class LevelBreakoutDaySim {
  static needsIndex = true;
  constructor(day, todayData, prevData, indexBars) {
    this.day = day;
    this.index = indexBars;  // real NIFTY 1-min candles of today (from the index chart, 09:15 included)
    this.data = todayData;  // nearest expiry, today
    this.prev = prevData;   // SAME contracts, previous trading day
    this.legs = { CE: this.initLeg("CE"), PE: this.initLeg("PE") };
    this.dayClosed = false;
    this.closeReason = null;
    this.trades = [];
    this.events = [];
    this.now = null;
    this.atm = null;
    this.spotAtSelect = null;
  }

  initLeg(name) {
    return {
      name, strike: null, strikesUsed: [], firstLevels: null, levels: null,
      pnl: 0, ltp: 0, lot: LOTS,
      position: false, entryPrice: null, entryTime: null, entryReason: null,
      targetIdx: -1,          // highest buy target touched in the open trade (-1 = none)
      st: newSt(), stRows: [], entrySt: null,   // Supertrend state, its candle rows (report), state at the entry
      armed: true,            // a new entry is allowed (needs a 5-min close below buy above after an exit)
      candle: null, bucket: null,
      tradingDisabled: false,
    };
  }

  log(type, msg, extra = {}) {
    this.events.push({ time: this.now, type, message: msg, ...extra });
  }

  dayExtras() {
    return {
      atmStrike: this.atm,
      niftyAtSelect: this.spotAtSelect,
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

  /** per option: 5-min candles with the Supertrend, the buy-above level and the first two targets, entries / exits */
  buildCharts() {
    const charts = [];
    for (const side of ["CE", "PE"]) {
      const leg = this.legs[side];
      if (!leg.strike || !leg.levels) continue;
      const L = leg.levels;
      const rows = leg.stRows;
      charts.push({
        id: `${side}-st`,
        title: `${side} ${leg.strike} · ${CANDLE_MINUTES}-min · Supertrend (${ST_PERIOD}, ${ST_FACTOR})`,
        subtitle: "blue line = buy above, grey dashed = T1 / T2",
        tf: CANDLE_MINUTES,
        candles: cleanCandles(rows),
        lines: [{
          name: "Supertrend", color: "#2f9e44", width: 1.8,
          values: rows.map((r) => r.supertrend),
          colors: rows.map((r) => (r.trend === "buy" ? "#2f9e44" : r.trend === "sell" ? "#e03131" : null)),
        }],
        levels: [
          { name: `buy above ${L.buyAbove}`, value: L.buyAbove, color: "#1c7ed6" },
          { name: `T1 ${L.buyTargets[0]}`, value: L.buyTargets[0], color: "#868e96", dash: "4 4" },
          { name: `T2 ${L.buyTargets[1]}`, value: L.buyTargets[1], color: "#868e96", dash: "4 4" },
        ],
        markers: optionMarkers(this.trades.filter((t) => t.side === side)),
      });
    }
    return charts;
  }

  // ---------- selection ----------

  select() {
    // ATM from the real NIFTY 09:15 candle close; the options feed's spot is only a logged fallback
    let spot = this.index?.[SELECT_TIME]?.[3];
    if (!spot) {
      spot = this.data.spot[SELECT_TIME];
      if (spot) this.log("WARN", `NIFTY index ${SELECT_TIME} candle missing, ATM taken from the options feed spot`);
    }
    if (!spot) return `no NIFTY price at ${SELECT_TIME} to pick the ATM strike`;
    this.spotAtSelect = round(spot);
    this.atm = Math.round(spot / STRIKE_STEP) * STRIKE_STEP;

    for (const side of ["CE", "PE"]) {
      const leg = this.legs[side];
      const bars = this.data[side].get(this.atm);
      if (!bars) return `no ${side} ${this.atm} data today`;
      const prevBars = this.prev[side].get(this.atm);
      if (!prevBars) return `no previous-day data for ${side} ${this.atm} (Dhan serves only a narrow strike window for the next expiry on the previous day)`;
      // previous session only incl. the closing session (09:15-15:39, ends 15:40)
      const pb = Object.entries(prevBars).filter(([k]) => k >= "09:15" && k <= "15:39").map(([, b]) => b);
      if (pb.length < MIN_PREV_BARS) {
        return `previous-day data for ${side} ${this.atm} is incomplete (${pb.length} bars), levels would be wrong`;
      }
      if (!bars["09:15"]) return `no ${side} ${this.atm} bar at 09:15, today's open is unknown`;
      const open = bars["09:15"][0];

      leg.strike = this.atm;
      leg.strikesUsed.push(this.atm);
      this.warmSupertrend(leg, prevBars);
      leg.levels = calculateLevels(Math.max(...pb.map((b) => b[1])), Math.min(...pb.map((b) => b[2])), open);
      const L = leg.levels;
      this.log("SELECT", `${side} ${this.atm} | prev H ${L.prevHigh} L ${L.prevLow} | open ${L.open} | range ${L.range} | ` +
        `buy above ${L.buyAbove} | T1 ${L.buyTargets[0]} … T11 ${L.buyTargets[TARGET_COUNT - 1]}`, {
        side, strike: this.atm, levels: L,
      });
    }
    return null;
  }

  // ---------- Supertrend warm-up ----------

  /** run the previous day's 5-min candles of the same strike through the indicator, so today starts like a chart does */
  warmSupertrend(leg, prevBars) {
    const candles = prevBars ? dayCandles(prevBars) : [];
    for (const c of candles) stStep(leg.st, c);
    leg.stWarm = { candles: candles.length, ready: leg.st.atr !== null };
    if (candles.length < 2 * ST_PERIOD) {
      this.now = "09:15";
      this.log("WARN", `${leg.name} ${leg.strike}: only ${candles.length} previous-day 5-min candles for the Supertrend, its first values of the day can differ from a chart`, { side: leg.name });
    }
  }

  // ---------- orders ----------

  enter(leg, price, candleClose) {
    leg.position = true;
    leg.entryPrice = price;
    leg.entryTime = this.now;
    leg.targetIdx = -1;
    leg.armed = false;
    leg.entryReason = `${CANDLE_MINUTES}-min close ${candleClose} > buy above ${leg.levels.buyAbove}`;
    leg.entrySt = leg.st.dir === null ? null : { trend: leg.st.dir === -1 ? "buy" : "sell", value: round(leg.st.value) };
    this.log("ENTRY", `BUY ${leg.name} ${leg.strike} @ ${price.toFixed(2)} | ${leg.entryReason} | Supertrend is ${leg.entrySt ? leg.entrySt.trend + " " + leg.entrySt.value : "not ready"}`, {
      side: leg.name, strike: leg.strike, price: round(price),
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
      supertrendAtEntry: leg.entrySt,
      supertrendAtExit: leg.st.dir === null ? null : { trend: leg.st.dir === -1 ? "buy" : "sell", value: round(leg.st.value) },
      targetsHit: leg.targetIdx + 1,
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
    leg.entrySt = null;
    leg.targetIdx = -1;
  }

  squareOffAll(reason) {
    if (this.dayClosed) return;
    for (const leg of Object.values(this.legs)) {
      if (leg.position) this.exit(leg, leg.ltp, reason, "FORCE");
      leg.tradingDisabled = true;
    }
    this.dayClosed = true;
    this.closeReason = reason;
  }

  // ---------- strategy ----------

  onCandleClose(leg, candle, ltp) {
    const c = candle.close;
    const L = leg.levels;

    // Supertrend first: the candle that just completed
    const ref = stStep(leg.st, candle);
    leg.stRows.push({
      time: candle.start, end: toHHMM(toMin(candle.start) + CANDLE_MINUTES),
      open: round(candle.open), high: round(candle.high), low: round(candle.low), close: round(candle.close),
      supertrend: ref.value === null ? null : round(ref.value, 3), trend: ref.dir === null ? null : ref.dir === -1 ? "buy" : "sell",
      flip: ref.prevDir !== null && ref.dir !== ref.prevDir ? (ref.dir === 1 ? "to sell" : "to buy") : null,
    });

    if (leg.position) {
      // the only exit: the Supertrend turns from buy to sell on this candle's close
      if (ref.prevDir === -1 && ref.dir === 1) {
        this.exit(leg, ltp, `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) turned sell: ${CANDLE_MINUTES}-min close ${round(c)} < band ${round(ref.value)}`, "SUPERTREND");
      }
      return;
    }

    if (!leg.armed && c < L.buyAbove) {
      leg.armed = true;
      this.log("REARM", `${leg.name} ${CANDLE_MINUTES}-min close ${c} < buy above ${L.buyAbove} -> re-armed`, { side: leg.name });
      return;
    }

    if (leg.armed && c > L.buyAbove && this.now < TRADE_END) this.enter(leg, ltp, c);
  }

  onTicks(leg, ltp) {
    if (!leg.position) return;
    const L = leg.levels;
    // target touches are only recorded (they no longer move any stop)
    while (leg.targetIdx + 1 < TARGET_COUNT && ltp >= L.buyTargets[leg.targetIdx + 1] - 1e-9) {
      leg.targetIdx += 1;
      this.log("TARGET", `${leg.name} touched T${leg.targetIdx + 1} ${L.buyTargets[leg.targetIdx]}`, { side: leg.name, target: leg.targetIdx + 1 });
    }
  }

  onTick(leg, ltp, candle = null) {
    leg.ltp = ltp;
    if (this.now >= TRADE_END) {
      this.squareOffAll("TIME EXIT 15:14");
      return;
    }
    if (leg.tradingDisabled) return;
    if (candle) this.onCandleClose(leg, candle, ltp);
    this.onTicks(leg, ltp);
  }

  // ---------- tick path ----------

  levelCandidates(leg) {
    if (!leg.position) return [];
    return leg.levels.buyTargets;
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

  runBar(leg, hhmm, bar) {
    const [o, h, l, c] = bar;
    const bucket = bucketOf(hhmm);
    let closed = null;

    // the first tick of a new 5-min bucket closes the previous 5-min candle
    if (leg.bucket !== bucket) {
      closed = leg.candle;
      leg.bucket = bucket;
      leg.candle = { start: hhmm, open: o, high: h, low: l, close: c };
    } else {
      leg.candle.high = Math.max(leg.candle.high, h);
      leg.candle.low = Math.min(leg.candle.low, l);
      leg.candle.close = c;
    }

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
export const validateLevelBreakoutOptions = () => {};

export async function runNiftyOptionLevelBreakoutBacktest(input) {
  const assemble = (run) => {
    // Supertrend exits per leg / day
    for (const d of run.days.filter((x) => x.status === "ok")) {
      for (const side of ["CE", "PE"]) {
        d[side.toLowerCase()].trails = d.trades.filter((t) => t.side === side && t.exitType === "SUPERTREND").length;
      }
      d.trails = d.ce.trails + d.pe.trails;
      if (input.slim) delete d.supertrend; // range runs: the day dropdowns do not show the candle table
    }

    const sum = summarize(run.days, LOTS);
    let analysis = ["No traded days in this range."];
    let summary = null;
    if (sum) {
      const { trades, head, tail } = sum;
      summary = { ...sum.summary };
      delete summary.byPivot;
      const byTargets = {};
      for (const t of trades) {
        const k = `T${t.targetsHit}`;
        byTargets[k] = byTargets[k] || { trades: 0, pnl: 0 };
        byTargets[k].trades += 1;
        byTargets[k].pnl = round(byTargets[k].pnl + t.pnl);
      }
      summary.byTargetsHit = byTargets;

      analysis = [...head];
      if (trades.length) {
        const st = trades.filter((t) => t.exitType === "SUPERTREND");
        const fo = trades.filter((t) => t.exitType === "FORCE");
        const net = (a) => inr(a.reduce((x, t) => x + t.pnl, 0));
        const reached = trades.filter((t) => t.targetsHit > 0).length;
        const best = Math.max(...trades.map((t) => t.targetsHit));
        analysis.push(`${trades.length} trades: ${st.length} closed when the Supertrend (${ST_PERIOD}, ${ST_FACTOR}) turned sell (net ${net(st)}), ` +
          `${fo.length} squared off at 15:14 (net ${net(fo)}). ${reached} reached at least T1 (best run: T${best}). Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
        const sell = trades.filter((t) => t.supertrendAtEntry?.trend === "sell").length;
        if (sell) analysis.push(`${sell} trade(s) were entered while the Supertrend was already in sell, so they only exit after it turns buy and then sell again, or at 15:14.`);
      }
      analysis.push(...tail.filter((x) => !x.startsWith("Best pivot")));
    }

    return {
      success: run.success,
      strategy: "nifty_option_level_breakout",
      params: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        lotSize: LOTSIZE,
        lots: LOTS,
        strike: `ATM from NIFTY ${SELECT_TIME} 1-min close (nearest ${STRIKE_STEP}), fixed all day`,
        rangePct: RANGE_PCT * 100,
        targets: TARGET_COUNT,
        candleMinutes: CANDLE_MINUTES,
        exit: `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) on the option's ${CANDLE_MINUTES}-min chart turning sell (read on the candle close), warmed up on the previous trading day; no point stop, no target exit`,
        rearm: "5-min close below buy above after an exit",
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

  const run = await runDays(input, LevelBreakoutDaySim, "level breakout", { assemble });
  const out = assemble(run);
  if (run.cancelled) out.cancelled = true;
  if (input.onUpdate) input.onUpdate({ result: out, progress: { done: run.doneDays, total: run.totalDays, date: null } });
  return out;
}
