/**
 * BACKTEST — nifty_bearish_breakout_option_buying
 *
 * NIFTY CE + PE option buying, two fully independent legs (own strike, candles, levels, trades).
 *   - strike: at 09:30 each side takes the strike whose price at 09:30 (open of the 09:30 bar) is the
 *     lowest one still at or above 200. If no strike is at 200 or above, the dearest one is taken
 *     (logged as a warning). Fixed for the day.
 *   - entry candles: the option's own 15-minute candles (09:15, 09:30, ...), built from the 1-min bars,
 *     taken from 09:15. The latest bearish one (close < open) marks its HIGH; a newer bearish candle
 *     replaces the mark until an entry happens.
 *   - entry: any tick at or above mark HIGH + 4 buys 1 lot (gap above -> filled at the open tick).
 *   - initial SL: the low of the 15-minute candle the entry happened in (its low up to the entry tick).
 *   - after the entry the option is tracked on 5-minute Heikin Ashi candles. Heikin Ashi is recursive
 *     (open = average of the previous HA open and close), so a chart's values depend on every candle
 *     before them. The series is therefore warmed up on the same strike's previous trading day and
 *     continues into today, like a chart does; its error halves with every candle, so it is gone long
 *     before 09:30. Every 5-minute candle that completes after the entry moves the SL to that Heikin
 *     Ashi candle's low MINUS 2 points (up OR down); the first SL (entry candle low) has no offset.
 *     The 5-minute candle the entry happened in counts as the first one.
 *   - any tick at or below the SL exits (gap below -> filled at the open tick).
 *   - after an exit a FRESH bearish 15-minute candle is needed: it must start after the exit bar, the
 *     candle that was still forming when the SL hit does not count. Then HIGH + 4 again.
 *   - no target, no profit / loss limit, everything squared off at 15:14.
 */

import { round, minutesBetween, LOTSIZE, TRADE_END } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";
import { cleanCandles, optionMarkers } from "./charts.js";

// =========================
// CONFIG
// =========================

const STRIKE_TIME = "09:30";       // strike picked on this minute's opening price
const TARGET_PRICE = 200;          // lowest price still at or above this wins
const ENTRY_CANDLE_MIN = 15;
const TRACK_CANDLE_MIN = 5;
const ENTRY_BUFFER = 4;            // entry = bearish high + 4
const TRAIL_OFFSET = 2;            // trailing stop = Heikin Ashi low - 2 (not the first SL)
const MIN_WARMUP_CANDLES = 20;     // fewer previous-day 5-min candles than this -> Heikin Ashi seeded from today's first candle
const TRADE_START = "09:30";
const LOTS = 1;
const EPS = 1e-9;

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const bucketOf = (hhmm, size) => Math.floor((toMin(hhmm) - toMin("09:15")) / size);
const bucketStart = (bucket, size) => toHHMM(toMin("09:15") + bucket * size);

// =========================
// ONE DAY SIMULATION
// =========================

class BearishBreakoutDaySim {
  constructor(day, todayData, prevData) {
    this.day = day;
    this.data = todayData;
    this.prev = prevData;   // previous trading day, same contracts: only used to warm up Heikin Ashi
    this.legs = { CE: this.initLeg("CE"), PE: this.initLeg("PE") };
    this.trades = [];
    this.events = [];
    this.now = null;
    this.dayClosed = false;
    this.closeReason = null;
    this.selection = {};
    this.warmup = {};
  }

  initLeg(name) {
    return {
      name, strike: null, strikesUsed: [], firstLevels: null,
      pnl: 0, ltp: 0, lot: LOTS,
      c15: null, c5: null,            // candles being built
      candles15: [], ha5: [],          // completed candles (for the report)
      haPrev: null,                   // previous Heikin Ashi { open, close }
      mark: null,                     // { high, level, candle } latest bearish 15-min candle
      pos: null,                      // open trade
      exitMinute: "00:00",            // bar of the last exit: a bearish candle must start after it
      gaps: 0,                        // minutes without a bar for the strike
      lastBar: null,
    };
  }

  log(type, msg, extra = {}) {
    this.events.push({ time: this.now, type, message: msg, ...extra });
  }

