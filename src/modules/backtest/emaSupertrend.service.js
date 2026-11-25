/**
 * BACKTEST — nifty_ema_supertrend_option_buying
 *
 * Strategy 1 (EMA 5 / EMA 10 crossover + retest, see emaRetest.service.js) with a mandatory Supertrend filter
 * and a different exit. Signals come from the NIFTY index chart, trades are NIFTY options, 1 lot, one at a time.
 *   - indicators on 1 / 3 / 5 / 15-min NIFTY candles (aligned to 09:15), running over the previous trading days
 *     + today without a break: EMA 5, EMA 10 and Supertrend (ATR 10, factor 1.5)
 *   - BUY setup (-> buy CE):
 *       1. EMA 5 crosses above EMA 10 (read on a candle close)
 *       2. a LATER candle closes above EMA 10 while the Supertrend is bullish (confirmation, no entry yet)
 *       3. a LATER candle retests EMA 5 (its low reaches EMA 5) while the Supertrend is still bullish -> entry
 *     SELL setup (-> buy PE): mirrored (cross below, close below EMA 10 with a bearish Supertrend, the
 *     candle's high reaches EMA 5 with the Supertrend still bearish).
 *   - if the Supertrend turns against an unfinished setup before the entry, the setup goes back to step 2
 *     (a new confirming close with the Supertrend on its side is needed); a new crossover in the other
 *     direction replaces the setup
 *   - entry is filled at the first option tick after the retest candle closes
 *   - stop loss and target are the same thing: the Supertrend changing direction against the trade
 *     (BUY: bullish -> bearish, SELL: bearish -> bullish), read on the candle close, filled at the next tick;
 *     the EMA crossover itself no longer exits
 *   - optional day MTM target / day MTM SL (realised + open P&L), strike ATM / ITM1..ITM4, square off 15:14
 */

import { round, TRADE_END, LOTSIZE } from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";
import { EmaDaySim, emaRules, validateEmaOptions } from "./emaRetest.service.js";
import { newSt, stStep } from "./supertrend.js";

const FAST = 5;
const SLOW = 10;
const ST_PERIOD = 10;
const ST_FACTOR = 1.5;
const LOTS = 1;
const STEP = 50;

const strikeLabel = (n) => (n === 0 ? "ATM" : `ITM${n}`);
const trendOf = (dir) => (dir === null || dir === undefined ? null : dir === -1 ? "buy" : "sell");

export class EmaStDaySim extends EmaDaySim {
  prepare(all) {
    const st = newSt();
    this.stDir = [];
    this.stVal = [];
    for (const c of all) {
      const r = stStep(st, c, ST_PERIOD, ST_FACTOR);
      this.stDir.push(r.dir);
      this.stVal.push(r.value);
    }
    this.curSt = null;
  }

  decorateRows(rows, base) {
    rows.forEach((r, j) => {
      const i = base + j;
      r.supertrend = this.stVal[i] === null ? null : round(this.stVal[i], 3);
      r.trend = trendOf(this.stDir[i]);
      const p = this.stDir[i - 1];
      r.stFlip = p !== null && p !== undefined && this.stDir[i] !== null && p !== this.stDir[i] ? (this.stDir[i] === 1 ? "to sell" : "to buy") : null;
    });
  }

  /** is this candle the retest that triggers the entry? (strategy 2: it touches EMA 5) */
  retestHit(buy, c, ema5) {
    return buy ? c.low <= ema5 : c.high >= ema5;
  }

  /** label shown on the retest candle */
  get retestLabel() {
    return "retest";
  }

  /** price an exit on a Supertrend turn is filled at (strategy 2: the next tick) */
  turnExitPrice(side, strike) {
    const bar = this.optionBar(side, strike, this.now);
    return bar ? bar[0] : this.ltp;
  }

  enter(setup, candle, ema5) {
    const ok = super.enter(setup, candle, ema5);
    if (ok && this.pos) {
      this.pos.stAtEntry = this.curSt;
      this.pos.retest.supertrendLine = this.curSt ? this.curSt.value : null;
    }
    return ok;
  }

  exit(price, reason, kind) {
    const p = this.pos;
    super.exit(price, reason, kind);
    const t = this.trades[this.trades.length - 1];
    t.supertrendAtEntry = p.stAtEntry || null;
    t.supertrendAtExit = this.curSt;
  }

