import express from "express";
import { pivotOptionBuyingCum, niftyOptionPivotBuffer, niftyOptionPivotFixedTarget, niftyOptionLevelBreakout, niftyHourlyRangeTouch, niftyHourlyRangeTouch1m, niftyHourlyRangeTouchCustom, niftyBearishBreakoutOptionBuying, niftyHullMaOptionBuying, startHourlyCustomJob, getBacktestJob, cancelBacktestJob } from "./backtest.controller.js";

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

// BACKGROUND RANGE RUN (custom hourly strategy): start -> poll -> (cancel)
router.post("/nifty_hourly_range_touch_custom/start", startHourlyCustomJob);
router.get("/jobs/:id", getBacktestJob);
router.post("/jobs/:id/cancel", cancelBacktestJob);

export default router;
