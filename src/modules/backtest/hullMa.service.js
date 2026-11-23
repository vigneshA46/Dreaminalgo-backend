/**
 * BACKTEST — nifty_hull_ma_option_buying
 *
 * Signals come from a Hull Moving Average on the NIFTY index chart, trades are NIFTY options (1 lot).
 *   - indicator (the TradingView "HullMA" script, period 24):
 *       n2ma = 2 * wma(close, round(n / 2)),  nma = wma(close, n),  diff = n2ma - nma
 *       hma  = wma(diff, round(sqrt(n)))          -> n = 24: wma 12, wma 24, wma 5
 *       colour of a candle = green if hma > hma of the previous candle, else red
 *     wma(x, len) = linear weights, newest value weighs len. It only needs the last len values (no
 *     recursion), so the previous trading days are loaded purely to have a full window at 09:15.
 *   - candles: 1 / 3 / 5 / 15 min NIFTY candles aligned to 09:15, built from the 1-min index bars; the
 *     indicator runs over previous days + today without a break, like on a chart.
 *   - 09:30: the colour of the candle completing at 09:30 is the starting colour, no trade.
 *   - every later candle close with a NEW colour is a signal: any open trade is closed, and
 *       green -> buy CE, red -> buy PE  (ATM / ITM1..ITM5 from that candle's close, nearest 50)
 *     so the strategy is always in one option until the day ends or a day limit is hit.
 *   - fills: at the open of the 1-min option bar at the signal time (the first tick after the candle closed)
 *   - day MTM target / day MTM SL (realised + open P&L, optional): the open trade is closed at that exact
 *     level and nothing more is traded that day
 *   - no entries from 15:14, open trade squared off at 15:14
 */

import { round, minutesBetween, LOTSIZE, TRADE_END, BacktestError } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";

// =========================
// CONFIG
// =========================

const HMA_PERIOD = 24;
const TF_MINUTES = [1, 3, 5, 15];
const STRIKES = { ATM: 0, ITM1: 1, ITM2: 2, ITM3: 3, ITM4: 4, ITM5: 5 };
const STRIKE_STEP = 50;
const SIGNAL_START = "09:30";
const LOTS = 1;
const EPS = 1e-6;

