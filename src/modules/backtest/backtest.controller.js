import * as backtestService from "./backtest.service.js";
import * as pivotBufferService from "./pivotBuffer.service.js";
import * as pivotFixedTargetService from "./pivotFixedTarget.service.js";
import * as levelBreakoutService from "./levelBreakout.service.js";
import * as hourlyRangeService from "./hourlyRange.service.js";
import * as bearishBreakoutService from "./bearishBreakout.service.js";
import * as hullMaService from "./hullMa.service.js";
import { startJob, getJob, cancelJob } from "./backtestJobs.js";

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

// ---------- background date-range runs (custom hourly strategy) ----------

// POST /api/backtest/nifty_hourly_range_touch_custom/start   same body as the plain run -> { jobId }
export const startHourlyCustomJob = (req, res) => {
  try {
    const input = backtestService.validateBacktestInput(req.body);
    hourlyRangeService.validateCustomOptions(input.options);
    // the Dhan client id is the owner: one running range job per account
    const jobId = startJob({
      owner: `dhan:${input.clientId}`,
      key: "nifty_hourly_range_touch_custom",
      input,
      run: hourlyRangeService.runNiftyHourlyRangeTouchCustomBacktest,
    });
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

// GET /api/backtest/jobs/:id
export const getBacktestJob = (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ success: false, message: "Backtest job not found (finished a long time ago, or the server restarted)" });
  res.status(200).json({ success: true, ...job });
};

// POST /api/backtest/jobs/:id/cancel
export const cancelBacktestJob = (req, res) => {
  if (!cancelJob(req.params.id)) return res.status(404).json({ success: false, message: "Backtest job not found" });
  res.status(200).json({ success: true });
};
