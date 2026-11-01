/**
 * BACKTEST — nifty_option_pivot_fixed_target (Option pivot, fixed +10)
 *
 * NIFTY CE + PE option buying, two independent legs. Same as pivot_cum except
 * sizing and exits:
 *   - 09:17 selection, strike change (flat, LTP > 280 / < 170), previous-day
 *     pivots (S3..R3) and pivot touch-arming: same as pivot_cum
 *   - entry (1 lot, always the same size), whichever comes first:
 *       * 1-min candle closes above the armed pivot with
 *         pivot < OHLC average < close              -> buy at the next tick
 *       * any tick >= armed pivot + 8                 -> buy at that tick
 *   - exit:
 *       * any tick >= entry + 10 points               (TARGET)
 *       * 1-min candle closes below the entry pivot   (SL)
 *   - every new entry needs a fresh pivot touch (after target and after SL)
 *   - no daily profit / loss limit, everything closed at 15:14
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

const TARGET_POINTS = 10;      // fixed target above entry
const TICK_ENTRY_POINTS = 8;   // after a pivot touch: any tick >= pivot + 8 -> entry
const LOTS = 1;

// =========================
// ONE DAY SIMULATION
// =========================

class PivotFixedTargetDaySim extends DaySim {
  initLeg(name) {
    return { ...super.initLeg(name), lot: LOTS, maxLot: LOTS, target: null };
  }

  enterPosition(leg, price, pivot, reason = null) {
    leg.target = round(price + TARGET_POINTS, 2);
    super.enterPosition(leg, price, pivot, reason);
  }

  exitPosition(leg, price, reason, kind) {
    const tradePnl = (price - leg.entryPrice) * LOTSIZE * leg.lot;
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
      pivot: `${leg.entryPivot[0]} ${leg.entryPivot[1]}`,
      target: leg.target,
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
    leg.target = null;

    // fresh pivot touch required after every exit
    leg.armedPivot = null;
  }

  // ---------- strategy ----------

  checkTickExits(leg, ltp) {
    if (ltp >= leg.target - 1e-9) {
      this.exitPosition(leg, ltp, `Tick ${ltp.toFixed(2)} >= target ${leg.target} (entry + ${TARGET_POINTS})`, "TARGET");
      return true;
    }
    return false;
  }

  checkTickEntry(leg, ltp) {
    const pivot = leg.armedPivot;
    if (!pivot || !this.inTradeWindow()) return false;
    if (ltp >= pivot[1] + TICK_ENTRY_POINTS - 1e-9) {
      this.enterPosition(leg, ltp, pivot, `Tick >= ${pivot[0]} ${pivot[1]} + ${TICK_ENTRY_POINTS}`);
      return true;
    }
    return false;
  }

  // no daily profit / loss limit in this strategy
  checkMtm() {}

  levelCandidates(leg) {
    const lv = leg.levels.map((x) => x[1]);
    if (leg.position) {
      lv.push(leg.target);
    } else {
      if (leg.armedPivot) lv.push(leg.armedPivot[1] + TICK_ENTRY_POINTS);
      lv.push(ROLL_UPPER + TICK_EPS);
      lv.push(ROLL_LOWER - TICK_EPS);
    }
    return lv;
  }
}

// =========================
// RUNNER
// =========================

export async function runNiftyOptionPivotFixedTargetBacktest(input) {
  const run = await runDays(input, PivotFixedTargetDaySim, "pivot fixed target");
  const sum = summarize(run.days, LOTS);

  let analysis = ["No traded days in this range."];
  if (sum) {
    const { summary, trades, head, tail } = sum;
    analysis = [...head];
    if (trades.length) {
      const tickEntries = trades.filter((t) => t.entryReason.startsWith("Tick")).length;
      analysis.push(`${trades.length} trades, ${summary.winRatePct}% hit the +${TARGET_POINTS} target ` +
        `(avg win ${inr(summary.avgWin)} vs avg loss ${inr(summary.avgLoss)}). The only stop is a candle close below the pivot, ` +
        `so a loss can be bigger than the fixed ${TARGET_POINTS}-point win.`);
      analysis.push(`${tickEntries} of ${trades.length} entries came from the pivot + ${TICK_ENTRY_POINTS} tick rule, ` +
        `${trades.length - tickEntries} from the candle-close rule.`);
    }
    analysis.push(...tail);
  }

  return {
    success: run.success,
    strategy: "nifty_option_pivot_fixed_target",
    params: {
      fromDate: input.fromDate,
      toDate: input.toDate,
      lotSize: LOTSIZE,
      lots: LOTS,
      targetLtp: TARGET_LTP,
      rollRange: [ROLL_LOWER, ROLL_UPPER],
      pickRange: [PICK_MIN, PICK_MAX],
      targetPoints: TARGET_POINTS,
      tickEntryPoints: TICK_ENTRY_POINTS,
      stopLoss: "1-min candle close below the entry pivot",
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
