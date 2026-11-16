/**
 * BACKTEST — NIFTY hourly high-low touch & confirmation
 *   nifty_hourly_range_touch     (version 1, 3-min entry candles)
 *   nifty_hourly_range_touch_1m  (version 2, 1-min entry candles) — same rules, candle size differs
 *
 * Levels and signals come from the NIFTY index chart, trades are NIFTY options.
 *   - 5 hourly ranges: 09:15-10:15, 10:15-11:15, 11:15-12:15, 12:15-13:15, 13:15-14:15.
 *     Range k is marked when its hour completes; it trades in the next hour
 *     (cycle 1: 10:15-11:15 ... cycle 5: 14:15-15:15). No trading in the first hour.
 *   - a tick touching the active range's High or Low arms that line
 *   - on a completed 3-min / 1-min NIFTY candle (aligned to 09:15), with avg = (O+H+L+C)/4:
 *       close > line and line < avg < close  -> BUY CE
 *       close < line and close < avg < line  -> BUY PE
 *     ATM strike from that candle's close (nearest 50), nearest weekly expiry, 1 lot,
 *     filled at the option's next tick. Every entry needs a fresh touch.
 *   - exit: NIFTY candle close back through the original line (CE: below, PE: above)
 *   - cycle money limits, live on every option tick (closed trades + open trade):
 *       cycle P&L <= -3,500 or >= +5,000 -> close the trade, no more entries in that cycle
 *   - max 2 entries per cycle, never two trades at once; a trade stays on its own
 *     cycle's range and P&L until it exits, then the latest completed range becomes active
 *   - no entries from 15:15, open trade squared off at 15:15
 */

import {
  BacktestError,
  round,
  addDays,
  isWeekend,
  dowName,
  minutesBetween,
  RunLog,
  DhanData,
  isExpiryDay,
  LOTSIZE,
} from "./backtest.service.js";
import { summarize, inr } from "./backtestRunner.js";

// =========================
// CONFIG
// =========================

const CYCLES = 5;
const DAY_START = "09:15";
const DAY_CLOSE = "15:15";        // no entries from here, open trade squared off
const CYCLE_MAX_LOSS = -3500;
const CYCLE_MAX_PROFIT = 5000;
const MAX_ENTRIES = 2;
const LOTS = 1;
const STRIKE_STEP = 50;

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

// cycle k: range [rangeStart, readyAt) marked at readyAt, trades until windowEnd
const CYCLE_DEFS = Array.from({ length: CYCLES }, (_, i) => {
  const start = toMin(DAY_START) + 60 * i;
  return {
    k: i + 1,
    rangeStart: toHHMM(start),
    readyAt: toHHMM(start + 60),
    windowEnd: i === CYCLES - 1 ? DAY_CLOSE : toHHMM(start + 120),
  };
});

// =========================
// ONE DAY SIMULATION
// =========================

class HourlyRangeDaySim {
  constructor(day, options, index, candleMinutes) {
    this.day = day;
    this.candleMinutes = candleMinutes;
    this.options = options;   // nearest expiry 1-min option bars, today
    this.index = index;       // NIFTY 1-min bars { hhmm: [o, h, l, c] }
    this.cycles = CYCLE_DEFS.map((d) => ({ ...d, high: null, low: null, ready: false, pnl: 0, entries: 0, stoppedBy: null }));
    this.active = null;       // cycle whose High / Low can be touched
    this.touch = null;        // { line: "HIGH" | "LOW", value, time }
    this.pos = null;
    this.candle = null;       // NIFTY entry-timeframe candle being built
    this.trades = [];
    this.events = [];
    this.now = null;
    this.closeReason = null;
    this.legs = { CE: { pnl: 0, strikes: [] }, PE: { pnl: 0, strikes: [] } };
  }

  log(type, msg, extra = {}) {
    this.events.push({ time: this.now, type, message: msg, ...extra });
  }

  optionBar(side, strike, hhmm) {
    return this.options[side].get(strike)?.[hhmm] || null;
  }

  // ---------- cycles ----------

  markRange(cycle) {
    const bars = minutesBetween(cycle.rangeStart, toHHMM(toMin(cycle.readyAt) - 1))
      .map((m) => this.index[m])
      .filter(Boolean);
    if (!bars.length) {
      this.log("RANGE", `C${cycle.k} has no NIFTY data for ${cycle.rangeStart}-${cycle.readyAt}, skipped`);
      return;
    }
    cycle.high = round(Math.max(...bars.map((b) => b[1])));
    cycle.low = round(Math.min(...bars.map((b) => b[2])));
    cycle.ready = true;
    this.log("RANGE", `C${cycle.k} ${cycle.rangeStart}-${cycle.readyAt} High ${cycle.high} / Low ${cycle.low}`, {
      cycle: cycle.k, high: cycle.high, low: cycle.low,
    });
  }

