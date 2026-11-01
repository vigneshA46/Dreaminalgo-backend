/**
 * BACKTEST — nifty_option_pivot_buffer (Option pivot buffer)
 *
 * NIFTY CE + PE option buying, two independent legs, everything tick based.
 *   - 09:17: CE and PE strikes priced nearest ₹180, pivots (S3..R3) from each
 *     option's own previous-day H / L / C            (same as pivot_cum)
 *   - a tick touching a pivot ARMS it; gap = next pivot above - armed pivot
 *       buffer = pivot + 25% of gap   -> any tick >= buffer: BUY 1 lot
 *       target = entry + 30% of gap   -> any tick >= target: exit (TARGET)
 *       SL     = tick back at the armed pivot          -> exit (SL)
 *   - after an SL the pivot stays armed (re-entry when the buffer is hit again);
 *     after a TARGET a fresh pivot touch is needed
 *   - top pivot (no pivot above it) never gives an entry
 *   - strike change when flat and LTP > 280 / < 170   (same as pivot_cum)
 *   - no daily profit / loss limit, everything closed at 15:14
 *
 * Data, tick path, strike selection and strike change are shared with
 * backtest.service.js (Dhan expired options 1-min data, O-L-H-C / O-H-L-C path).
 */

import {
  round,
  DaySim,
  LOTSIZE,
  TRADE_START,
  TRADE_END,
  TARGET_LTP,
  ROLL_LOWER,
  ROLL_UPPER,
  PICK_MIN,
  PICK_MAX,
  TICK_EPS,
} from "./backtest.service.js";
import { runDays, summarize, inr } from "./backtestRunner.js";

// =========================
// CONFIG
// =========================

const BUFFER_PCT = 0.25;   // entry buffer above the armed pivot (share of the pivot gap)
const TARGET_PCT = 0.30;   // target above the entry price (share of the pivot gap)
const LOTS = 1;

// =========================
// ONE DAY SIMULATION
// =========================

class PivotBufferDaySim extends DaySim {
  initLeg(name) {
    return {
      ...super.initLeg(name),
      lot: LOTS,
      maxLot: LOTS,
      armed: null,          // { name, value, next, nextValue, gap, buffer } of the last touched pivot
      entryArm: null,       // armed pivot the open trade was taken from
      target: null,
    };
  }

  applyContract(leg, sel) {
    super.applyContract(leg, sel);
    leg.armed = null;
  }

  // ---------- pivots ----------

  arm(leg, level) {
    const idx = leg.levels.findIndex((lv) => lv[0] === level[0] && lv[1] === level[1]);
    const next = leg.levels[idx + 1] || null;
    if (leg.armed && leg.armed.name === level[0] && leg.armed.value === level[1]) return;
    const gap = next ? next[1] - level[1] : null;
    leg.armed = {
      name: level[0],
      value: level[1],
      next: next ? next[0] : null,
      nextValue: next ? next[1] : null,
      gap: gap === null ? null : round(gap, 2),
      buffer: gap === null ? null : round(level[1] + BUFFER_PCT * gap, 2),
    };
    this.log(
      "ARM",
      next
        ? `${leg.name} touched ${level[0]} ${level[1]} -> buffer ${leg.armed.buffer} (gap to ${next[0]} ${next[1]} = ${leg.armed.gap})`
        : `${leg.name} touched ${level[0]} ${level[1]} (top pivot, no entry)`,
      { side: leg.name, pivot: level[0], value: level[1], buffer: leg.armed.buffer }
    );
  }

  updateTouch(leg, ltp) {
    const prev = leg.prevLtp;
    if (prev === null) return;
    const lo = Math.min(prev, ltp);
    const hi = Math.max(prev, ltp);
    const crossed = leg.levels.filter((lv) => lo <= lv[1] && lv[1] <= hi);
    if (!crossed.length) return;
    const level = crossed.reduce((best, lv) => (Math.abs(lv[1] - ltp) < Math.abs(best[1] - ltp) ? lv : best), crossed[0]);
    this.arm(leg, level);
  }

  // ---------- orders ----------

  enterPosition(leg, price) {
    const a = leg.armed;
    leg.position = true;
    leg.entryPrice = price;
    leg.entryTime = this.now;
    leg.entryArm = a;
    leg.entryPivot = [a.name, a.value];
    leg.target = round(price + TARGET_PCT * a.gap, 2);
    leg.entryReason = `Tick >= buffer ${a.buffer} (${a.name} ${a.value} + 25% of ${a.gap})`;
    this.log("ENTRY", `BUY ${leg.name} ${leg.strike} @ ${price.toFixed(2)} lot ${leg.lot} | target ${leg.target} | SL ${a.value}`, {
      side: leg.name, strike: leg.strike, price: round(price), lot: leg.lot, target: leg.target, sl: a.value,
    });
  }

