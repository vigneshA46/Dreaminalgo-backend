/**
 * BACKTEST — nifty_supertrend_ema_buying_1min  (NIFTY_SUPERTREND_EMA_BUYING_1MIN)
 *
 * Signals come from the NIFTY index (EMA 5, EMA 10, Supertrend (10, 1.5), all of the close), trades are NIFTY
 * options bought only, one position at a time. The timeframe of the index candles is an input: 1 / 3 / 5 / 15 min
 * (aligned to 09:15); the indicators run over the previous trading days + today without a break.
 *   - reference line: the close of the first 1-minute index candle (09:15, known at 09:16)
 *   - FIRST entry of the day (a candle closes while no position is open):
 *       CE: close above the line, Supertrend BUY, EMA 5 above EMA 10
 *       PE: close below the line, Supertrend SELL, EMA 10 above EMA 5
 *     whichever qualifies first is taken. After the first entry the line is no longer used: later entries only
 *     need the Supertrend direction and the EMA order to agree.
 *   - entry is filled at the first option tick after the signal candle closes
 *   - strike: 200 points in the money from the signal candle's close (ATM - 200 for CE, ATM + 200 for PE)
 *   - lots alternate over every entry of the day, both sides: 2, 4, 2, 4 ...
 *   - once the trade's profit reaches Rs 3,000 half of the lots are booked (at that price) and the rest ride;
 *     if the Supertrend flips before that, the whole position exits
 *   - exit of what is left: the Supertrend turning against the trade, read on the candle close, filled at the next tick
 *   - day limits (each can be switched off): realised + open P&L at +target or -SL closes everything at that exact
 *     level and no more trades are taken that day
 *   - an open position is squared off at 15:14, no entries from 15:14
 */

import { round, TRADE_END, LOTSIZE, BacktestError } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";
import { EmaStDaySim } from "./emaSupertrend.service.js";

// =========================
// CONFIG
// =========================

const FAST = 5;
const SLOW = 10;
const ST_PERIOD = 10;
const ST_FACTOR = 1.5;
const TF_MINUTES = [1, 3, 5, 15];
const STRIKE_STEP = 50;
const ITM_POINTS = 200;
const LOT_LADDER = [2, 4]; // alternates
const BOOK_AT = 3000; // trade profit (Rs) that books half of the lots
const EPS = 1e-6;

export const ST1M_DEFAULTS = {
  timeframe: 1,
  dayTarget: { enabled: true, value: 10000 },
  daySl: { enabled: true, value: 10000 },
};