  dayExtras() {
    const out = { selection: this.selection, haWarmup: this.warmup, legCandles: {} };
    for (const side of ["CE", "PE"]) {
      const l = this.legs[side];
      out.legCandles[side] = { strike: l.strike, candles15: l.candles15, ha5: l.ha5 };
    }
    out.dataGaps = this.legs.CE.gaps + this.legs.PE.gaps;
    out.charts = this.buildCharts();
    return out;
  }

  /** per option: the 15-min chart with the marked entry level, and the 5-min Heikin Ashi chart with the trailing stop */
  buildCharts() {
    const charts = [];
    for (const side of ["CE", "PE"]) {
      const l = this.legs[side];
      const mine = this.trades.filter((t) => t.side === side);
      if (!l.strike) continue;

      // marked level: from the candle that set it until the next mark or the entry of this leg
      const marks = this.events.filter((e) => e.type === "MARK" && e.side === side);
      const entries = this.events.filter((e) => e.type === "ENTRY" && e.side === side).map((e) => e.time);
      const levels = marks.map((m, i) => {
        const nextMark = marks[i + 1]?.time;
        const entry = entries.find((t) => t >= m.time);
        const to = [nextMark, entry].filter(Boolean).sort()[0] || "15:29";
        return { name: `entry above ${m.level}`, value: m.level, color: "#7048e8", dash: "5 4", from: m.time, to };
      });
      charts.push({
        id: `${side}-15`,
        title: `${side} ${l.strike} · 15-min`,
        subtitle: "purple line = latest bearish candle high + 4 (entry level)",
        tf: 15,
        candles: cleanCandles(l.candles15),
        lines: [],
        levels,
        markers: optionMarkers(mine),
      });

      // trailing stop per HA candle while a trade is open: entry candle low first, then every Heikin Ashi low - 2
      const ha = l.ha5;
      const stop = ha.map((c) => {
        for (const t of mine) {
          if (c.end > t.entryTime && c.time <= t.exitTime) {
            let sl = t.initialSl;
            for (const mv of t.slMoves || []) if (mv.time <= c.time) sl = mv.sl;
            return sl;
          }
        }
        return null;
      });
      charts.push({
        id: `${side}-ha`,
        title: `${side} ${l.strike} · 5-min Heikin Ashi`,
        subtitle: "orange line = stop (entry candle low, then Heikin Ashi low - 2)",
        tf: 5,
        candles: cleanCandles(ha),
        lines: [{ name: "Stop", color: "#f08c00", values: stop, step: true, width: 1.8 }],
        levels: [],
        markers: optionMarkers(mine),
      });
    }
    return charts;
  }

  // ---------- strike selection ----------

  select() {
    for (const side of ["CE", "PE"]) {
      const leg = this.legs[side];
      const cands = [];
      for (const [strike, bars] of this.data[side]) {
        const b = bars[STRIKE_TIME];
        if (b) cands.push({ strike, price: b[0] });
      }
      if (!cands.length) return `no ${side} strike has a price at ${STRIKE_TIME}`;
      const above = cands.filter((c) => c.price >= TARGET_PRICE).sort((a, b) => a.price - b.price);
      let pick;
      let rule;
      if (above.length) {
        pick = above[0];
        rule = `lowest price at or above ${TARGET_PRICE}`;
      } else {
        pick = cands.sort((a, b) => b.price - a.price)[0];
        rule = `no strike at ${TARGET_PRICE} or above, dearest one taken`;
        this.now = STRIKE_TIME;
        this.log("WARN", `${side}: every strike is below ${TARGET_PRICE} at ${STRIKE_TIME}, took the dearest (${pick.strike} @ ${pick.price})`, { side });
      }
      leg.strike = pick.strike;
      leg.strikesUsed.push(pick.strike);
      this.selection[side] = { strike: pick.strike, price: round(pick.price), rule, time: STRIKE_TIME };
    }
    return null;
  }

  // ---------- Heikin Ashi warm-up ----------

