import express from "express";

import {
  saveSelectedStocks,
  getTodayStocks,
  getStockSelectionHistory,
} from "./stocks.controller.js";

const router = express.Router();

router.post("/", saveSelectedStocks);

router.get("/today", getTodayStocks);

router.get("/history", getStockSelectionHistory);

export default router;
