import * as backtestService from "./backtest.service.js";

// POST /api/backtest/pivot_option_buying_cum
export const pivotOptionBuyingCum = async (req, res) => {
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
    const result = await backtestService.runPivotOptionBuyingCumBacktest(input);
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