  // latest completed range becomes the active one (fresh touch needed)
  activateLatest() {
    const latest = [...this.cycles].reverse().find((c) => c.ready);
    if (!latest) return;
    if (this.active !== latest) {
      this.active = latest;
      this.log("ACTIVE", `C${latest.k} lines active: High ${latest.high} / Low ${latest.low} (trades until ${latest.windowEnd})` +
        (latest.stoppedBy ? ` — cycle already stopped (${latest.stoppedBy})` : ""), { cycle: latest.k });
    }
    this.touch = null;
  }

  canEnter() {
    const c = this.active;
    return c && !this.pos && !c.stoppedBy && c.entries < MAX_ENTRIES && this.now < c.windowEnd && this.now < DAY_CLOSE;
  }

  // ---------- orders ----------

  enter(side, strike, price, candle, avg) {
    const c = this.active;
    c.entries += 1;
    this.pos = {
      cycle: c, side, strike, lots: LOTS, entry: price, ltp: price, entryTime: this.now,
      line: this.touch.line, lineValue: this.touch.value, signal: { ...candle, avg: round(avg) },
    };
    if (!this.legs[side].strikes.includes(strike)) this.legs[side].strikes.push(strike);
    const reason = `NIFTY ${this.candleMinutes}-min close ${candle.close} ${side === "CE" ? ">" : "<"} ${this.touch.line} ${this.touch.value}, avg ${round(avg)}`;
    this.pos.reason = reason;
    this.log("ENTRY", `C${c.k} BUY ${side} ${strike} @ ${price.toFixed(2)} (entry ${c.entries}/${MAX_ENTRIES}) | ${reason}`, {
      cycle: c.k, side, strike, price: round(price),
    });
    this.touch = null; // used: the next entry needs a fresh touch
  }

  exit(price, reason, kind) {
    const p = this.pos;
    const c = p.cycle;
    const tradePnl = (price - p.entry) * LOTSIZE * p.lots;
    c.pnl += tradePnl;
    this.legs[p.side].pnl += tradePnl;
    this.trades.push({
      cycle: c.k,
      side: p.side,
      strike: p.strike,
      lot: p.lots,
      quantity: p.lots * LOTSIZE,
      entryTime: p.entryTime,
      entryPrice: round(p.entry),
      exitTime: this.now,
      exitPrice: round(price),
      line: p.line,
      lineValue: p.lineValue,
      rangeHigh: c.high,
      rangeLow: c.low,
      signalCandle: { open: p.signal.open, high: p.signal.high, low: p.signal.low, close: p.signal.close, avg: p.signal.avg },
      pivot: `C${c.k}-${p.line} ${p.lineValue}`,
      entryReason: p.reason,
      exitReason: reason,
      exitType: kind,
      points: round(price - p.entry),
      pnl: round(tradePnl),
      cyclePnlAfter: round(c.pnl),
      sidePnlAfter: round(this.legs[p.side].pnl),
    });
    this.log("EXIT", `C${c.k} EXIT ${p.side} ${p.strike} @ ${price.toFixed(2)} | ${reason} | ${tradePnl.toFixed(0)} | cycle ${c.pnl.toFixed(0)}`, {
      cycle: c.k, side: p.side, strike: p.strike, price: round(price), pnl: round(tradePnl), exitType: kind,
    });
    this.pos = null;

    if (!c.stoppedBy) {
      if (c.pnl <= CYCLE_MAX_LOSS + 1e-6) c.stoppedBy = "MAX LOSS";
      else if (c.pnl >= CYCLE_MAX_PROFIT - 1e-6) c.stoppedBy = "MAX PROFIT";
      else if (c.entries >= MAX_ENTRIES) c.stoppedBy = "2 ENTRIES USED";
      if (c.stoppedBy) this.log("CYCLE", `C${c.k} stopped: ${c.stoppedBy} (cycle P&L ${c.pnl.toFixed(0)})`, { cycle: c.k });
    }
    if (kind !== "FORCE") this.activateLatest();
  }

  // ---------- entry-timeframe candle close ----------

