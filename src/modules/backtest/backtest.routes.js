import express from "express";
import { pivotOptionBuyingCum, niftyOptionPivotBuffer, niftyOptionPivotFixedTarget, niftyOptionLevelBreakout, niftyHourlyRangeTouch, niftyHourlyRangeTouch1m } from "./backtest.controller.js";

const router = express.Router();

// RUN BACKTEST — body: { clientId, accessToken, fromDate, toDate, includeEvents? }
router.post("/pivot_option_buying_cum", pivotOptionBuyingCum);
router.post("/nifty_option_pivot_buffer", niftyOptionPivotBuffer);
router.post("/nifty_option_pivot_fixed_target", niftyOptionPivotFixedTarget);
router.post("/nifty_option_level_breakout", niftyOptionLevelBreakout);
router.post("/nifty_hourly_range_touch", niftyHourlyRangeTouch);
router.post("/nifty_hourly_range_touch_1m", niftyHourlyRangeTouch1m);

export default router;
