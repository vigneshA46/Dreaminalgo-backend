import { Router } from "express";
import * as controller from "./realTradeGroups.controller.js";

const router = Router();

/*
  CREATE TRADE
*/
router.post("/", controller.createTradeGroup);

/*
  GET TRADES (strategy_id, broker_id, date)
  /?strategy_id=1&broker_id=2&date=2026-04-18
*/
router.get("/", controller.getTrades);

/*
  GET LATEST TRADE
  /latest?strategy_id=1&broker_id=2&date=2026-04-18
*/
router.get("/latest", controller.getLatestTrade);

router.get("/opentrades", controller.getOpenTrades);

export default router;