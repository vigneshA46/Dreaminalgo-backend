/**
 * BACKTEST — NIFTY hourly high-low touch & confirmation
 *   nifty_hourly_range_touch     (version 1, 3-min entry candles)
 *   nifty_hourly_range_touch_1m  (version 2, 1-min entry candles) — same rules, candle size differs
 *   nifty_hourly_range_touch_custom — user settings (1 / 3 / 5-min candles, strike ATM / ITM / OTM,
 *     day and cycle SL / profit and per-trade profit on or off with values, touch buffer: NIFTY within N points
 *     of a line counts as a touch), no entry limit, and an extra exit: a NIFTY tick touching the cycle's
 *     OTHER line closes the trade and arms that line for the next entry (same cycle, no fresh touch).
 *     Re-touch rules (custom only): a touch stays valid until an entry uses it (no time limit);
 *     after a stop loss (candle closes back through the line) the SL line stays armed, so the next candle
 *     that meets the entry condition can trade at once; after a target exit (trade / cycle / day profit)
 *     a fresh touch of either line of the current hour is needed.
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
const LOTS = 1;

// versions 1 and 2: fixed rules
const FIXED_RULES = {
  cycleMaxLoss: -3500,
  cycleMaxProfit: 5000,
  dayMaxLoss: null,
  dayMaxProfit: null,
  maxEntries: 2,
  otherLineExit: false,
  strikeOffset: 0,        // strikes in-the-money from ATM (negative = out-of-the-money)
  tradeMaxProfit: null,   // per-trade profit exit (rupees)
  touchBuffer: 0,         // NIFTY within this many points of a line counts as touching it
  includeCandles: false,  // return the day's NIFTY candles of the entry timeframe
  slKeepsLine: false,     // custom: after an SL the SL line stays armed (no fresh touch needed)
};
const STRIKE_STEP = 50;

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const strikeLabel = (n) => (n === 0 ? "ATM" : n > 0 ? `ITM${n}` : `OTM${-n}`);

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
  constructor(day, options, index, rules) {
    this.day = day;
    this.rules = rules;       // { candleMinutes, cycleMaxLoss, cycleMaxProfit, dayMaxLoss, dayMaxProfit, maxEntries, otherLineExit }
    this.candleMinutes = rules.candleMinutes;
    this.dayStoppedBy = null;
    this.options = options;   // nearest expiry 1-min option bars, today
    this.index = index;       // NIFTY 1-min bars { hhmm: [o, h, l, c] }
    this.cycles = CYCLE_DEFS.map((d) => ({
      ...d, high: null, low: null, ready: false, pnl: 0, entries: 0, stoppedBy: null,
    }));
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

  realizedDay() {
    return this.legs.CE.pnl + this.legs.PE.pnl;
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
    return c && !this.pos && !this.dayStoppedBy && !c.stoppedBy && c.entries < this.rules.maxEntries &&
      this.now < c.windowEnd && this.now < DAY_CLOSE;
  }

  // ---------- orders ----------

  enter(side, strike, price, candle, avg, via) {
    const c = this.active;
    c.entries += 1;
    this.pos = {
      cycle: c, side, strike, lots: LOTS, entry: price, ltp: price, entryTime: this.now,
      line: via.line, lineValue: via.value, signal: { ...candle, avg: round(avg) },
    };
    if (!this.legs[side].strikes.includes(strike)) this.legs[side].strikes.push(strike);
    const reason = `NIFTY ${this.candleMinutes}-min close ${candle.close} ${side === "CE" ? ">" : "<"} ${via.line} ${via.value}, avg ${round(avg)}`;
    this.pos.reason = reason;
    const max = Number.isFinite(this.rules.maxEntries) ? `/${this.rules.maxEntries}` : "";
    this.log("ENTRY", `C${c.k} BUY ${side} ${strike} @ ${price.toFixed(2)} (entry ${c.entries}${max}) | ${reason}`, {
      cycle: c.k, side, strike, price: round(price),
    });
    // used: the next entry needs a touch (after an SL the SL line is re-armed in exit())
    this.touch = null;
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
      strikeType: strikeLabel(this.rules.strikeOffset),
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

    const r = this.rules;
    if (!c.stoppedBy) {
      // 1 paisa tolerance: a limit exit lands on the limit, float noise must not leave it "just short"
      if (r.cycleMaxLoss !== null && c.pnl <= r.cycleMaxLoss + 0.01) c.stoppedBy = "MAX LOSS";
      else if (r.cycleMaxProfit !== null && c.pnl >= r.cycleMaxProfit - 0.01) c.stoppedBy = "MAX PROFIT";
      else if (c.entries >= r.maxEntries) c.stoppedBy = `${r.maxEntries} ENTRIES USED`;
      if (c.stoppedBy) this.log("CYCLE", `C${c.k} stopped: ${c.stoppedBy} (cycle P&L ${c.pnl.toFixed(0)})`, { cycle: c.k });
    }
    if (!this.dayStoppedBy) {
      const day = this.realizedDay();
      if (r.dayMaxLoss !== null && day <= r.dayMaxLoss + 0.01) this.dayStoppedBy = "DAY MAX LOSS";
      else if (r.dayMaxProfit !== null && day >= r.dayMaxProfit - 0.01) this.dayStoppedBy = "DAY MAX PROFIT";
      if (this.dayStoppedBy) {
        this.closeReason = `${this.dayStoppedBy} (${day.toFixed(0)})`;
        this.log("DAY", `Trading stopped for the day: ${this.dayStoppedBy} (day P&L ${day.toFixed(0)})`);
      }
    }
    if (kind !== "FORCE") this.activateLatest();
    // after a stop loss the SL line stays armed: the next qualifying candle can re-enter without a new touch
    if (kind === "SL" && r.slKeepsLine && this.active === c && !c.stoppedBy && !this.dayStoppedBy) {
      this.touch = { line: p.line, value: p.lineValue, time: this.now };
      this.log("TOUCH", `C${c.k} ${p.line} ${p.lineValue} stays armed after the stop loss (no fresh touch needed)`, { cycle: c.k, line: p.line, value: p.lineValue });
    }
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

    if (!this.canEnter()) return;
    const c = candle.close;
    const avg = (candle.open + candle.high + candle.low + candle.close) / 4;
    const sideFor = (L) => (c > L && avg > L && avg < c ? "CE" : c < L && avg < L && avg > c ? "PE" : null);

    let pick = null; // { line, value, side, time? }
    if (!this.touch) return;
    const side0 = sideFor(this.touch.value);
    if (!side0) return;
    pick = { line: this.touch.line, value: this.touch.value, side: side0 };
    const side = pick.side;

    // ATM from the signal close, then n strikes in-the-money: CE below ATM, PE above
    const atm = Math.round(c / STRIKE_STEP) * STRIKE_STEP;
    const n = this.rules.strikeOffset;
    const strike = side === "CE" ? atm - n * STRIKE_STEP : atm + n * STRIKE_STEP;
    const bar = this.optionBar(side, strike, m);
    if (!bar) {
      this.log("SKIP", `${side} ${strike} has no option price at ${m}, signal skipped`, { side, strike });
      return;
    }
    this.enter(side, strike, bar[0], candle, avg, pick);
  }

  // ---------- option ticks: live money limits (trade, cycle and day) ----------

  walkOption(bar) {
    const p = this.pos;
    const r = this.rules;
    const [o, h, l, c] = bar;
    const path = c >= o ? [o, l, h, c] : [o, h, l, c];
    const qty = LOTSIZE * p.lots;
    // option prices where a limit would be hit (fixed for the whole trade)
    const dayRealized = this.realizedDay();
    const lossPrices = [];
    const profitPrices = [];
    if (r.cycleMaxLoss !== null) lossPrices.push(p.entry + (r.cycleMaxLoss - p.cycle.pnl) / qty);
    if (r.dayMaxLoss !== null) lossPrices.push(p.entry + (r.dayMaxLoss - dayRealized) / qty);
    if (r.cycleMaxProfit !== null) profitPrices.push(p.entry + (r.cycleMaxProfit - p.cycle.pnl) / qty);
    if (r.dayMaxProfit !== null) profitPrices.push(p.entry + (r.dayMaxProfit - dayRealized) / qty);
    if (r.tradeMaxProfit !== null) profitPrices.push(p.entry + r.tradeMaxProfit / qty);
    const lossAt = lossPrices.length ? Math.max(...lossPrices) : null;
    const profitAt = profitPrices.length ? Math.min(...profitPrices) : null;

    let cur = o;
    for (let i = 0; i < path.length && this.pos; i++) {
      const b = path[i];
      const pts = [];
      if (i === 0) pts.push(o);
      else if (b < cur) pts.push(...(lossAt !== null && lossAt < cur && lossAt > b ? [lossAt] : []), b);
      else pts.push(...(profitAt !== null && profitAt > cur && profitAt < b ? [profitAt] : []), b);
      for (const ltp of pts) {
        p.ltp = ltp;
        const move = (ltp - p.entry) * qty;
        const cycleRun = p.cycle.pnl + move;
        const dayRun = dayRealized + move;
        if (r.cycleMaxLoss !== null && cycleRun <= r.cycleMaxLoss + 1e-6) {
          this.exit(ltp, `C${p.cycle.k} P&L ${cycleRun.toFixed(0)} hit max loss ${r.cycleMaxLoss}`, "CYCLE_SL");
          return;
        }
        if (r.dayMaxLoss !== null && dayRun <= r.dayMaxLoss + 1e-6) {
          this.exit(ltp, `Day P&L ${dayRun.toFixed(0)} hit day max loss ${r.dayMaxLoss}`, "DAY_SL");
          return;
        }
        if (r.cycleMaxProfit !== null && cycleRun >= r.cycleMaxProfit - 1e-6) {
          this.exit(ltp, `C${p.cycle.k} P&L ${cycleRun.toFixed(0)} hit max profit ${r.cycleMaxProfit}`, "CYCLE_TARGET");
          return;
        }
        if (r.dayMaxProfit !== null && dayRun >= r.dayMaxProfit - 1e-6) {
          this.exit(ltp, `Day P&L ${dayRun.toFixed(0)} hit day max profit ${r.dayMaxProfit}`, "DAY_TARGET");
          return;
        }
        if (r.tradeMaxProfit !== null && move >= r.tradeMaxProfit - 1e-6) {
          this.exit(ltp, `Trade P&L ${move.toFixed(0)} hit trade profit ${r.tradeMaxProfit}`, "TRADE_TARGET");
          return;
        }
      }
      cur = b;
    }
  }

  // custom version: a NIFTY tick touching the trade cycle's OTHER line exits, and that line
  // stays armed for the next entry while the same cycle is still active
  checkOtherLineExit(bar, prevClose, optionBar) {
    const p = this.pos;
    const [line, value] = p.line === "HIGH" ? ["LOW", p.cycle.low] : ["HIGH", p.cycle.high];
    const lo = Math.min(bar[2], prevClose ?? bar[2]);
    const hi = Math.max(bar[1], prevClose ?? bar[1]);
    const b = this.rules.touchBuffer;
    if (!(lo <= value + b && hi >= value - b)) return;
    const cycle = p.cycle;
    this.exit(optionBar ? optionBar[3] : p.ltp, `NIFTY touched C${cycle.k} ${line} ${value} (other line)`, "LINE_TOUCH");
    if (this.active === cycle && !cycle.stoppedBy && !this.dayStoppedBy) {
      this.touch = { line, value, time: this.now };
      this.log("TOUCH", `C${cycle.k} ${line} ${value} armed by the exit touch (no fresh touch needed)`, { cycle: cycle.k, line, value });
    }
  }

  // ---------- index ticks: line touches ----------

  updateTouch(bar, prevClose) {
    if (!this.active || this.pos || this.active.stoppedBy || this.dayStoppedBy) return;
    const lo = Math.min(bar[2], prevClose ?? bar[2]);
    const hi = Math.max(bar[1], prevClose ?? bar[1]);
    const b = this.rules.touchBuffer;
    const hits = [["HIGH", this.active.high], ["LOW", this.active.low]].filter(([, v]) => lo <= v + b && hi >= v - b);
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

      // open trade: option ticks for this minute (live money limits), then the other-line touch
      if (this.pos) {
        const ob = this.optionBar(this.pos.side, this.pos.strike, m);
        if (ob) this.walkOption(ob);
        if (this.pos && this.rules.otherLineExit && ib) this.checkOtherLineExit(ib, prevClose, ob);
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

  // the whole day's NIFTY candles of the entry timeframe (09:15 ... 15:29), as traded on
  indexCandles() {
    const out = [];
    let cur = null;
    for (const m of minutesBetween(DAY_START, "15:29")) {
      const b = this.index[m];
      if (!b) continue;
      const start = toHHMM(toMin(DAY_START) + Math.floor((toMin(m) - toMin(DAY_START)) / this.candleMinutes) * this.candleMinutes);
      if (!cur || cur.time !== start) {
        cur = { time: start, end: toHHMM(toMin(start) + this.candleMinutes), open: b[0], high: b[1], low: b[2], close: b[3] };
        out.push(cur);
      } else {
        cur.high = Math.max(cur.high, b[1]);
        cur.low = Math.min(cur.low, b[2]);
        cur.close = b[3];
      }
    }
    return out.map((c) => ({ ...c, avg: round((c.open + c.high + c.low + c.close) / 4) }));
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

async function runHourlyRangeTouch(input, { strategy, rules }) {
  const { candleMinutes } = rules;
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
      // fallback only: the real 09:15 candle normally comes with the index data. Without it the
      // first hour's High / Low can be off, so say so
      if (!index["09:15"] && options.spot["09:15"]) {
        const s = options.spot["09:15"];
        index["09:15"] = [s, s, s, s];
        log.warn("NIFTY 09:15 candle missing from Dhan, using a flat price from the option feed — first-hour High / Low may be off", day);
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
      sim = new HourlyRangeDaySim(day, options, index, rules);
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
        targets: t.filter((x) => ["CYCLE_TARGET", "DAY_TARGET", "TRADE_TARGET"].includes(x.exitType)).length,
        stopLosses: t.filter((x) => ["SL", "CYCLE_SL", "DAY_SL"].includes(x.exitType)).length,
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
      ...(rules.otherLineExit ? { lineTouchExits: sim.trades.filter((x) => x.exitType === "LINE_TOUCH").length } : {}),
      dayStoppedBy: sim.dayStoppedBy,
      cycles: sim.cycleReport(),
      ...(rules.includeCandles ? { indexCandles: sim.indexCandles() } : {}),
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
      ...(rules.maxEntries === 2 ? { twoEntriesUsed: allCycles.filter((c) => c.stoppedBy === "2 ENTRIES USED").length } : {}),
    };
    summary.dayStops = {
      maxLoss: okDays.filter((d) => d.dayStoppedBy === "DAY MAX LOSS").length,
      maxProfit: okDays.filter((d) => d.dayStoppedBy === "DAY MAX PROFIT").length,
    };

    analysis = [...head];
    if (trades.length) {
      const ce = trades.filter((t) => t.side === "CE").length;
      analysis.push(`${trades.length} trades (${ce} CE / ${trades.length - ce} PE). Exits: ` +
        Object.entries(summary.exits).map(([k, v]) => `${k} ${v}`).join(", ") +
        `. Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
      const stops = [];
      if (rules.cycleMaxLoss !== null) stops.push(`by the ${inr(-rules.cycleMaxLoss)} cycle loss limit: ${summary.cycleStops.maxLoss}`);
      if (rules.cycleMaxProfit !== null) stops.push(`by the ${inr(rules.cycleMaxProfit)} cycle profit limit: ${summary.cycleStops.maxProfit}`);
      if (rules.maxEntries === 2) stops.push(`after 2 entries: ${summary.cycleStops.twoEntriesUsed}`);
      if (stops.length) analysis.push(`Cycles stopped ${stops.join(", ")}.`);
      if (rules.dayMaxLoss !== null || rules.dayMaxProfit !== null) {
        analysis.push(`Days stopped early: ${summary.dayStops.maxLoss} by the day loss limit, ${summary.dayStops.maxProfit} by the day profit limit.`);
      }
      if (rules.otherLineExit) {
        const lt = trades.filter((t) => t.exitType === "LINE_TOUCH");
        analysis.push(`${lt.length} trades exited on the other-line touch, net ${inr(lt.reduce((a, t) => a + t.pnl, 0))}.`);
      }
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
      strike: `${strikeLabel(rules.strikeOffset)} from the signal candle close (ATM = nearest ${STRIKE_STEP}), nearest weekly expiry`,
      stopLoss: `${candleMinutes}-min NIFTY close back through the entry line`,
      cycleMaxLoss: rules.cycleMaxLoss,
      cycleMaxProfit: rules.cycleMaxProfit,
      dayMaxLoss: rules.dayMaxLoss,
      dayMaxProfit: rules.dayMaxProfit,
      tradeMaxProfit: rules.tradeMaxProfit,
      touchBufferPoints: rules.touchBuffer,
      maxEntriesPerCycle: Number.isFinite(rules.maxEntries) ? rules.maxEntries : "no limit",
      otherLineExit: rules.otherLineExit
        ? "a NIFTY tick touching the cycle's other line exits; that line stays armed in the same cycle"
        : false,
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
  runHourlyRangeTouch(input, { strategy: "nifty_hourly_range_touch", rules: { ...FIXED_RULES, candleMinutes: 3 } });

// version 2: 1-min entry candles
export const runNiftyHourlyRangeTouch1mBacktest = (input) =>
  runHourlyRangeTouch(input, { strategy: "nifty_hourly_range_touch_1m", rules: { ...FIXED_RULES, candleMinutes: 1 } });

// =========================
// CUSTOM VERSION (user settings)
// =========================

const TIMEFRAMES = [1, 3, 5];
const STRIKES = { OTM2: -2, OTM1: -1, ATM: 0, ITM1: 1, ITM2: 2, ITM3: 3 };

// request body "options" -> engine rules. Every limit: { enabled: boolean, value: rupees > 0 }
export const CUSTOM_DEFAULTS = {
  timeframe: 3,
  strike: "ITM2",
  touchBuffer: 3,
  daySl: { enabled: false, value: 7000 },
  cycleSl: { enabled: true, value: 3500 },
  dayProfit: { enabled: false, value: 10000 },
  cycleProfit: { enabled: true, value: 5000 },
  tradeProfit: { enabled: false, value: 2000 },
};

function customRules(raw = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const errors = [];

  const timeframe = o.timeframe === undefined ? CUSTOM_DEFAULTS.timeframe : Number(o.timeframe);
  if (!TIMEFRAMES.includes(timeframe)) errors.push("options.timeframe must be 1, 3 or 5 (minutes)");
  const strike = o.strike === undefined ? CUSTOM_DEFAULTS.strike : String(o.strike).toUpperCase();
  if (!Object.hasOwn(STRIKES, strike)) errors.push(`options.strike must be one of ${Object.keys(STRIKES).join(", ")}`);

  const limit = (name) => {
    const v = o[name] === undefined ? CUSTOM_DEFAULTS[name] : o[name];
    if (!v || typeof v !== "object" || typeof v.enabled !== "boolean") {
      errors.push(`options.${name} must be { enabled: true | false, value: amount }`);
      return null;
    }
    if (!v.enabled) return null;
    const value = Number(v.value);
    if (!Number.isFinite(value) || value <= 0) {
      errors.push(`options.${name}.value must be an amount above 0 when enabled`);
      return null;
    }
    return value;
  };
  const daySl = limit("daySl");
  const cycleSl = limit("cycleSl");
  const dayProfit = limit("dayProfit");
  const cycleProfit = limit("cycleProfit");
  const tradeProfit = limit("tradeProfit");
  const touchBuffer = o.touchBuffer === undefined ? CUSTOM_DEFAULTS.touchBuffer : Number(o.touchBuffer);
  if (!Number.isFinite(touchBuffer) || touchBuffer < 0 || touchBuffer > 100) {
    errors.push("options.touchBuffer must be between 0 and 100 (NIFTY points)");
  }
  if (errors.length) throw new BacktestError("Invalid options", 400, errors);

  return {
    candleMinutes: timeframe,
    cycleMaxLoss: cycleSl === null ? null : -cycleSl,
    cycleMaxProfit: cycleProfit,
    dayMaxLoss: daySl === null ? null : -daySl,
    dayMaxProfit: dayProfit,
    maxEntries: Infinity,
    otherLineExit: true,
    strikeOffset: STRIKES[strike],
    tradeMaxProfit: tradeProfit,
    touchBuffer,
    slKeepsLine: true,
    includeCandles: true,
  };
}

// custom: 1 / 3 / 5-min candles, optional day / cycle SL and profit, no entry limit, other-line exit
export const runNiftyHourlyRangeTouchCustomBacktest = (input) =>
  runHourlyRangeTouch(input, { strategy: "nifty_hourly_range_touch_custom", rules: customRules(input.options) });
