/**
 * BACKTEST — nifty_ema_crossover_retest_option_buying
 *
 * Signals and tracking come from the NIFTY index chart (EMA 5 and EMA 10 of the close), trades are
 * NIFTY options, 1 lot, one trade at a time.
 *   - candles: 1 / 3 / 5 / 15 min NIFTY candles aligned to 09:15, built from the 1-min index bars.
 *     The EMAs run over the previous trading days + today without a break, like on a chart.
 *   - BUY setup (-> buy CE):
 *       1. EMA 5 crosses above EMA 10 (read on a candle close)
 *       2. a LATER candle closes above EMA 10 (confirmation, no entry yet)
 *       3. a LATER candle retests EMA 5: its low reaches EMA 5 (low <= EMA 5 of that candle)  -> entry
 *     SELL setup (-> buy PE): mirrored (cross below, a candle closes below EMA 10, a candle's high
 *     reaches EMA 5). Each crossover is one setup, at most one entry per crossover.
 *   - a new crossover in the other direction cancels an unfinished setup and starts the opposite one
 *   - entry is filled at the first option tick after the retest candle closes
 *   - stop loss and target are the same thing: the REVERSE crossover (a BUY trade exits when EMA 5 crosses
 *     below EMA 10, a SELL trade when it crosses above), read on the candle close, filled at the next tick;
 *     that crossover also starts the opposite setup
 *   - optional day MTM target / day MTM SL (realised + open P&L): the open trade is closed at that exact
 *     level and nothing more is traded that day
 *   - strike ATM / ITM1..ITM4 from the signal candle's close (nearest 50); open trade squared off at 15:14,
 *     no entries from 15:14
 */

import { round, minutesBetween, LOTSIZE, TRADE_END, BacktestError } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";
import { indexChart, indexMarkers, optionTradeCharts } from "./charts.js";

// =========================
// CONFIG
// =========================

const FAST = 5;
const SLOW = 10;
const TF_MINUTES = [1, 3, 5, 15];
const STRIKES = { ATM: 0, ITM1: 1, ITM2: 2, ITM3: 3, ITM4: 4 };
const STRIKE_STEP = 50;
const LOTS = 1;
const EPS = 1e-6;

export const EMA_DEFAULTS = {
  timeframe: 5,
  strike: "ITM1",
  dayTarget: { enabled: false, value: 5000 },
  daySl: { enabled: false, value: 3000 },
};

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const strikeLabel = (n) => (n === 0 ? "ATM" : `ITM${n}`);