  onCandleClose(candle) {
    const m = this.now;

    // technical SL on the original line
    if (this.pos) {
      const p = this.pos;
      const broke = p.side === "CE" ? candle.close < p.lineValue : candle.close > p.lineValue;
      if (broke) {
        const bar = this.optionBar(p.side, p.strike, m);
        this.exit(bar ? bar[0] : p.ltp,
          `NIFTY ${this.candleMinutes}-min close ${candle.close} ${p.side === "CE" ? "<" : ">"} ${p.line} ${p.lineValue}`, "SL");
      }
      return;
    }

    if (!this.touch || !this.canEnter()) return;
    const L = this.touch.value;
    const c = candle.close;
    const avg = (candle.open + candle.high + candle.low + candle.close) / 4;
    let side = null;
    if (c > L && avg > L && avg < c) side = "CE";
    else if (c < L && avg < L && avg > c) side = "PE";
    if (!side) return;

    const strike = Math.round(c / STRIKE_STEP) * STRIKE_STEP;
    const bar = this.optionBar(side, strike, m);
    if (!bar) {
      this.log("SKIP", `${side} ${strike} has no option price at ${m}, signal skipped`, { side, strike });
      return;
    }
    this.enter(side, strike, bar[0], candle, avg);
  }

  // ---------- option ticks: live cycle limits ----------

  walkOption(bar) {
    const p = this.pos;
    const [o, h, l, c] = bar;
    const path = c >= o ? [o, l, h, c] : [o, h, l, c];
    const qty = LOTSIZE * p.lots;
    let cur = o;
    for (let i = 0; i < path.length && this.pos; i++) {
      const b = path[i];
      // prices where cycle P&L would hit a limit
      const lossAt = p.entry + (CYCLE_MAX_LOSS - p.cycle.pnl) / qty;
      const profitAt = p.entry + (CYCLE_MAX_PROFIT - p.cycle.pnl) / qty;
      const pts = [];
      if (i === 0) pts.push(o);
      else if (b < cur) pts.push(...(lossAt < cur && lossAt > b ? [lossAt] : []), b);
      else pts.push(...(profitAt > cur && profitAt < b ? [profitAt] : []), b);
      for (const ltp of pts) {
        p.ltp = ltp;
        const running = p.cycle.pnl + (ltp - p.entry) * qty;
        if (running <= CYCLE_MAX_LOSS + 1e-6) {
          this.exit(round(ltp, 4), `C${p.cycle.k} P&L ${running.toFixed(0)} hit max loss ${CYCLE_MAX_LOSS}`, "CYCLE_SL");
          return;
        }
        if (running >= CYCLE_MAX_PROFIT - 1e-6) {
          this.exit(round(ltp, 4), `C${p.cycle.k} P&L ${running.toFixed(0)} hit max profit ${CYCLE_MAX_PROFIT}`, "CYCLE_TARGET");
          return;
        }
      }
      cur = b;
    }
  }

  // ---------- index ticks: line touches ----------

  updateTouch(bar, prevClose) {
    if (!this.active || this.pos || this.active.stoppedBy) return;
    const lo = Math.min(bar[2], prevClose ?? bar[2]);
    const hi = Math.max(bar[1], prevClose ?? bar[1]);
    const hits = [["HIGH", this.active.high], ["LOW", this.active.low]].filter(([, v]) => lo <= v && v <= hi);
    if (!hits.length) return;
    const [line, value] = hits.reduce((a, b) => (Math.abs(b[1] - bar[3]) < Math.abs(a[1] - bar[3]) ? b : a));
    if (!this.touch || this.touch.line !== line) {
      this.log("TOUCH", `NIFTY touched C${this.active.k} ${line} ${value}`, { cycle: this.active.k, line, value });
    }
    this.touch = { line, value, time: this.now };
  }

  // ---------- day ----------

