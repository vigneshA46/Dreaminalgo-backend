/**
 * BACKTEST — nifty_option_level_breakout (range levels, 3-min)
 *
 * NIFTY CE + PE option buying, two independent legs, one fixed strike all day.
 *   - strike: NIFTY 09:15 one-minute close rounded to the nearest 50 (ATM),
 *     same strike for CE and PE, no strike change
 *   - levels per option, from its own previous-day high / low and today's open:
 *       range        = (prev high - prev low) * 26.11%
 *       buy above    = open + range,   buy target n  = buy above + n * range  (n = 1..11)
 *       sell below   = open - range,   sell target n = sell below - n * range (reference only)
 *   - 3-minute candles built from the 1-min bars (09:15, 09:18, ...)
 *   - entry: 3-min candle closes above buy above -> buy 1 lot at the next tick
 *   - initial SL: any tick <= entry - 20
 *   - once a tick touches buy target n, the 20-point SL is off and the stop becomes
 *     "3-min candle closes below target n" (moves up to every further target touched)
 *   - after an exit, a 3-min candle must close below buy above before a new entry
 *   - no daily profit / loss limit, everything closed at 15:14
 */

import { round, minutesBetween, LOTSIZE, TRADE_END } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";

// =========================
// CONFIG
// =========================

const RANGE_PCT = 0.2611;      // range = previous-day (high - low) * 26.11%
const TARGET_COUNT = 11;
const SL_POINTS = 20;          // initial stop below entry (tick)
const CANDLE_MINUTES = 3;
const STRIKE_STEP = 50;
const SELECT_TIME = "09:15";   // NIFTY 1-min candle whose close picks the ATM (known at 09:16)
const LOTS = 1;

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
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
// ONE DAY SIMULATION
// =========================

class LevelBreakoutDaySim {
  constructor(day, todayData, prevData) {
    this.day = day;
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
      armed: true,            // a new entry is allowed (needs a 3-min close below buy above after an exit)
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
    };
  }

  // ---------- selection ----------

  select() {
    const spot = this.data.spot[SELECT_TIME];
    if (!spot) return `no NIFTY price at ${SELECT_TIME} to pick the ATM strike`;
    this.spotAtSelect = round(spot);
    this.atm = Math.round(spot / STRIKE_STEP) * STRIKE_STEP;

    for (const side of ["CE", "PE"]) {
      const leg = this.legs[side];
      const bars = this.data[side].get(this.atm);
      if (!bars) return `no ${side} ${this.atm} data today`;
      const prevBars = this.prev[side].get(this.atm);
      if (!prevBars) return `no previous-day data for ${side} ${this.atm}`;
      const pb = Object.values(prevBars);
      const firstKey = Object.keys(bars).sort()[0];
      const open = (bars["09:15"] || bars[firstKey])[0];

      leg.strike = this.atm;
      leg.strikesUsed.push(this.atm);
      leg.levels = calculateLevels(Math.max(...pb.map((b) => b[1])), Math.min(...pb.map((b) => b[2])), open);
      const L = leg.levels;
      this.log("SELECT", `${side} ${this.atm} | prev H ${L.prevHigh} L ${L.prevLow} | open ${L.open} | range ${L.range} | ` +
        `buy above ${L.buyAbove} | T1 ${L.buyTargets[0]} … T11 ${L.buyTargets[TARGET_COUNT - 1]}`, {
        side, strike: this.atm, levels: L,
      });
    }
    return null;
  }

  // ---------- orders ----------

  enter(leg, price, candleClose) {
    leg.position = true;
    leg.entryPrice = price;
    leg.entryTime = this.now;
    leg.targetIdx = -1;
    leg.armed = false;
    leg.entryReason = `3-min close ${candleClose} > buy above ${leg.levels.buyAbove}`;
    this.log("ENTRY", `BUY ${leg.name} ${leg.strike} @ ${price.toFixed(2)} | ${leg.entryReason} | SL ${round(price - SL_POINTS)}`, {
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
      initialSl: round(leg.entryPrice - SL_POINTS),
      targetsHit: leg.targetIdx + 1,
      trailStop: leg.targetIdx >= 0 ? L.buyTargets[leg.targetIdx] : null,
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

    if (leg.position) {
      if (leg.targetIdx >= 0 && c < L.buyTargets[leg.targetIdx]) {
        this.exit(leg, ltp, `3-min close ${c} < T${leg.targetIdx + 1} ${L.buyTargets[leg.targetIdx]}`, "TRAIL");
      }
      return;
    }

    if (!leg.armed && c < L.buyAbove) {
      leg.armed = true;
      this.log("REARM", `${leg.name} 3-min close ${c} < buy above ${L.buyAbove} -> re-armed`, { side: leg.name });
      return;
    }

    if (leg.armed && c > L.buyAbove && this.now < TRADE_END) this.enter(leg, ltp, c);
  }

  onTicks(leg, ltp) {
    if (!leg.position) return;
    const L = leg.levels;
    // target touches: the stop moves up to the highest target touched
    while (leg.targetIdx + 1 < TARGET_COUNT && ltp >= L.buyTargets[leg.targetIdx + 1] - 1e-9) {
      leg.targetIdx += 1;
      this.log("TARGET", `${leg.name} touched T${leg.targetIdx + 1} ${L.buyTargets[leg.targetIdx]} -> stop = 3-min close below it`, {
        side: leg.name, target: leg.targetIdx + 1,
      });
    }
    // initial 20-point SL only until T1 is touched
    if (leg.targetIdx < 0 && ltp <= leg.entryPrice - SL_POINTS + 1e-9) {
      this.exit(leg, ltp, `Tick ${ltp.toFixed(2)} <= entry ${round(leg.entryPrice)} - ${SL_POINTS}`, "SL");
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
    return [...leg.levels.buyTargets, leg.entryPrice - SL_POINTS];
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

    // the first tick of a new 3-min bucket closes the previous 3-min candle
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

export async function runNiftyOptionLevelBreakoutBacktest(input) {
  const run = await runDays(input, LevelBreakoutDaySim, "level breakout");

  // trailing exits per leg / day
  for (const d of run.days.filter((x) => x.status === "ok")) {
    for (const side of ["CE", "PE"]) {
      d[side.toLowerCase()].trails = d.trades.filter((t) => t.side === side && t.exitType === "TRAIL").length;
    }
    d.trails = d.ce.trails + d.pe.trails;
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
      const sl = trades.filter((t) => t.exitType === "SL").length;
      const reached = trades.filter((t) => t.targetsHit > 0).length;
      const best = Math.max(...trades.map((t) => t.targetsHit));
      analysis.push(`${trades.length} trades: ${sl} stopped at entry − ${SL_POINTS} before T1, ${reached} reached at least T1 ` +
        `(best run: T${best}). Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
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
      initialSlPoints: SL_POINTS,
      trailing: "after a tick touches buy target n: exit on a 3-min close below target n",
      rearm: "3-min close below buy above after an exit",
      tradeEnd: TRADE_END,
    },
    summary,
    analysis,
    days: run.days,
    errors: run.errors,
    logs: run.logs,
    meta: run.meta,
  };
}