  /** run the HA recurrence over the strike's previous-day 5-min candles so today starts from a chart-like state */
  warmUpHa(leg) {
    const bars = this.prev?.[leg.name]?.get(leg.strike);
    const candles = [];
    if (bars) {
      for (const hhmm of minutesBetween("09:15", "15:29")) {
        const b = bars[hhmm];
        if (!b) continue;
        const k = bucketOf(hhmm, TRACK_CANDLE_MIN);
        const c = candles[candles.length - 1];
        if (!c || c.k !== k) candles.push({ k, open: b[0], high: b[1], low: b[2], close: b[3] });
        else {
          c.high = Math.max(c.high, b[1]);
          c.low = Math.min(c.low, b[2]);
          c.close = b[3];
        }
      }
    }
    if (candles.length < MIN_WARMUP_CANDLES) {
      this.warmup[leg.name] = { candles: candles.length, used: false };
      this.now = "09:15";
      this.log("WARN", `${leg.name} ${leg.strike}: only ${candles.length} previous-day 5-min candles, Heikin Ashi starts from today's first candle ` +
        "(the first candles of the day can differ from a chart)", { side: leg.name });
      return;
    }
    let prev = null;
    for (const c of candles) {
      const close = (c.open + c.high + c.low + c.close) / 4;
      const open = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
      prev = { open, close };
    }
    leg.haPrev = prev;
    this.warmup[leg.name] = { candles: candles.length, used: true };
  }

  // ---------- candles ----------

  /** a completed 15-min candle: the latest bearish one (that started after the last exit) becomes the mark */
  complete15(leg, c) {
    const bearish = c.close < c.open;
    leg.candles15.push({
      time: c.start, end: toHHMM(toMin(c.start) + ENTRY_CANDLE_MIN),
      open: round(c.open), high: round(c.high), low: round(c.low), close: round(c.close), bearish,
    });
    if (!bearish) return;
    if (leg.pos) return; // formed during a trade: not part of the next setup
    if (!(c.start > leg.exitMinute)) return; // still forming when the last trade exited -> not fresh
    const level = round(c.high + ENTRY_BUFFER, 4);
    leg.mark = { high: round(c.high), level, candle: { start: c.start, open: round(c.open), high: round(c.high), low: round(c.low), close: round(c.close) } };
    this.log("MARK", `${leg.name} bearish 15-min candle ${c.start} (O ${round(c.open)} H ${round(c.high)} L ${round(c.low)} C ${round(c.close)}) -> ` +
      `high ${round(c.high)} marked, entry above ${level}`, { side: leg.name, high: round(c.high), level });
  }

  /** a completed 5-min candle -> Heikin Ashi; while in a trade its low becomes the stop */
  complete5(leg, c) {
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = leg.haPrev ? (leg.haPrev.open + leg.haPrev.close) / 2 : (c.open + c.close) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    leg.haPrev = { open: haOpen, close: haClose };
    leg.ha5.push({
      time: c.start, end: toHHMM(toMin(c.start) + TRACK_CANDLE_MIN),
      open: round(haOpen), high: round(haHigh), low: round(haLow), close: round(haClose),
      regular: { open: round(c.open), high: round(c.high), low: round(c.low), close: round(c.close) },
    });
    if (leg.pos) {
      const old = leg.pos.sl;
      const sl = round(haLow - TRAIL_OFFSET, 4);
      leg.pos.sl = sl;
      leg.pos.slKind = "HA";
      leg.pos.slMoves.push({ time: this.now, candle: c.start, haLow: round(haLow), sl: round(sl) });
      this.log("TRAIL", `${leg.name} 5-min Heikin Ashi ${c.start} completed, low ${round(haLow)} - ${TRAIL_OFFSET} -> stop ${round(old)} -> ${round(sl)}`, {
        side: leg.name, sl: round(sl),
      });
    }
  }

  // ---------- orders ----------

  enter(leg, price) {
    const c15 = leg.c15;
    const sl = round(c15.low, 4);
    const mark = leg.mark;
    leg.pos = {
      entry: price, entryTime: this.now, sl, slKind: "ENTRY_CANDLE_LOW",
      mark, entryCandle: { start: c15.start, low: round(c15.low) },
      slMoves: [],
    };
    leg.mark = null; // used
    this.log("ENTRY", `BUY ${leg.name} ${leg.strike} @ ${price.toFixed(2)} | tick above ${mark.level} (bearish ${mark.candle.start} high ${mark.high} + ${ENTRY_BUFFER}) | ` +
      `SL ${round(sl)} = low of the ${c15.start} 15-min candle`, { side: leg.name, strike: leg.strike, price: round(price), sl: round(sl) });
  }