  run() {
    if (!Object.keys(this.index).length) return "no NIFTY index data for this day";
    let prevClose = null;

    for (const m of minutesBetween(DAY_START, "15:29")) {
      this.now = m;

      if (m >= DAY_CLOSE) {
        if (this.pos) {
          const bar = this.optionBar(this.pos.side, this.pos.strike, m);
          this.exit(bar ? bar[0] : this.pos.ltp, `Day close ${DAY_CLOSE}`, "FORCE");
        }
        this.closeReason = `TIME EXIT ${DAY_CLOSE}`;
        break;
      }

      const ib = this.index[m];
      const boundary = (toMin(m) - toMin(DAY_START)) % this.candleMinutes === 0;

      // completed candle -> SL / entry, then newly completed hourly range
      if (boundary && this.candle) this.onCandleClose(this.candle);
      if (boundary) this.candle = null;
      const done = this.cycles.find((c) => c.readyAt === m);
      if (done) {
        this.markRange(done);
        if (!this.pos) this.activateLatest();
      }

      // open trade: option ticks for this minute (live cycle limits)
      if (this.pos) {
        const ob = this.optionBar(this.pos.side, this.pos.strike, m);
        if (ob) this.walkOption(ob);
      }

      // NIFTY ticks: candle + line touches
      if (ib) {
        if (!this.candle) this.candle = { start: m, open: ib[0], high: ib[1], low: ib[2], close: ib[3] };
        else {
          this.candle.high = Math.max(this.candle.high, ib[1]);
          this.candle.low = Math.min(this.candle.low, ib[2]);
          this.candle.close = ib[3];
        }
        this.updateTouch(ib, prevClose);
        prevClose = ib[3];
      }
    }
    if (!this.closeReason) this.closeReason = `TIME EXIT ${DAY_CLOSE}`;
    return null;
  }

  cycleReport() {
    return this.cycles.map((c) => ({
      cycle: c.k,
      range: [c.rangeStart, c.readyAt],
      window: [c.readyAt, c.windowEnd],
      high: c.high,
      low: c.low,
      entries: c.entries,
      pnl: round(c.pnl),
      stoppedBy: c.stoppedBy,
    }));
  }
}

// =========================
// RUNNER
// =========================

