import express from "express";
import {
  createLeg,
  getLegsByDate,
  getLatestLegs,
  getDatesByStrategy,
  updateLegPnl,
  getStrategyDetailedPnl
} from "./tradeleg.controller.js";

const router = express.Router();

/* CREATE LEG */
router.post("/create", createLeg);

/* GET LEGS BY DATE + STRATEGY */
router.get("/", getLegsByDate);

/* GET LATEST LEGS */
router.get("/latest/:strategy_id", getLatestLegs);

/* GET DATES FOR A STARTERGY */
router.get("/dates/:strategy_id", getDatesByStrategy);

router.put("/stratergy/pnl",updateLegPnl)

router.post("/stratergy/detailled",getStrategyDetailedPnl)

export default router;