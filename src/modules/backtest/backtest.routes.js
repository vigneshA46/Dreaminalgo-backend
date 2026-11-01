import express from "express";
import { pivotOptionBuyingCum, niftyOptionPivotBuffer, niftyOptionPivotFixedTarget } from "./backtest.controller.js";

const router = express.Router();

// RUN BACKTEST — body: { clientId, accessToken, fromDate, toDate, includeEvents? }
router.post("/pivot_option_buying_cum", pivotOptionBuyingCum);
router.post("/nifty_option_pivot_buffer", niftyOptionPivotBuffer);
router.post("/nifty_option_pivot_fixed_target", niftyOptionPivotFixedTarget);

export default router;
