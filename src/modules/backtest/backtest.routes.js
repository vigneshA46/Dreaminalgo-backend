import express from "express";
import { pivotOptionBuyingCum } from "./backtest.controller.js";

const router = express.Router();

// RUN BACKTEST — body: { clientId, accessToken, fromDate, toDate, includeEvents? }
router.post("/pivot_option_buying_cum", pivotOptionBuyingCum);

export default router;