  exitPosition(leg, price, reason, kind) {
    const tradePnl = (price - leg.entryPrice) * LOTSIZE * leg.lot;
    const a = leg.entryArm;
    leg.pnl += tradePnl;
    this.trades.push({
      side: leg.name,
      strike: leg.strike,
      lot: leg.lot,
      quantity: leg.lot * LOTSIZE,
      entryTime: leg.entryTime,
      entryPrice: round(leg.entryPrice),
      exitTime: this.now,
      exitPrice: round(price),
      pivot: `${a.name} ${a.value}`,
      nextPivot: `${a.next} ${a.nextValue}`,
      gap: a.gap,
      buffer: a.buffer,
      target: leg.target,
      stopLoss: a.value,
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
    leg.entryPivot = null;
    leg.entryArm = null;
    leg.target = null;

    // TARGET -> fresh pivot touch needed; SL -> pivot stays armed, re-entry on the buffer again
    if (kind === "TARGET") leg.armed = null;
  }

  // ---------- strategy (all tick based) ----------

  checkTickExits(leg, ltp) {
    if (ltp >= leg.target - 1e-9) {
      this.exitPosition(leg, ltp, `Tick ${ltp.toFixed(2)} >= target ${leg.target} (entry + 30% of ${leg.entryArm.gap})`, "TARGET");
      return true;
    }
    const pivot = leg.entryArm;
    if (ltp <= pivot.value + 1e-9) {
      this.exitPosition(leg, ltp, `Tick ${ltp.toFixed(2)} back at ${pivot.name} ${pivot.value}`, "SL");
      return true;
    }
    return false;
  }

  checkTickEntry(leg, ltp) {
    const a = leg.armed;
    if (!a || a.buffer === null || !this.inTradeWindow()) return false;
    if (ltp >= a.buffer - 1e-9) {
      this.enterPosition(leg, ltp);
      return true;
    }
    return false;
  }

  onTick(leg, ltp) {
    leg.ltp = ltp;

    // ---- TIME EXIT ----
    if (this.now >= TRADE_END) {
      this.squareOffAll("TIME EXIT 15:14");
      return;
    }

    if (leg.tradingDisabled || leg.rolling) {
      leg.prevLtp = ltp;
      return;
    }

    let exited = false;

    // ---- TARGET / PIVOT SL ----
    if (leg.position) exited = this.checkTickExits(leg, ltp);

    // ---- PIVOT TOUCH (flat, not on the exit tick) ----
    if (!leg.position && !exited) this.updateTouch(leg, ltp);

    // ---- BUFFER ENTRY ----
    if (!leg.position && !exited) this.checkTickEntry(leg, ltp);

    leg.prevLtp = ltp;

    // ---- STRIKE CHANGE (only when flat: > 280 or < 170) ----
    if (!leg.position && this.inTradeWindow()) {
      const trigger = DaySim.rollTrigger(ltp);
      if (trigger) this.startRoll(leg, trigger);
    }
  }

  levelCandidates(leg) {
    const lv = leg.levels.map((x) => x[1]);
    if (leg.position) {
      lv.push(leg.target, leg.entryArm.value);
    } else {
      if (leg.armed?.buffer) lv.push(leg.armed.buffer);
      lv.push(ROLL_UPPER + TICK_EPS);
      lv.push(ROLL_LOWER - TICK_EPS);
    }
    return lv;
  }

  runBar(leg, bar) {
    const [o, h, l, c] = bar;
    this.onTick(leg, o);
    const p = c >= o ? [o, l, h, c] : [o, h, l, c];
    for (let i = 0; i < p.length - 1; i++) this.walk(leg, p[i], p[i + 1]);
  }
}

// =========================
// RUNNER
// =========================

export async function runNiftyOptionPivotBufferBacktest(input) {
  const run = await runDays(input, PivotBufferDaySim, "pivot buffer");
  const sum = summarize(run.days, LOTS);

  let analysis = ["No traded days in this range."];
  if (sum) {
    const { summary, trades, head, tail } = sum;
    analysis = [...head];
    if (trades.length) {
      analysis.push(`${trades.length} trades, ${summary.winRatePct}% hit the target. Target is 30% of the pivot gap above entry ` +
        `while the SL sits 25% of the gap below entry, so wins are slightly bigger than losses before any slippage ` +
        `(avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}).`);
    }
    analysis.push(...tail);
  }

  return {
    success: run.success,
    strategy: "nifty_option_pivot_buffer",
    params: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      lotSize: LOTSIZE,
      lots: LOTS,
      targetLtp: TARGET_LTP,
      rollRange: [ROLL_LOWER, ROLL_UPPER],
      pickRange: [PICK_MIN, PICK_MAX],
      bufferPctOfGap: BUFFER_PCT * 100,
      targetPctOfGap: TARGET_PCT * 100,
      stopLoss: "tick back at the armed pivot",
      tradeWindow: [TRADE_START, TRADE_END],
    },
    summary: sum?.summary || null,
    analysis,
    days: run.days,
    errors: run.errors,
    logs: run.logs,
    meta: run.meta,
  };
}