  onCandle(i, all, e5, e10, row) {
    const c = all[i];
    const dir = this.stDir[i];
    const prevDir = this.stDir[i - 1];
    this.curSt = dir === null ? null : { trend: trendOf(dir), value: round(this.stVal[i]) };
    const crossUp = e5[i] > e10[i] && e5[i - 1] <= e10[i - 1];
    const crossDown = e5[i] < e10[i] && e5[i - 1] >= e10[i - 1];
    if (crossUp) row.cross = "EMA5 above EMA10";
    if (crossDown) row.cross = "EMA5 below EMA10";

    // stop loss = target = the Supertrend turning against the trade
    if (this.pos) {
      const buy = this.pos.setup.side === "BUY";
      const against = buy ? prevDir === -1 && dir === 1 : prevDir === 1 && dir === -1;
      if (against) {
        this.exit(this.turnExitPrice(this.pos.side, this.pos.strike), `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) turned ${dir === 1 ? "bearish" : "bullish"}`, "SUPERTREND");
      }
    }
    if (this.dayStoppedBy) return;

    // a crossover starts a new setup (setups are tracked while a trade is open, entries only when flat)
    if (crossUp || crossDown) {
      if (this.setup) this.log("SETUP", `${this.setup.side} setup from ${this.setup.crossTime} replaced by the new crossover`);
      this.setup = { side: crossUp ? "BUY" : "SELL", stage: "CONFIRM", crossTime: c.end, crossIdx: i };
      this.log("CROSS", `EMA${FAST} crossed ${crossUp ? "above" : "below"} EMA${SLOW} on the ${c.start}-${c.end} candle — waiting for a candle to close ${crossUp ? "above" : "below"} EMA${SLOW} with the Supertrend ${crossUp ? "bullish" : "bearish"}`);
      return;
    }

    const s = this.setup;
    if (!s || i === s.crossIdx) return;
    const buy = s.side === "BUY";
    const supports = buy ? dir === -1 : dir === 1;

    if (s.stage === "CONFIRM") {
      const closeOk = buy ? c.close > e10[i] : c.close < e10[i];
      if (closeOk && supports) {
        s.stage = "RETEST";
        s.confirmIdx = i;
        s.confirmTime = c.end;
        row.setup = "confirmed";
        this.log("CONFIRM", `${s.side}: ${c.start}-${c.end} candle closed ${buy ? "above" : "below"} EMA${SLOW} (${round(c.close)} vs ${round(e10[i], 2)}) with the Supertrend ${trendOf(dir)} — waiting for the EMA${FAST} retest`);
      }
      return;
    }

    // RETEST stage: the Supertrend has to keep supporting the setup
    if (!supports) {
      s.stage = "CONFIRM";
      row.setup = "supertrend against";
      this.log("SETUP", `${s.side}: Supertrend no longer ${buy ? "bullish" : "bearish"} on the ${c.start}-${c.end} candle — back to waiting for a confirming close`);
      return;
    }
    if (i > s.confirmIdx) {
      if (this.retestHit(buy, c, e5[i], i)) {
        row.setup = this.retestLabel;
        if (this.pos || this.now >= TRADE_END) return; // no second trade while one is open
        this.setup = null;
        this.enter(s, c, e5[i]);
      }
    }
  }
}

// =========================
// RUNNER
// =========================

export { validateEmaOptions as validateEmaStOptions };

export const runNiftyEmaSupertrendBacktest = (input) =>
  runEmaStFamily(input, {
    strategy: "nifty_ema_supertrend_option_buying",
    Sim: EmaStDaySim,
    label: "ema supertrend",
    entry: (r) => `EMA${FAST} crossover -> a later candle closes beyond EMA${SLOW} with the Supertrend on its side -> a later candle retests EMA${FAST} with the Supertrend still on its side -> entry at the next tick`,
    exit: `Supertrend (${ST_PERIOD}, ${ST_FACTOR}) turning against the trade, read on the candle close (stop loss and target are the same)`,
  });

/** shared by the Supertrend strategies: day loop, report, analysis */
export async function runEmaStFamily(input, cfg) {
  const rules = emaRules(input.options);

  const assemble = (run) => {
    for (const d of run.days.filter((x) => x.status === "ok")) {
      d.supertrendExits = d.trades.filter((t) => t.exitType === "SUPERTREND").length;
      d.targets = d.trades.filter((t) => t.exitType === "DAY_TARGET").length;
      d.stopLosses = d.trades.filter((t) => t.exitType === "DAY_SL").length;
      if (input.slim) delete d.emaCandles;
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
        const st = by("SUPERTREND");
        const parts = [`${st.length} closed by the Supertrend turning (net ${net(st)}, ${st.filter((t) => t.pnl > 0).length} of them in profit)`];
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
      strategy: cfg.strategy,
      params: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        lotSize: LOTSIZE,
        lots: LOTS,
        indicator: `EMA ${FAST}, EMA ${SLOW} and Supertrend (${ST_PERIOD}, ${ST_FACTOR}) on NIFTY ${rules.timeframe}-min candles, previous days loaded so they are warmed up`,
        candleMinutes: rules.timeframe,
        strike: `${strikeLabel(rules.strikeOffset)} from the signal candle close (ATM = nearest ${STEP}), nearest weekly expiry`,
        entry: cfg.entry(rules),
        exit: cfg.exit,
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

  const run = await runDays(input, cfg.Sim, cfg.label, { assemble });
  const out = assemble(run);
  if (run.cancelled) out.cancelled = true;
  if (input.onUpdate) input.onUpdate({ result: out, progress: { done: run.doneDays, total: run.totalDays, date: null } });
  return out;
}