export const HULL_DEFAULTS = {
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
export function hullRules(raw = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const timeframe = o.timeframe === undefined ? HULL_DEFAULTS.timeframe : Number(o.timeframe);
  if (!TF_MINUTES.includes(timeframe)) errors.push("options.timeframe must be 1, 3, 5 or 15 (minutes)");
  const strike = o.strike === undefined ? HULL_DEFAULTS.strike : String(o.strike).toUpperCase();
  if (!Object.hasOwn(STRIKES, strike)) errors.push(`options.strike must be one of ${Object.keys(STRIKES).join(", ")}`);
  const limit = (name) => {
    const v = o[name] === undefined ? HULL_DEFAULTS[name] : o[name];
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

// =========================
// INDICATOR
// =========================

/** Pine wma: linear weights, newest value weighs len; undefined until len values exist */
function wmaAt(arr, i, len) {
  if (i < len - 1) return undefined;
  let sum = 0;
  for (let k = 0; k < len; k++) {
    const v = arr[i - k];
    if (v === undefined) return undefined;
    sum += v * (len - k);
  }
  return sum / ((len * (len + 1)) / 2);
}

/** Hull MA of a close series: array of numbers / undefined, same length */
export function hullSeries(closes, n = HMA_PERIOD) {
  const half = Math.round(n / 2);
  const sqn = Math.round(Math.sqrt(n));
  const diff = closes.map((_, i) => {
    const a = wmaAt(closes, i, half);
    const b = wmaAt(closes, i, n);
    return a === undefined || b === undefined ? undefined : 2 * a - b;
  });
  return closes.map((_, i) => wmaAt(diff, i, sqn));
}

/** candles of one day's 1-min index bars, aligned to 09:15: [{ start, end, open, high, low, close }] */
function buildCandles(bars, tf) {
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

class HullDaySim {
  static needsPrev = false;
  static needsIndex = true;
  static indexHistoryDays = 4;

  constructor(day, todayData, prevData, index, ctx) {
    this.day = day;
    this.data = todayData;
    this.index = index || {};
    this.history = ctx?.history || [];
    this.rules = hullRules(ctx?.options);
    const mk = (name) => ({ name, pnl: 0, strikesUsed: [], firstLevels: null });
    this.legs = { CE: mk("CE"), PE: mk("PE") };
    this.pos = null;
    this.realized = 0;
    this.trades = [];
    this.events = [];
    this.now = null;
    this.lastColor = null;
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
    return { hmaCandles: this.candleRows, warmup: this.warmup, dayStoppedBy: this.dayStoppedBy };
  }

  // ---------- orders ----------

  enter(side, strike, price, signal) {
    this.pos = { side, strike, entry: price, entryTime: this.now, signal };
    if (!this.legs[side].strikesUsed.includes(strike)) this.legs[side].strikesUsed.push(strike);
    this.ltp = price;
    this.log("ENTRY", `BUY ${side} ${strike} @ ${price.toFixed(2)} | HMA turned ${signal.color} on the ${signal.candle.start}-${signal.candle.end} candle ` +
      `(NIFTY ${round(signal.candle.close)})`, { side, strike, price: round(price) });
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
      pivot: `HMA_${p.signal.color.toUpperCase()}`,
      signalColor: p.signal.color,
      signalCandle: { start: p.signal.candle.start, end: p.signal.candle.end, close: round(p.signal.candle.close), hma: round(p.signal.hma) },
      entryReason: `HMA turned ${p.signal.color} (${p.signal.candle.start}-${p.signal.candle.end} close ${round(p.signal.candle.close)})`,
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

  // ---------- signals ----------

  optionBar(side, strike, hhmm) {
    return this.data[side].get(strike)?.[hhmm] || null;
  }

  onSignal(color, candle, hma) {
    const side = color === "green" ? "CE" : "PE";
    if (this.pos) {
      const bar = this.optionBar(this.pos.side, this.pos.strike, this.now);
      this.exit(bar ? bar[0] : this.ltp, `HMA turned ${color}`, "FLIP");
    }
    if (this.dayStoppedBy || this.now >= TRADE_END) return;
    const atm = Math.round(candle.close / STRIKE_STEP) * STRIKE_STEP;
    const n = this.rules.strikeOffset;
    const strike = side === "CE" ? atm - n * STRIKE_STEP : atm + n * STRIKE_STEP;
    const bar = this.optionBar(side, strike, this.now);
    if (!bar) {
      this.log("SKIP", `${side} ${strike} has no option price at ${this.now}, signal skipped`, { side, strike });
      return;
    }
    this.enter(side, strike, bar[0], { color, candle, hma });
  }

  run() {
    if (!Object.keys(this.index).length) return "no NIFTY index data for this day";
    const tf = this.rules.timeframe;

    // history (previous days, then today as it forms): the indicator runs over one unbroken series
    const histCandles = this.history.flatMap((d) => buildCandles(d.bars, tf));
    const todayCandles = buildCandles(this.index, tf);
    const all = [...histCandles, ...todayCandles];
    const closes = all.map((c) => c.close);
    const hma = hullSeries(closes);
    const colorAt = (i) => (hma[i] !== undefined && hma[i - 1] !== undefined ? (hma[i] > hma[i - 1] ? "green" : "red") : null);
    const base = histCandles.length;
    this.warmup = { historyDays: this.history.length, historyCandles: base, needed: HMA_PERIOD + Math.round(Math.sqrt(HMA_PERIOD)) };
    if (base < this.warmup.needed) {
      this.now = "09:15";
      this.log("WARN", `only ${base} candles of history before today (the indicator needs ${this.warmup.needed}), the first signals use a shorter window`);
    }

    const bySignalTime = new Map(); // candle end time -> index into `all`
    todayCandles.forEach((c, j) => bySignalTime.set(c.end, base + j));
    this.candleRows = todayCandles.map((c, j) => {
      const i = base + j;
      return { time: c.start, end: c.end, open: round(c.open), high: round(c.high), low: round(c.low), close: round(c.close),
        hma: hma[i] === undefined ? null : round(hma[i], 3), color: colorAt(i), signal: null };
    });

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

      // a candle completes on its end minute: colour check at its close
      const idx = bySignalTime.get(hhmm);
      if (idx !== undefined && hhmm >= SIGNAL_START) {
        const color = colorAt(idx);
        const candle = all[idx];
        const row = this.candleRows[idx - base];
        if (color) {
          if (this.lastColor === null) {
            this.lastColor = color;
            row.signal = "START";
            this.log("START", `HMA is ${color} on the ${candle.start}-${candle.end} candle — starting colour, waiting for a change`, { color });
          } else if (color !== this.lastColor) {
            row.signal = color === "green" ? "BUY CE" : "BUY PE";
            this.lastColor = color;
            if (!this.dayStoppedBy) this.onSignal(color, candle, hma[idx]);
          }
        }
      }

      // option ticks of this minute for the open trade (day MTM limits)
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

export const validateHullOptions = (options) => {
  hullRules(options);
};

export async function runNiftyHullMaOptionBuyingBacktest(input) {
  const rules = hullRules(input.options);

  // everything after the day loop; also used for the partial results of a background range run
  const assemble = (run) => {
    for (const d of run.days.filter((x) => x.status === "ok")) {
      d.flips = d.trades.filter((t) => t.exitType === "FLIP").length;
      d.targets = d.trades.filter((t) => t.exitType === "DAY_TARGET").length;
      d.stopLosses = d.trades.filter((t) => t.exitType === "DAY_SL").length;
      if (input.slim) delete d.hmaCandles; // range runs: the day dropdowns do not show candles
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
        const parts = [`${by("FLIP").length} closed by a colour change (net ${net(by("FLIP"))})`];
        if (by("DAY_TARGET").length) parts.push(`${by("DAY_TARGET").length} by the day target (net ${net(by("DAY_TARGET"))})`);
        if (by("DAY_SL").length) parts.push(`${by("DAY_SL").length} by the day SL (net ${net(by("DAY_SL"))})`);
        parts.push(`${by("FORCE").length} squared off at ${TRADE_END} (net ${net(by("FORCE"))})`);
        analysis.push(`${trades.length} trades: ${parts.join(", ")}. Avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}.`);
        const green = trades.filter((t) => t.signalColor === "green");
        const red = trades.filter((t) => t.signalColor === "red");
        analysis.push(`Green signals (CE): ${green.length} trades, net ${net(green)}. Red signals (PE): ${red.length} trades, net ${net(red)}.`);
      }
      analysis.push(...tail.filter((x) => !x.startsWith("Best pivot")));
    }

    return {
      success: run.success,
      strategy: "nifty_hull_ma_option_buying",
      params: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        lotSize: LOTSIZE,
        lots: LOTS,
        indicator: `Hull MA ${HMA_PERIOD} (wma ${Math.round(HMA_PERIOD / 2)}, ${HMA_PERIOD}, ${Math.round(Math.sqrt(HMA_PERIOD))}) on NIFTY ${rules.timeframe}-min candles, previous days loaded so it is warmed up`,
        candleMinutes: rules.timeframe,
        strike: `${strikeLabel(rules.strikeOffset)} from the signal candle close (ATM = nearest ${STRIKE_STEP}), nearest weekly expiry`,
        signal: `from ${SIGNAL_START}: a candle close with a new colour — green buys CE, red buys PE, the other side is closed`,
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

  const run = await runDays(input, HullDaySim, "hull ma", { assemble });
  const out = assemble(run);
  if (run.cancelled) out.cancelled = true;
  if (input.onUpdate) input.onUpdate({ result: out, progress: { done: run.doneDays, total: run.totalDays, date: null } });
  return out;
}
