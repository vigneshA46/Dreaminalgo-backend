import * as backtestService from "./backtest.service.js";
import * as pivotBufferService from "./pivotBuffer.service.js";
import * as pivotFixedTargetService from "./pivotFixedTarget.service.js";
import * as levelBreakoutService from "./levelBreakout.service.js";
import * as hourlyRangeService from "./hourlyRange.service.js";
import * as bearishBreakoutService from "./bearishBreakout.service.js";
import * as hullMaService from "./hullMa.service.js";
import * as emaRetestService from "./emaRetest.service.js";
import * as emaSupertrendService from "./emaSupertrend.service.js";
import * as emaRejectionService from "./emaSupertrendRejection.service.js";
import * as supertrendEma1minService from "./supertrendEma1min.service.js";
import { startJob, getJob, cancelJob, getJobCharts } from "./backtestJobs.js";

// same input checks, status codes and error shape for every backtest endpoint
const runBacktest = (runner) => async (req, res) => {
  let input;
  try {
    input = backtestService.validateBacktestInput(req.body);
  } catch (err) {
    return res.status(err.status || 400).json({
      success: false,
      message: err.message,
      errors: err.details || [err.message],
    });
  }

  try {
    const result = await runner(input);
    res.status(result.success ? 200 : 502).json(
      result.success ? result : { ...result, message: "Backtest failed for every trading day — see errors / logs" }
    );
  } catch (err) {
    const status = err instanceof backtestService.BacktestError ? err.status : 500;
    console.error("[backtest] failed:", err);
    res.status(status).json({
      success: false,
      message: err.message,
      // invalid strategy options come back as a list of messages
      errors: status === 400 && Array.isArray(err.details)
        ? err.details
        : [{ stage: "run", message: err.message, details: err.details?.dhanError || null }],
      logs: err.details?.logs || [],
    });
  }
};

// POST /api/backtest/pivot_option_buying_cum
export const pivotOptionBuyingCum = runBacktest(backtestService.runPivotOptionBuyingCumBacktest);

// POST /api/backtest/nifty_option_pivot_buffer
export const niftyOptionPivotBuffer = runBacktest(pivotBufferService.runNiftyOptionPivotBufferBacktest);

// POST /api/backtest/nifty_option_pivot_fixed_target
export const niftyOptionPivotFixedTarget = runBacktest(pivotFixedTargetService.runNiftyOptionPivotFixedTargetBacktest);

// POST /api/backtest/nifty_option_level_breakout
export const niftyOptionLevelBreakout = runBacktest(levelBreakoutService.runNiftyOptionLevelBreakoutBacktest);

// POST /api/backtest/nifty_hourly_range_touch
export const niftyHourlyRangeTouch = runBacktest(hourlyRangeService.runNiftyHourlyRangeTouchBacktest);

// POST /api/backtest/nifty_hourly_range_touch_1m
export const niftyHourlyRangeTouch1m = runBacktest(hourlyRangeService.runNiftyHourlyRangeTouch1mBacktest);

// POST /api/backtest/nifty_hourly_range_touch_custom   body adds: options { timeframe, daySl, cycleSl, dayProfit, cycleProfit }
export const niftyHourlyRangeTouchCustom = runBacktest(hourlyRangeService.runNiftyHourlyRangeTouchCustomBacktest);

// POST /api/backtest/nifty_bearish_breakout_option_buying
export const niftyBearishBreakoutOptionBuying = runBacktest(bearishBreakoutService.runNiftyBearishBreakoutOptionBuyingBacktest);

// POST /api/backtest/nifty_hull_ma_option_buying   options: { timeframe, strike, dayTarget, daySl }
export const niftyHullMaOptionBuying = runBacktest(hullMaService.runNiftyHullMaOptionBuyingBacktest);

// POST /api/backtest/nifty_ema_crossover_retest_option_buying   options: { timeframe, strike, dayTarget, daySl }
export const niftyEmaCrossoverRetest = runBacktest(emaRetestService.runNiftyEmaCrossoverRetestBacktest);

// POST /api/backtest/nifty_ema_supertrend_option_buying   options: { timeframe, strike, dayTarget, daySl }
export const niftyEmaSupertrend = runBacktest(emaSupertrendService.runNiftyEmaSupertrendBacktest);

