/**
 * BACKTEST — pivot_option_buying_cum  (pivot_cumulative_option_buying)
 *
 * The cumulative pivot strategy of backtest.service.js (DaySim) with three inputs and date-range runs:
 *   - timeframe 1 / 3 / 5 / 15 min: the option candles the "candle close" rules read (entry on a candle close above the
 *     armed pivot, stop loss on a candle close below it). The candles are built from the contract's 1-minute bars,
 *     aligned to 09:15, only from the bars since the contract was selected. All tick rules (pivot touch, pivot + 12
 *     entry, pivot - 8 stop, side target, strike change) still run on the 1-minute price path.
 *   - day MTM target / day MTM SL, each switched on or off: realised + running P&L of both sides. When one is hit
 *     everything is closed at that exact level and nothing more is traded that day.
 * With the defaults (1 min, SL on at 13,000, target off) the result is the same as before.
 */

import { BacktestError, DaySim, buildSummary } from "./backtest.service.js";
import { runDays } from "./backtestRunner.js";
import { optionTradeCharts } from "./charts.js";

const TF_MINUTES = [1, 3, 5, 15];

export const CUM_DEFAULTS = {
  timeframe: 1,
  dayTarget: { enabled: false, value: 5000 },
  daySl: { enabled: true, value: 13000 },
};

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** request body "options" -> rules; throws BacktestError(400) with a list of messages */
export function cumRules(raw = {}) {
  const o = raw && typeof raw === "object" ? raw : {};
  const errors = [];
  const timeframe = o.timeframe === undefined ? CUM_DEFAULTS.timeframe : Number(o.timeframe);
  if (!TF_MINUTES.includes(timeframe)) errors.push("options.timeframe must be 1, 3, 5 or 15 (minutes)");
  const limit = (name) => {
    const v = o[name] === undefined ? CUM_DEFAULTS[name] : o[name];
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
  return { timeframe, dayTarget, dayMaxLoss: daySl === null ? null : -daySl };
}

export const validateCumOptions = (options) => {
  cumRules(options);
};

class PivotCumDaySim extends DaySim {
  constructor(day, todayData, prevData, index, ctx) {
    super(day, todayData, prevData);
    this.rules = cumRules(ctx?.options);
    this.dayMaxLoss = this.rules.dayMaxLoss;
    this.dayTarget = this.rules.dayTarget;
  }

  applyContract(leg, sel) {
    super.applyContract(leg, sel);
    leg.bucket = null; // candle being built for the new contract
  }

  /** 1-min bar of the current minute: the first tick of a new candle closes the previous candle */
  runBar(leg, bar) {
    const [o, h, l, c] = bar;
    const tf = this.rules.timeframe;
    const k = Math.floor((toMin(this.now) - toMin("09:15")) / tf);
    let candle = null;
    const b = leg.bucket;
    if (b && b.k !== k) {
      candle = [b.o, b.h, b.l, b.c];
      leg.bucket = null;
    }
    leg.bucket = leg.bucket ? { k, o: leg.bucket.o, h: Math.max(leg.bucket.h, h), l: Math.min(leg.bucket.l, l), c } : { k, o, h, l, c };
    this.onTick(leg, o, candle);
    const p = c >= o ? [o, l, h, c] : [o, h, l, c];
    for (let i = 0; i < p.length - 1; i++) this.walk(leg, p[i], p[i + 1]);
  }

  dayExtras() {
    return { charts: optionTradeCharts(this.data, this.trades, this.rules.timeframe) };
  }
}

export async function runPivotOptionBuyingCumRangeBacktest(input) {
  const rules = cumRules(input.options);

  const assemble = (run) => {
    const { summary, analysis } = buildSummary(run.days);
    const ok = run.days.filter((d) => d.status === "ok");
    return {
      success: run.success,
      strategy: "nifty_option_buying_pivot_cum_ltp",
      params: {
        fromDate: input.fromDate,
        toDate: input.toDate,
        lotSize: 65,
        baseLot: 2,
        maxLot: 15,
        lotStepEverySl: 2,
        candleMinutes: rules.timeframe,
        dayTarget: rules.dayTarget,
        dayMaxLoss: rules.dayMaxLoss,
        sideTargetStep: 50 * 65,
        slBuffer: 8,
        tickEntryPoints: 12,
        tradeWindow: ["09:17", "15:14"],
      },
      summary: ok.length ? summary : null,
      analysis: ok.length ? analysis : ["No traded days in this range."],
      days: run.days,
      errors: run.errors,
      logs: run.logs,
      meta: run.meta,
    };
  };

  const run = await runDays(input, PivotCumDaySim, "pivot cumulative", { assemble });
  const out = assemble(run);
  if (run.cancelled) out.cancelled = true;
  if (input.onUpdate) input.onUpdate({ result: out, progress: { done: run.doneDays, total: run.totalDays, date: null } });
  return out;
}
