import * as backtestService from "./backtest.service.js";
import * as pivotBufferService from "./pivotBuffer.service.js";

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
      errors: [{ stage: "run", message: err.message, details: err.details?.dhanError || null }],
      logs: err.details?.logs || [],
    });
  }
};

// POST /api/backtest/pivot_option_buying_cum
export const pivotOptionBuyingCum = runBacktest(backtestService.runPivotOptionBuyingCumBacktest);

// POST /api/backtest/nifty_option_pivot_buffer
export const niftyOptionPivotBuffer = runBacktest(pivotBufferService.runNiftyOptionPivotBufferBacktest);
