import express from "express";
import { pivotOptionBuyingCum, niftyOptionPivotBuffer, niftyOptionPivotFixedTarget, niftyOptionLevelBreakout, niftyHourlyRangeTouch, niftyHourlyRangeTouch1m, niftyHourlyRangeTouchCustom, niftyBearishBreakoutOptionBuying, niftyHullMaOptionBuying, niftyEmaCrossoverRetest, niftyEmaSupertrend, niftyEmaSupertrendRejection, startHourlyCustomJob, startHullMaJob, startEmaRetestJob, startEmaSupertrendJob, startEmaRejectionJob, getBacktestJob, cancelBacktestJob } from "./backtest.controller.js";

const router = express.Router();

// RUN BACKTEST — body: { clientId, accessToken, fromDate, toDate, includeEvents?, options? (custom strategies) }
router.post("/pivot_option_buying_cum", pivotOptionBuyingCum);
router.post("/nifty_option_pivot_buffer", niftyOptionPivotBuffer);
router.post("/nifty_option_pivot_fixed_target", niftyOptionPivotFixedTarget);
router.post("/nifty_option_level_breakout", niftyOptionLevelBreakout);
router.post("/nifty_hourly_range_touch", niftyHourlyRangeTouch);
router.post("/nifty_hourly_range_touch_1m", niftyHourlyRangeTouch1m);
router.post("/nifty_hourly_range_touch_custom", niftyHourlyRangeTouchCustom);
router.post("/nifty_bearish_breakout_option_buying", niftyBearishBreakoutOptionBuying);
router.post("/nifty_hull_ma_option_buying", niftyHullMaOptionBuying);
router.post("/nifty_ema_crossover_retest_option_buying", niftyEmaCrossoverRetest);
router.post("/nifty_ema_supertrend_option_buying", niftyEmaSupertrend);
router.post("/nifty_ema_supertrend_rejection_option_buying", niftyEmaSupertrendRejection);

// BACKGROUND RANGE RUN (custom hourly strategy): start -> poll -> (cancel)
router.post("/nifty_hourly_range_touch_custom/start", startHourlyCustomJob);
router.post("/nifty_hull_ma_option_buying/start", startHullMaJob);
router.post("/nifty_ema_crossover_retest_option_buying/start", startEmaRetestJob);
router.post("/nifty_ema_supertrend_option_buying/start", startEmaSupertrendJob);
router.post("/nifty_ema_supertrend_rejection_option_buying/start", startEmaRejectionJob);
router.get("/jobs/:id", getBacktestJob);
router.post("/jobs/:id/cancel", cancelBacktestJob);

export default router;