  exit(leg, price, reason, kind) {
    const p = leg.pos;
    const pnl = (price - p.entry) * LOTSIZE * leg.lot;
    leg.pnl += pnl;
    this.trades.push({
      side: leg.name,
      strike: leg.strike,
      lot: leg.lot,
      quantity: leg.lot * LOTSIZE,
      entryTime: p.entryTime,
      entryPrice: round(p.entry),
      exitTime: this.now,
      exitPrice: round(price),
      pivot: `BEARISH_HIGH ${p.mark.high}`,
      bearishCandle: p.mark.candle,
      markedHigh: p.mark.high,
      entryLevel: p.mark.level,
      entryCandleStart: p.entryCandle.start,
      initialSl: p.entryCandle.low,
      finalSl: round(p.sl),
      slMoves: p.slMoves,
      entryReason: `tick above bearish ${p.mark.candle.start} high ${p.mark.high} + ${ENTRY_BUFFER} = ${p.mark.level}`,
      exitReason: reason,
      exitType: kind,
      points: round(price - p.entry),
      pnl: round(pnl),
      sidePnlAfter: round(leg.pnl),
    });
    this.log("EXIT", `EXIT ${leg.name} ${leg.strike} @ ${price.toFixed(2)} | ${reason} | ${pnl.toFixed(0)}`, {
      side: leg.name, strike: leg.strike, price: round(price), pnl: round(pnl), exitType: kind,
    });
    leg.pos = null;
    leg.exitMinute = this.now;
    leg.mark = null;
  }

  squareOffAll(reason) {
    if (this.dayClosed) return;
    for (const leg of Object.values(this.legs)) if (leg.pos) this.exit(leg, leg.ltp, reason, "FORCE");
    this.dayClosed = true;
    this.closeReason = reason;
  }

  // ---------- ticks ----------

  onTick(leg, price) {
    leg.ltp = price;
    if (this.now >= TRADE_END) {
      this.squareOffAll("TIME EXIT 15:14");
      return;
    }
    // candles follow every tick, so "low so far" at an entry is exact
    for (const c of [leg.c15, leg.c5]) {
      if (!c) continue;
      c.high = Math.max(c.high, price);
      c.low = Math.min(c.low, price);
      c.close = price;
    }

    if (leg.pos) {
      if (price <= leg.pos.sl + EPS) {
        const trail = leg.pos.slKind === "HA";
        this.exit(leg, price, trail
          ? `Tick ${price.toFixed(2)} <= Heikin Ashi low - ${TRAIL_OFFSET} = ${round(leg.pos.sl)}`
          : `Tick ${price.toFixed(2)} <= entry candle low ${round(leg.pos.sl)}`, trail ? "TRAIL" : "SL");
      }
      return;
    }

    if (leg.mark && this.now >= TRADE_START && price >= leg.mark.level - EPS) this.enter(leg, price);
  }

  levelCandidates(leg) {
    if (leg.pos) return [leg.pos.sl];
    if (leg.mark && this.now >= TRADE_START) return [leg.mark.level];
    return [];
  }