/** request body "options" -> rules; throws BacktestError(400) with a list of messages */
export function emaRules(raw = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const timeframe = o.timeframe === undefined ? EMA_DEFAULTS.timeframe : Number(o.timeframe);
  if (!TF_MINUTES.includes(timeframe)) errors.push("options.timeframe must be 1, 3, 5 or 15 (minutes)");
  const strike = o.strike === undefined ? EMA_DEFAULTS.strike : String(o.strike).toUpperCase();
  if (!Object.hasOwn(STRIKES, strike)) errors.push(`options.strike must be one of ${Object.keys(STRIKES).join(", ")}`);
  const limit = (name) => {
    const v = o[name] === undefined ? EMA_DEFAULTS[name] : o[name];
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
  const dayTarget = limit("dayTarget");
  const daySl = limit("daySl");
  if (errors.length) throw new BacktestError("Invalid options", 400, errors);
  return { timeframe, strikeOffset: STRIKES[strike], dayTarget, dayMaxLoss: daySl === null ? null : -daySl };
}

export const validateEmaOptions = (options) => {
  emaRules(options);
};

// =========================
// INDICATOR
// =========================

/** EMA like TradingView: seeded with the first value, alpha = 2 / (n + 1) */
export function emaSeries(closes, n) {
  const a = 2 / (n + 1);
  const out = [];
  closes.forEach((c, i) => out.push(i === 0 ? c : a * c + (1 - a) * out[i - 1]));
  return out;
}

/** candles of one day's 1-min index bars, aligned to 09:15 */
export function buildCandles(bars, tf) {
  const out = [];
  for (const hhmm of minutesBetween("09:15", "15:29")) {
    const b = bars[hhmm];
    if (!b) continue;
    const k = Math.floor((toMin(hhmm) - toMin("09:15")) / tf);
    let c = out[out.length - 1];
    if (!c || c.k !== k) {
      c = { k, start: toHHMM(toMin("09:15") + k * tf), end: toHHMM(toMin("09:15") + (k + 1) * tf), open: b[0], high: b[1], low: b[2], close: b[3] };
      out.push(c);
    } else {
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

export class EmaDaySim {
  static needsPrev = false;
  static needsIndex = true;
  static indexHistoryDays = 4;

  constructor(day, todayData, prevData, index, ctx) {
    this.day = day;
    this.data = todayData;
    this.index = index || {};
    this.history = ctx?.history || [];
    this.rules = emaRules(ctx?.options);
    const mk = (name) => ({ name, pnl: 0, strikesUsed: [], firstLevels: null });
    this.legs = { CE: mk("CE"), PE: mk("PE") };
    this.pos = null;
    this.setup = null; // { side, stage: "CONFIRM" | "RETEST", crossTime, crossIdx, confirmIdx, confirmTime }
    this.realized = 0;
    this.trades = [];
    this.events = [];
    this.now = null;
    this.dayStoppedBy = null;
    this.closeReason = null;
    this.ltp = 0;
    this.candleRows = [];
    this.warmup = {};
  }

  log(type, msg, extra = {}) {
    this.events.push({ time: this.now, type, message: msg, ...extra });
  }

  dayExtras() {
    const tf = this.rules.timeframe;
    const rows = this.candleRows;
    const hasSt = rows.some((r) => r.supertrend !== undefined);
    const lines = [
      { name: "EMA 5", color: "#212529", key: "ema5", width: 1.6 },
      { name: "EMA 10", color: "#f08c00", key: "ema10", width: 1.6 },
    ];
    if (hasSt) lines.push({ name: "Supertrend (10, 1.5)", color: "#2f9e44", key: "supertrend", colorKey: "trend", colorMap: { buy: "#2f9e44", sell: "#e03131" }, width: 1.8 });
    const info = [];
    for (const r of rows) {
      if (r.cross) info.push({ time: r.time, kind: "info", at: r.cross.includes("above") ? "low" : "high", text: r.cross.includes("above") ? "EMA5 crossed above EMA10" : "EMA5 crossed below EMA10" });
      if (r.setup && r.setup !== "supertrend against") info.push({ time: r.time, kind: "info", at: "high", text: r.setup === "confirmed" ? "close confirmed" : r.setup === "rejection" ? "Supertrend rejection" : "EMA5 retest" });
    }
    return {
      emaCandles: this.candleRows,
      warmup: this.warmup,
      dayStoppedBy: this.dayStoppedBy,
      charts: [
        indexChart({
          title: `NIFTY ${tf}-min · EMA 5 / EMA 10${hasSt ? " / Supertrend" : ""}`,
          tf,
          rows,
          lines,
          markers: [...info, ...indexMarkers(this.trades)],
        }),
        ...optionTradeCharts(this.data, this.trades, tf),
      ],
    };
  }

  optionBar(side, strike, hhmm) {
    return this.data[side].get(strike)?.[hhmm] || null;
  }

  // ---------- orders ----------

  enter(setup, candle, ema5) {
    const side = setup.side === "BUY" ? "CE" : "PE";
    const atm = Math.round(candle.close / STRIKE_STEP) * STRIKE_STEP;
    const n = this.rules.strikeOffset;
    const strike = side === "CE" ? atm - n * STRIKE_STEP : atm + n * STRIKE_STEP;
    const bar = this.optionBar(side, strike, this.now);
    if (!bar) {
      this.log("SKIP", `${side} ${strike} has no option price at ${this.now}, entry skipped`, { side, strike });
      return false;
    }
    if (!this.legs[side].strikesUsed.includes(strike)) this.legs[side].strikesUsed.push(strike);
    this.pos = {
      side, strike, entry: bar[0], entryTime: this.now, setup,
      retest: { start: candle.start, end: candle.end, ema5: round(ema5, 2), low: round(candle.low), high: round(candle.high) },
    };
    this.ltp = bar[0];
    this.log("ENTRY", `${setup.side} -> BUY ${side} ${strike} @ ${bar[0].toFixed(2)} | EMA${FAST} retest on the ${candle.start}-${candle.end} candle ` +
      `(EMA${FAST} ${round(ema5, 2)}), crossover ${setup.crossTime}, confirmed ${setup.confirmTime}`, { side, strike, price: round(bar[0]) });
    return true;
  }

  exit(price, reason, kind) {
    const p = this.pos;
    const pnl = (price - p.entry) * LOTSIZE * LOTS;
    this.legs[p.side].pnl += pnl;
    this.realized += pnl;
    this.trades.push({
      side: p.side,
      strike: p.strike,
      strikeType: strikeLabel(this.rules.strikeOffset),
      lot: LOTS,
      quantity: LOTSIZE * LOTS,
      entryTime: p.entryTime,
      entryPrice: round(p.entry),
      exitTime: this.now,
      exitPrice: round(price),
      pivot: `EMA_${p.setup.side}`,
      signalType: p.setup.side,
      crossTime: p.setup.crossTime,
      confirmTime: p.setup.confirmTime,
      retestCandle: p.retest,
      entryReason: `${p.setup.side}: EMA${FAST} crossed ${p.setup.side === "BUY" ? "above" : "below"} EMA${SLOW} at ${p.setup.crossTime}, ` +
        `candle closed ${p.setup.side === "BUY" ? "above" : "below"} EMA${SLOW} at ${p.setup.confirmTime}, EMA${FAST} retested on ${p.retest.start}-${p.retest.end}`,
      exitReason: reason,
      exitType: kind,
      points: round(price - p.entry),
      pnl: round(pnl),
      sidePnlAfter: round(this.legs[p.side].pnl),
      dayPnlAfter: round(this.realized),
    });
    this.log("EXIT", `EXIT ${p.side} ${p.strike} @ ${price.toFixed(2)} | ${reason} | ${pnl.toFixed(0)} | day ${this.realized.toFixed(0)}`, {
      side: p.side, strike: p.strike, price: round(price), pnl: round(pnl), exitType: kind,
    });
    this.pos = null;
  }

  checkDayLimits(price) {
    const p = this.pos;
    const run = this.realized + (price - p.entry) * LOTSIZE * LOTS;
    const r = this.rules;
    if (r.dayMaxLoss !== null && run <= r.dayMaxLoss + EPS) {
      this.exit(price, `Day MTM ${run.toFixed(0)} hit the day SL ${r.dayMaxLoss}`, "DAY_SL");
      this.stopDay("DAY MTM SL", run);
    } else if (r.dayTarget !== null && run >= r.dayTarget - EPS) {
      this.exit(price, `Day MTM ${run.toFixed(0)} hit the day target ${r.dayTarget}`, "DAY_TARGET");
      this.stopDay("DAY MTM TARGET", run);
    }
  }

  stopDay(reason, mtm) {
    this.dayStoppedBy = reason;
    this.closeReason = `${reason} (${mtm.toFixed(0)})`;
    this.setup = null;
    this.log("DAY", `Trading stopped for the day: ${reason} (day P&L ${mtm.toFixed(0)})`);
  }

  /** option ticks of one 1-min bar for the open trade: day MTM limits, hit at their exact price */
  walkBar(bar) {
    const [o, h, l, c] = bar;
    const r = this.rules;
    const qty = LOTSIZE * LOTS;
    const p = this.pos;
    const lossAt = r.dayMaxLoss === null ? null : p.entry + (r.dayMaxLoss - this.realized) / qty;
    const profitAt = r.dayTarget === null ? null : p.entry + (r.dayTarget - this.realized) / qty;
    const path = c >= o ? [o, l, h, c] : [o, h, l, c];
    this.ltp = o;
    this.checkDayLimits(o);
    for (let i = 0; i < path.length - 1 && this.pos; i++) {
      const a = path[i];
      const b = path[i + 1];
      if (b < a) {
        if (lossAt !== null && lossAt < a && lossAt > b) {
          this.ltp = lossAt;
          this.checkDayLimits(lossAt);
          if (!this.pos) return;
        }
      } else if (b > a) {
        if (profitAt !== null && profitAt > a && profitAt < b) {
          this.ltp = profitAt;
          this.checkDayLimits(profitAt);
          if (!this.pos) return;
        }
      }
      this.ltp = b;
      this.checkDayLimits(b);
    }
  }

  // ---------- signals (one call per completed candle) ----------

  onCandle(i, all, e5, e10, row) {
    const c = all[i];
    const crossUp = e5[i] > e10[i] && e5[i - 1] <= e10[i - 1];
    const crossDown = e5[i] < e10[i] && e5[i - 1] >= e10[i - 1];
    if (crossUp) row.cross = "EMA5 above EMA10";
    if (crossDown) row.cross = "EMA5 below EMA10";

    // the reverse crossover is the stop loss AND the target
    if (this.pos) {
      const reverse = (this.pos.setup.side === "BUY" && crossDown) || (this.pos.setup.side === "SELL" && crossUp);
      if (reverse) {
        const bar = this.optionBar(this.pos.side, this.pos.strike, this.now);
        this.exit(bar ? bar[0] : this.ltp, `Reverse crossover: EMA${FAST} ${crossDown ? "below" : "above"} EMA${SLOW}`, "REVERSE_CROSS");
      }
    }

    if (this.dayStoppedBy) return;

    // a crossover starts a new setup (and cancels an unfinished opposite one); not while a trade is open
    if (crossUp || crossDown) {
      if (this.setup) this.log("SETUP", `${this.setup.side} setup from ${this.setup.crossTime} cancelled by the opposite crossover`);
      if (!this.pos) {
        this.setup = { side: crossUp ? "BUY" : "SELL", stage: "CONFIRM", crossTime: c.end, crossIdx: i };
        this.log("CROSS", `EMA${FAST} crossed ${crossUp ? "above" : "below"} EMA${SLOW} on the ${c.start}-${c.end} candle — waiting for a candle to close ${crossUp ? "above" : "below"} EMA${SLOW}`);
      } else {
        this.setup = null; // a trade is open on this side; the opposite setup starts after it exits (below)
      }
      if (this.pos === null) return;
    }
    if (this.pos) return;

    const s = this.setup;
    if (!s || i === s.crossIdx) return;

    if (s.stage === "CONFIRM") {
      const ok = s.side === "BUY" ? c.close > e10[i] : c.close < e10[i];
      if (ok) {
        s.stage = "RETEST";
        s.confirmIdx = i;
        s.confirmTime = c.end;
        row.setup = "confirmed";
        this.log("CONFIRM", `${s.side}: ${c.start}-${c.end} candle closed ${s.side === "BUY" ? "above" : "below"} EMA${SLOW} (${round(c.close)} vs ${round(e10[i], 2)}) — waiting for the EMA${FAST} retest`);
      }
      return;
    }

    if (s.stage === "RETEST" && i > s.confirmIdx) {
      const touched = s.side === "BUY" ? c.low <= e5[i] : c.high >= e5[i];
      if (touched) {
        row.setup = "retest";
        if (this.now >= TRADE_END) return;
        const setup = s;
        this.setup = null;
        this.enter(setup, c, e5[i]);
      }
    }
  }

  run() {
    if (!Object.keys(this.index).length) return "no NIFTY index data for this day";
    const tf = this.rules.timeframe;

    const histCandles = this.history.flatMap((d) => buildCandles(d.bars, tf));
    const todayCandles = buildCandles(this.index, tf);
    const all = [...histCandles, ...todayCandles];
    const closes = all.map((c) => c.close);
    const e5 = emaSeries(closes, FAST);
    const e10 = emaSeries(closes, SLOW);
    const base = histCandles.length;
    if (this.prepare) this.prepare(all, base); // subclasses: extra indicators over the same candles
    this.warmup = { historyDays: this.history.length, historyCandles: base };
    if (base < 3 * SLOW) {
      this.now = "09:15";
      this.log("WARN", `only ${base} candles of history before today, the EMAs start with a short warm-up (the first candles can differ from a chart)`);
    }

    const bySignalTime = new Map();
    todayCandles.forEach((c, j) => bySignalTime.set(c.end, base + j));
    this.candleRows = todayCandles.map((c, j) => ({
      time: c.start, end: c.end, open: round(c.open), high: round(c.high), low: round(c.low), close: round(c.close),
      ema5: round(e5[base + j], 2), ema10: round(e10[base + j], 2), cross: null, setup: null,
    }));
    if (this.decorateRows) this.decorateRows(this.candleRows, base);

    for (const hhmm of minutesBetween("09:15", "15:29")) {
      this.now = hhmm;

      if (hhmm >= TRADE_END) {
        if (this.pos) {
          const bar = this.optionBar(this.pos.side, this.pos.strike, hhmm);
          this.exit(bar ? bar[0] : this.ltp, `Day close ${TRADE_END}`, "FORCE");
        }
        if (!this.closeReason) this.closeReason = `TIME EXIT ${TRADE_END}`;
        break;
      }

      // a candle completes on its end minute
      const idx = bySignalTime.get(hhmm);
      if (idx !== undefined) this.onCandle(idx, all, e5, e10, this.candleRows[idx - base]);

      if (this.pos) {
        const bar = this.optionBar(this.pos.side, this.pos.strike, hhmm);
        if (bar) this.walkBar(bar);
      }
      if (this.dayStoppedBy) break;
    }
    if (!this.closeReason) this.closeReason = `TIME EXIT ${TRADE_END}`;
    return null;
  }
}

// =========================
// RUNNER
// =========================

export async function runNiftyEmaCrossoverRetestBacktest(input) {
  const rules = emaRules(input.options);

  const assemble = (run) => {
    for (const d of run.days.filter((x) => x.status === "ok")) {
      d.reverseExits = d.trades.filter((t) => t.exitType === "REVERSE_CROSS").length;
      d.targets = d.trades.filter((t) => t.exitType === "DAY_TARGET").length;
      d.stopLosses = d.trades.filter((t) => t.exitType === "DAY_SL").length;
      if (input.slim) delete d.emaCandles; // range runs: the day dropdowns do not show candles
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
        const net = (a) => inr(a.reduce((s, t) => s + t.pnl, 0));
        const rv = by("REVERSE_CROSS");
        const parts = [`${rv.length} closed by the reverse crossover (net ${net(rv)}, ${rv.filter((t) => t.pnl > 0).length} of them in profit)`];
        if (by("DAY_TARGET").length) parts.push(`${by("DAY_TARGET").length} by the day target (net ${net(by("DAY_TARGET"))})`);
        if (by("DAY_SL").length) parts.push(`${by("DAY_SL").length} by the day SL (net ${net(by("DAY_SL"))})`);
        parts.push(`${by("FORCE").length} squared off at ${TRADE_END} (net ${net(by("FORCE"))})`);
        analysis.push(`${trades.length} trades: ${parts.join(", ")}. Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
        const buy = trades.filter((t) => t.signalType === "BUY");
        const sell = trades.filter((t) => t.signalType === "SELL");
        analysis.push(`BUY setups (CE): ${buy.length} trades, net ${net(buy)}. SELL setups (PE): ${sell.length} trades, net ${net(sell)}.`);
      }
      analysis.push(...tail.filter((x) => !x.startsWith("Best pivot")));
    }

    return {
      success: run.success,
      strategy: "nifty_ema_crossover_retest_option_buying",
      params: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        lotSize: LOTSIZE,
        lots: LOTS,
        indicator: `EMA ${FAST} and EMA ${SLOW} of the close on NIFTY ${rules.timeframe}-min candles, previous days loaded so they are warmed up`,
        candleMinutes: rules.timeframe,
        strike: `${strikeLabel(rules.strikeOffset)} from the signal candle close (ATM = nearest ${STRIKE_STEP}), nearest weekly expiry`,
        entry: `EMA${FAST} crossover -> a later candle closes beyond EMA${SLOW} -> a later candle retests EMA${FAST} (touch) -> entry at the next tick`,
        exit: "reverse crossover of EMA 5 and EMA 10 (stop loss and target are the same), read on the candle close",
        dayTarget: rules.dayTarget,
        dayMaxLoss: rules.dayMaxLoss,
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

  const run = await runDays(input, EmaDaySim, "ema crossover retest", { assemble });
  const out = assemble(run);
  if (run.cancelled) out.cancelled = true;
  if (input.onUpdate) input.onUpdate({ result: out, progress: { done: run.doneDays, total: run.totalDays, date: null } });
  return out;
}