/** request body "options" -> rules; throws BacktestError(400) with a list of messages */
export function st1mRules(raw = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const timeframe = o.timeframe === undefined ? ST1M_DEFAULTS.timeframe : Number(o.timeframe);
  if (!TF_MINUTES.includes(timeframe)) errors.push("options.timeframe must be 1, 3, 5 or 15 (minutes)");
  const limit = (name) => {
    const v = o[name] === undefined ? ST1M_DEFAULTS[name] : o[name];
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
  return { timeframe, strikeOffset: ITM_POINTS / STRIKE_STEP, dayTarget, dayMaxLoss: daySl === null ? null : -daySl };
}

export const validateSt1mOptions = (options) => {
  st1mRules(options);
};

// =========================
// ONE DAY SIMULATION
// =========================

class St1mDaySim extends EmaStDaySim {
  constructor(day, todayData, prevData, index, ctx) {
    super(day, todayData, prevData, index, { ...ctx, options: { timeframe: st1mRules(ctx?.options).timeframe } });
    this.rules = st1mRules(ctx?.options);
    this.entries = 0; // entries taken today (drives the 2, 4, 2, 4 lots)
    this.refLine = null;
    this.refTime = null;
    const first = this.index["09:15"];
    if (first) {
      this.refLine = first[3];
      this.refTime = "09:16";
    }
  }

  dayExtras() {
    const ex = super.dayExtras();
    const chart = ex.charts && ex.charts[0];
    if (chart && this.refLine !== null) {
      chart.levels = [...(chart.levels || []), { name: "09:16 reference line", value: round(this.refLine), color: "#7048e8", dash: true }];
    }
    return { ...ex, referenceLine: this.refLine === null ? null : round(this.refLine) };
  }

  // ---------- orders ----------

  enter(side, candle, why) {
    const atm = Math.round(candle.close / STRIKE_STEP) * STRIKE_STEP;
    const strike = side === "CE" ? atm - ITM_POINTS : atm + ITM_POINTS;
    const bar = this.optionBar(side, strike, this.now);
    if (!bar) {
      this.log("SKIP", `${side} ${strike} has no option price at ${this.now}, entry skipped`, { side, strike });
      return false;
    }
    if (!this.legs[side].strikesUsed.includes(strike)) this.legs[side].strikesUsed.push(strike);
    const lots = LOT_LADDER[this.entries % LOT_LADDER.length];
    this.entries += 1;
    this.pos = {
      side, strike, entry: bar[0], entryTime: this.now, lots, left: lots, booked: false, why, entryNo: this.entries,
      stAtEntry: this.curSt,
      setup: { side: side === "CE" ? "BUY" : "SELL" },
    };
    this.ltp = bar[0];
    this.log("ENTRY", `BUY ${side} ${strike} @ ${bar[0].toFixed(2)} x ${lots} lots | ${why}`, { side, strike, price: round(bar[0]), lot: lots });
    return true;
  }

  /** closes `lots` of the open position at `price`; a full close ends the position */
  close(lots, price, reason, kind) {
    const p = this.pos;
    const qty = LOTSIZE * lots;
    const pnl = (price - p.entry) * qty;
    this.legs[p.side].pnl += pnl;
    this.realized += pnl;
    this.trades.push({
      side: p.side,
      strike: p.strike,
      strikeType: "ITM4",
      lot: lots,
      quantity: qty,
      entryLots: p.lots,
      entryNo: p.entryNo,
      entryTime: p.entryTime,
      entryPrice: round(p.entry),
      exitTime: this.now,
      exitPrice: round(price),
      pivot: `ST_${p.side}`,
      signalType: p.setup.side,
      entryReason: p.why,
      exitReason: reason,
      exitType: kind,
      points: round(price - p.entry),
      pnl: round(pnl),
      sidePnlAfter: round(this.legs[p.side].pnl),
      dayPnlAfter: round(this.realized),
      supertrendAtEntry: p.stAtEntry || null,
      supertrendAtExit: this.curSt,
    });
    this.log("EXIT", `EXIT ${p.side} ${p.strike} x ${lots} lots @ ${price.toFixed(2)} | ${reason} | ${pnl.toFixed(0)} | day ${this.realized.toFixed(0)}`, {
      side: p.side, strike: p.strike, price: round(price), pnl: round(pnl), exitType: kind,
    });
    p.left -= lots;
    if (p.left <= 0) this.pos = null;
  }

  /** the base day loop (square-off, day limits) closes whatever is left through this */
  exit(price, reason, kind) {
    this.close(this.pos.left, price, reason, kind);
  }

  bookHalf(price) {
    const p = this.pos;
    const lots = Math.floor(p.lots / 2);
    p.booked = true;
    this.close(lots, price, `Trade profit reached Rs ${BOOK_AT}: ${lots} of ${p.lots} lots booked, the rest ride`, "PARTIAL_TARGET");
  }

  /** price levels (for the open position) where something happens next: [{ price, kind }] */
  levels() {
    const p = this.pos;
    const r = this.rules;
    const out = [];
    if (!p.booked) out.push({ price: p.entry + BOOK_AT / (LOTSIZE * p.lots), kind: "book" });
    const qty = LOTSIZE * p.left;
    if (r.dayMaxLoss !== null) out.push({ price: p.entry + (r.dayMaxLoss - this.realized) / qty, kind: "sl" });
    if (r.dayTarget !== null) out.push({ price: p.entry + (r.dayTarget - this.realized) / qty, kind: "target" });
    return out;
  }

  /** the option trades at `price`: book half / day limits */
  atPrice(price) {
    const p = this.pos;
    if (!p) return;
    if (!p.booked && (price - p.entry) * LOTSIZE * p.lots >= BOOK_AT - EPS) {
      this.bookHalf(price);
      if (!this.pos) return;
    }
    const r = this.rules;
    const run = this.realized + (price - this.pos.entry) * LOTSIZE * this.pos.left;
    if (r.dayMaxLoss !== null && run <= r.dayMaxLoss + EPS) {
      this.close(this.pos.left, price, `Day MTM ${run.toFixed(0)} hit the day SL ${r.dayMaxLoss}`, "DAY_SL");
      this.stopDay("DAY MTM SL", run);
    } else if (r.dayTarget !== null && run >= r.dayTarget - EPS) {
      this.close(this.pos.left, price, `Day MTM ${run.toFixed(0)} hit the day target ${r.dayTarget}`, "DAY_TARGET");
      this.stopDay("DAY MTM TARGET", run);
    }
  }

  /** option ticks of one 1-min bar: the levels are hit at their exact price, in the order of the price path */
  walkBar(bar) {
    const [o, h, l, c] = bar;
    const path = c >= o ? [o, l, h, c] : [o, h, l, c];
    this.ltp = o;
    this.atPrice(o);
    for (let i = 0; i < path.length - 1 && this.pos; i++) {
      let a = path[i];
      const b = path[i + 1];
      for (let guard = 0; guard < 6 && this.pos; guard++) {
        const hit = this.levels()
          .filter((lv) => (b > a ? lv.price > a && lv.price < b : lv.price < a && lv.price > b))
          .sort((x, y) => (b > a ? x.price - y.price : y.price - x.price))[0];
        if (!hit) break;
        this.ltp = hit.price;
        this.atPrice(hit.price);
        a = hit.price;
      }
      if (!this.pos) return;
      this.ltp = b;
      this.atPrice(b);
    }
  }

  // ---------- signals (one call per completed candle) ----------

  onCandle(i, all, e5, e10, row) {
    const c = all[i];
    const dir = this.stDir[i];
    const prevDir = this.stDir[i - 1];
    this.curSt = dir === null ? null : { trend: dir === -1 ? "buy" : "sell", value: round(this.stVal[i]) };

    // what is left of the position rides until the Supertrend turns against it
    if (this.pos) {
      const ce = this.pos.side === "CE";
      const against = ce ? prevDir === -1 && dir === 1 : prevDir === 1 && dir === -1;
      if (against) {
        const full = this.pos.booked ? "the remaining lots" : "the whole position";
        this.close(this.pos.left, this.turnExitPrice(this.pos.side, this.pos.strike), `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) turned ${dir === 1 ? "bearish" : "bullish"}: exit of ${full}`, "SUPERTREND");
      }
    }
    if (this.dayStoppedBy || this.pos || this.now >= TRADE_END) return;
    if (dir === null || e5[i] === undefined) return;

    const first = this.entries === 0;
    const ref = this.refLine;
    if (first && ref === null) return;
    const ceOk = dir === -1 && e5[i] > e10[i] && (!first || c.close > ref);
    const peOk = dir === 1 && e10[i] > e5[i] && (!first || c.close < ref);
    const side = ceOk ? "CE" : peOk ? "PE" : null;
    if (!side) return;
    const ce = side === "CE";
    const why =
      `${c.start}-${c.end} candle closed ${round(c.close)}` +
      (first ? ` ${ce ? "above" : "below"} the ${this.refTime} line ${round(ref)}, ` : ", ") +
      `Supertrend ${ce ? "BUY" : "SELL"}, EMA${FAST} ${round(e5[i], 2)} ${ce ? "above" : "below"} EMA${SLOW} ${round(e10[i], 2)}` +
      (first ? " (first entry of the day)" : "");
    this.enter(side, c, why);
  }
}

// =========================
// RUNNER
// =========================

export async function runNiftySupertrendEmaBuying1minBacktest(input) {
  const rules = st1mRules(input.options);

  const assemble = (run) => {
    for (const d of run.days.filter((x) => x.status === "ok")) {
      d.supertrendExits = d.trades.filter((t) => t.exitType === "SUPERTREND").length;
      d.partials = d.trades.filter((t) => t.exitType === "PARTIAL_TARGET").length;
      d.targets = d.trades.filter((t) => t.exitType === "DAY_TARGET").length;
      d.stopLosses = d.trades.filter((t) => t.exitType === "DAY_SL").length;
      d.entries = new Set(d.trades.map((t) => t.entryNo)).size;
      d.maxLot = Math.max(0, ...d.trades.map((t) => t.entryLots || 0));
      if (input.slim) delete d.emaCandles;
    }

    const sum = summarize(run.days, LOT_LADDER.join(" / "));
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
        const entries = new Set(trades.map((t) => `${t.entryNo}|${t.entryTime}|${t.side}|${t.strike}`)).size;
        const parts = [`${by("SUPERTREND").length} closed by the Supertrend turning (net ${net(by("SUPERTREND"))})`];
        if (by("PARTIAL_TARGET").length) parts.push(`${by("PARTIAL_TARGET").length} half-bookings at Rs ${BOOK_AT} (net ${net(by("PARTIAL_TARGET"))})`);
        if (by("DAY_TARGET").length) parts.push(`${by("DAY_TARGET").length} by the day target (net ${net(by("DAY_TARGET"))})`);
        if (by("DAY_SL").length) parts.push(`${by("DAY_SL").length} by the day SL (net ${net(by("DAY_SL"))})`);
        parts.push(`${by("FORCE").length} squared off at ${TRADE_END} (net ${net(by("FORCE"))})`);
        analysis.push(`${entries} entries, ${trades.length} exit rows (a half-booked entry has two): ${parts.join(", ")}.`);
        const ce = trades.filter((t) => t.side === "CE");
        const pe = trades.filter((t) => t.side === "PE");
        analysis.push(`CE: ${ce.length} exit rows, net ${net(ce)}. PE: ${pe.length} exit rows, net ${net(pe)}.`);
      }
      analysis.push(...tail.filter((x) => !x.startsWith("Best pivot")));
    }

    return {
      success: run.success,
      strategy: "nifty_supertrend_ema_buying_1min",
      params: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        lotSize: LOTSIZE,
        lots: LOT_LADDER.join(" / "),
        indicator: `EMA ${FAST}, EMA ${SLOW} and Supertrend (${ST_PERIOD}, ${ST_FACTOR}) on NIFTY ${rules.timeframe}-min candles, previous days loaded so they are warmed up`,
        candleMinutes: rules.timeframe,
        strike: `${ITM_POINTS} points in the money from the signal candle close (ATM = nearest ${STRIKE_STEP}), nearest weekly expiry`,
        entry:
          "first entry: close beyond the 09:16 reference line (first 1-min close) + Supertrend and EMA order on the same side; later entries: Supertrend direction and EMA order agree",
        exit: `Rs ${BOOK_AT} trade profit books half the lots, the rest ride until the Supertrend turns against the trade; before Rs ${BOOK_AT} a turn exits everything`,
        lotLadder: `lots alternate over the entries of the day: ${LOT_LADDER.join(", ")}, ${LOT_LADDER.join(", ")} ...`,
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

  const run = await runDays(input, St1mDaySim, "supertrend ema 1min", { assemble });
  const out = assemble(run);
  if (run.cancelled) out.cancelled = true;
  if (input.onUpdate) input.onUpdate({ result: out, progress: { done: run.doneDays, total: run.totalDays, date: null } });
  return out;
}