async function runHourlyRangeTouch(input, { strategy, candleMinutes }) {
  const started = Date.now();
  const log = new RunLog();
  const dh = new DhanData({ clientId: input.clientId, accessToken: input.accessToken, log });
  log.info(`${strategy} backtest ${input.fromDate} -> ${input.toDate}`);

  const days = [];
  const errors = [];
  let cumulative = 0;

  for (let day = input.fromDate; day <= input.toDate; day = addDays(day, 1)) {
    if (isWeekend(day)) continue;
    const rec = { date: day, day: dowName(day) };

    let options;
    let index;
    try {
      const calls0 = dh.calls;
      options = await dh.day(day, 1);
      if (options.holiday) {
        days.push({ ...rec, status: "holiday", message: "market holiday / no data" });
        log.info("holiday / no data", day);
        continue;
      }
      index = { ...(await dh.indexDay(day)) };
      // Dhan's index series starts at 09:16 -> take 09:15 from the option feed's NIFTY price
      if (!index["09:15"] && options.spot["09:15"]) {
        const s = options.spot["09:15"];
        index["09:15"] = [s, s, s, s];
      }
      if (dh.calls > calls0) log.info(`data ready (${dh.calls - calls0} API calls)`, day);
    } catch (e) {
      if (e instanceof BacktestError && [401, 403].includes(e.status)) {
        log.error(e.message, day);
        e.details = { ...(e.details || {}), logs: log.entries };
        throw e;
      }
      log.error(`data error: ${e.message}`, day);
      errors.push({ date: day, stage: "data", message: e.message, details: e.details || null });
      days.push({ ...rec, status: "error", message: e.message });
      continue;
    }

    let sim;
    try {
      sim = new HourlyRangeDaySim(day, options, index, candleMinutes);
      const err = sim.run();
      if (err) {
        days.push({ ...rec, status: "skipped", message: err });
        log.warn(`skipped: ${err}`, day);
        continue;
      }
    } catch (e) {
      log.error(`simulation error: ${e.message}`, day);
      errors.push({ date: day, stage: "simulation", message: e.message, stack: e.stack?.split("\n").slice(0, 4) });
      days.push({ ...rec, status: "error", message: e.message });
      continue;
    }

    const leg = (side) => {
      const t = sim.trades.filter((x) => x.side === side);
      return {
        pnl: round(sim.legs[side].pnl),
        strikes: sim.legs[side].strikes,
        // a new ATM strike per trade, not strike changes -> no strikeChanges count
        firstPivots: null,
        trades: t.length,
        targets: t.filter((x) => x.exitType === "CYCLE_TARGET").length,
        stopLosses: t.filter((x) => x.exitType === "SL" || x.exitType === "CYCLE_SL").length,
      };
    };
    const ce = leg("CE");
    const pe = leg("PE");
    const dayPnl = round(sim.legs.CE.pnl + sim.legs.PE.pnl);
    cumulative += dayPnl;

    const out = {
      ...rec,
      status: "ok",
      expiryDay: isExpiryDay(options),
      ce,
      pe,
      dayPnl,
      cumulativePnl: round(cumulative),
      totalTrades: sim.trades.length,
      targets: ce.targets + pe.targets,
      stopLosses: ce.stopLosses + pe.stopLosses,
      closeReason: sim.closeReason,
      cycles: sim.cycleReport(),
      trades: sim.trades,
    };
    if (input.includeEvents) out.events = sim.events;
    days.push(out);
    log.info(`CE ${ce.pnl} | PE ${pe.pnl} | day ${dayPnl} | trades ${sim.trades.length}`, day);
  }

  const sum = summarize(days, LOTS);
  let summary = null;
  let analysis = ["No traded days in this range."];
  if (sum) {
    const { trades, head, tail } = sum;
    summary = { ...sum.summary };
    delete summary.byPivot;
    const byCycle = {};
    for (const t of trades) {
      const k = `C${t.cycle}`;
      byCycle[k] = byCycle[k] || { trades: 0, pnl: 0 };
      byCycle[k].trades += 1;
      byCycle[k].pnl = round(byCycle[k].pnl + t.pnl);
    }
    summary.byCycle = byCycle;
    const okDays = days.filter((d) => d.status === "ok");
    const allCycles = okDays.flatMap((d) => d.cycles);
    summary.cycleStops = {
      maxLoss: allCycles.filter((c) => c.stoppedBy === "MAX LOSS").length,
      maxProfit: allCycles.filter((c) => c.stoppedBy === "MAX PROFIT").length,
      twoEntriesUsed: allCycles.filter((c) => c.stoppedBy === "2 ENTRIES USED").length,
    };

    analysis = [...head];
    if (trades.length) {
      const ce = trades.filter((t) => t.side === "CE").length;
      analysis.push(`${trades.length} trades (${ce} CE / ${trades.length - ce} PE). Exits: ` +
        Object.entries(summary.exits).map(([k, v]) => `${k} ${v}`).join(", ") +
        `. Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
      analysis.push(`Cycles stopped by the ₹3,500 loss limit: ${summary.cycleStops.maxLoss}, by the ₹5,000 profit limit: ` +
        `${summary.cycleStops.maxProfit}, after 2 entries: ${summary.cycleStops.twoEntriesUsed}.`);
      const cyc = Object.entries(byCycle).sort((a, b) => b[1].pnl - a[1].pnl);
      if (cyc.length > 1) {
        analysis.push(`Best cycle: ${cyc[0][0]} (${cyc[0][1].trades} trades, ${inr(cyc[0][1].pnl)}); ` +
          `worst: ${cyc[cyc.length - 1][0]} (${cyc[cyc.length - 1][1].trades} trades, ${inr(cyc[cyc.length - 1][1].pnl)}).`);
      }
    }
    analysis.push(...tail.filter((x) => !x.startsWith("Best pivot")));
  }

  const tradingDays = days.filter((d) => d.status !== "holiday");
  return {
    success: !(tradingDays.length > 0 && tradingDays.every((d) => d.status === "error")),
    strategy,
    params: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      lotSize: LOTSIZE,
      lots: LOTS,
      cycles: CYCLE_DEFS.map((c) => ({ cycle: c.k, range: [c.rangeStart, c.readyAt], window: [c.readyAt, c.windowEnd] })),
      candleMinutes,
      confirmation: `avg = (O+H+L+C)/4 of the ${candleMinutes}-min NIFTY candle: CE line < avg < close, PE close < avg < line`,
      strike: `ATM from the signal candle close (nearest ${STRIKE_STEP}), nearest weekly expiry`,
      stopLoss: `${candleMinutes}-min NIFTY close back through the entry line`,
      cycleMaxLoss: CYCLE_MAX_LOSS,
      cycleMaxProfit: CYCLE_MAX_PROFIT,
      maxEntriesPerCycle: MAX_ENTRIES,
      dayClose: DAY_CLOSE,
    },
    summary,
    analysis,
    days,
    errors,
    logs: log.entries,
    meta: {
      apiCalls: dh.calls,
      durationSec: round((Date.now() - started) / 1000, 1),
      dataSource: "Dhan /v2/charts/intraday (NIFTY index 1-min) + /v2/charts/rollingoption (options, ATM±10)",
    },
  };
}

// version 1: 3-min entry candles
export const runNiftyHourlyRangeTouchBacktest = (input) =>
  runHourlyRangeTouch(input, { strategy: "nifty_hourly_range_touch", candleMinutes: 3 });

// version 2: 1-min entry candles
export const runNiftyHourlyRangeTouch1mBacktest = (input) =>
  runHourlyRangeTouch(input, { strategy: "nifty_hourly_range_touch_1m", candleMinutes: 1 });