  walk(leg, a, b) {
    let cur = a;
    for (;;) {
      if (this.dayClosed) return;
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
    const b15 = bucketOf(hhmm, ENTRY_CANDLE_MIN);
    const b5 = bucketOf(hhmm, TRACK_CANDLE_MIN);

    // the first tick of a new bucket closes the previous candle (5-min first, it can move the stop)
    if (leg.c5 && leg.c5.bucket !== b5) this.complete5(leg, leg.c5);
    if (leg.c15 && leg.c15.bucket !== b15) this.complete15(leg, leg.c15);
    if (!leg.c5 || leg.c5.bucket !== b5) leg.c5 = { bucket: b5, start: bucketStart(b5, TRACK_CANDLE_MIN), open: o, high: o, low: o, close: o };
    if (!leg.c15 || leg.c15.bucket !== b15) leg.c15 = { bucket: b15, start: bucketStart(b15, ENTRY_CANDLE_MIN), open: o, high: o, low: o, close: o };

    // before the strike is chosen only the candles are built
    if (!leg.active) {
      for (const cd of [leg.c5, leg.c15]) {
        cd.high = Math.max(cd.high, h);
        cd.low = Math.min(cd.low, l);
        cd.close = c;
      }
      leg.ltp = c;
      return;
    }

    this.onTick(leg, o);
    const path = c >= o ? [o, l, h, c] : [o, h, l, c];
    for (let i = 0; i < path.length - 1; i++) this.walk(leg, path[i], path[i + 1]);
  }

  run() {
    const err = this.select();
    if (err) return err;
    for (const side of ["CE", "PE"]) this.warmUpHa(this.legs[side]);
    for (const side of ["CE", "PE"]) {
      const s = this.selection[side];
      this.now = STRIKE_TIME;
      this.log("SELECT", `${side} ${s.strike} @ ${s.price} (${STRIKE_TIME} open) — ${s.rule}`, { side, strike: s.strike, price: s.price });
    }

    for (const hhmm of minutesBetween("09:15", "15:29")) {
      this.now = hhmm;
      for (const side of ["CE", "PE"]) {
        const leg = this.legs[side];
        // from the strike minute on the leg trades; earlier minutes only feed the candles
        leg.active = hhmm >= STRIKE_TIME;
        const bar = this.data[side].get(leg.strike)?.[hhmm];
        if (bar) {
          leg.lastBar = hhmm;
          this.runBar(leg, hhmm, bar);
        } else {
          leg.gaps += 1;
          if (leg.gaps === 1) this.log("WARN", `${side} ${leg.strike} has no bar at ${hhmm} (data gap)`, { side });
          if (hhmm >= TRADE_END) this.onTick(leg, leg.ltp);
        }
      }
      if (this.dayClosed) break;
    }
    if (!this.dayClosed) this.squareOffAll("TIME EXIT 15:14");

    // show the last (unfinished) candles too
    for (const leg of Object.values(this.legs)) {
      if (leg.c15) leg.candles15.push({ time: leg.c15.start, end: toHHMM(toMin(leg.c15.start) + ENTRY_CANDLE_MIN), open: round(leg.c15.open), high: round(leg.c15.high), low: round(leg.c15.low), close: round(leg.c15.close), bearish: leg.c15.close < leg.c15.open, partial: true });
    }
    return null;
  }
}

// =========================
// RUNNER
// =========================

export async function runNiftyBearishBreakoutOptionBuyingBacktest(input) {
  const run = await runDays(input, BearishBreakoutDaySim, "bearish breakout");

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
    analysis = [...head];
    if (trades.length) {
      const by = (k) => trades.filter((t) => t.exitType === k);
      const sl = by("SL");
      const tr = by("TRAIL");
      const fo = by("FORCE");
      const net = (a) => inr(a.reduce((s, t) => s + t.pnl, 0));
      analysis.push(`${trades.length} trades: ${sl.length} stopped at the entry-candle low (net ${net(sl)}), ${tr.length} on the ` +
        `Heikin Ashi trail (net ${net(tr)}), ${fo.length} squared off at 15:14 (net ${net(fo)}). Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
    }
    const cold = run.days.filter((d) => d.status === "ok" && d.haWarmup && Object.values(d.haWarmup).some((w) => !w.used)).length;
    if (cold) analysis.push(`${cold} day(s) had too little previous-day data to warm up Heikin Ashi, so their first candles can differ from a chart.`);
    const gaps = run.days.filter((d) => d.status === "ok").reduce((s, d) => s + (d.dataGaps || 0), 0);
    if (gaps) analysis.push(`Data gaps: ${gaps} minute(s) had no bar for the chosen strike, so candles there are built from fewer bars.`);
    analysis.push(...tail.filter((x) => !x.startsWith("Best pivot")));
  }

  return {
    success: run.success,
    strategy: "nifty_bearish_breakout_option_buying",
    params: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      lotSize: LOTSIZE,
      lots: LOTS,
      strike: `per side, at ${STRIKE_TIME}: the lowest price at or above ${TARGET_PRICE} (open of the ${STRIKE_TIME} bar), fixed all day, nearest weekly expiry`,
      entryCandleMinutes: ENTRY_CANDLE_MIN,
      trackCandleMinutes: TRACK_CANDLE_MIN,
      entryBuffer: ENTRY_BUFFER,
      initialSl: "low of the 15-min candle the entry happened in",
      trailing: `5-min Heikin Ashi (warmed up on the previous trading day): every candle that completes after the entry moves the stop to its low - ${TRAIL_OFFSET} (up or down); the first stop is the entry candle low`,
      trailOffset: TRAIL_OFFSET,
      reentry: "a fresh bearish 15-min candle that starts after the exit, then a tick above its high + 4",
      tradeStart: TRADE_START,
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