// POST /api/backtest/nifty_ema_supertrend_rejection_option_buying   options: { timeframe, strike, dayTarget, daySl }
export const niftyEmaSupertrendRejection = runBacktest(emaRejectionService.runNiftyEmaSupertrendRejectionBacktest);

// POST /api/backtest/nifty_supertrend_ema_buying_1min   options: { timeframe, dayTarget, daySl }
export const niftySupertrendEmaBuying1min = runBacktest(supertrendEma1minService.runNiftySupertrendEmaBuying1minBacktest);

// ---------- background date-range runs (custom hourly strategy) ----------

// strategies that can run a date range as a background job: runner + option check (400 before any job starts)
const RANGE_JOBS = {
  nifty_hourly_range_touch_custom: { run: hourlyRangeService.runNiftyHourlyRangeTouchCustomBacktest, validate: hourlyRangeService.validateCustomOptions },
  nifty_hull_ma_option_buying: { run: hullMaService.runNiftyHullMaOptionBuyingBacktest, validate: hullMaService.validateHullOptions },
  nifty_ema_crossover_retest_option_buying: { run: emaRetestService.runNiftyEmaCrossoverRetestBacktest, validate: emaRetestService.validateEmaOptions },
  nifty_ema_supertrend_option_buying: { run: emaSupertrendService.runNiftyEmaSupertrendBacktest, validate: emaSupertrendService.validateEmaStOptions },
  nifty_ema_supertrend_rejection_option_buying: { run: emaRejectionService.runNiftyEmaSupertrendRejectionBacktest, validate: emaRejectionService.validateEmaStRejectionOptions },
  nifty_supertrend_ema_buying_1min: { run: supertrendEma1minService.runNiftySupertrendEmaBuying1minBacktest, validate: supertrendEma1minService.validateSt1mOptions },
};

const startRangeJob = (key) => (req, res) => {
  try {
    const input = backtestService.validateBacktestInput(req.body);
    RANGE_JOBS[key].validate(input.options);
    // the Dhan client id is the owner: one running range job per account
    const jobId = startJob({ owner: `dhan:${input.clientId}`, key, input, run: RANGE_JOBS[key].run });
    res.status(202).json({ success: true, jobId });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message,
      errors: Array.isArray(err.details) ? err.details : [err.message],
    });
  }
};

// POST /api/backtest/nifty_hourly_range_touch_custom/start   same body as the plain run -> { jobId }
export const startHourlyCustomJob = startRangeJob("nifty_hourly_range_touch_custom");

// POST /api/backtest/nifty_hull_ma_option_buying/start
export const startHullMaJob = startRangeJob("nifty_hull_ma_option_buying");

// POST /api/backtest/nifty_ema_crossover_retest_option_buying/start
export const startEmaRetestJob = startRangeJob("nifty_ema_crossover_retest_option_buying");

// POST /api/backtest/nifty_ema_supertrend_option_buying/start
export const startEmaSupertrendJob = startRangeJob("nifty_ema_supertrend_option_buying");

// POST /api/backtest/nifty_ema_supertrend_rejection_option_buying/start
export const startEmaRejectionJob = startRangeJob("nifty_ema_supertrend_rejection_option_buying");

// POST /api/backtest/nifty_supertrend_ema_buying_1min/start
export const startSupertrendEma1minJob = startRangeJob("nifty_supertrend_ema_buying_1min");

// GET /api/backtest/jobs/:id
export const getBacktestJob = (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Backtest job not found (finished a long time ago, or the server restarted)" });
  res.status(200).json({ success: true, ...job });
};

// GET /api/backtest/jobs/:id/charts/:date
export const getBacktestJobCharts = (req, res) => {
  const charts = getJobCharts(req.params.id, undefined, req.params.date);
  if (charts === null) return res.status(404).json({ success: false, message: "Backtest job not found" });
  res.status(200).json({ success: true, charts });
};

// POST /api/backtest/jobs/:id/cancel
export const cancelBacktestJob = (req, res) => {
  if (!cancelJob(req.params.id)) return res.status(404).json({ success: false, message: "Backtest job not found" });
  res.status(200).json({ success: true });
};
