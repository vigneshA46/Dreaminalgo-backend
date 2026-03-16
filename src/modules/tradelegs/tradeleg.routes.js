import express from "express";
import {
  createLeg,
  getLegsByDate,
  getLatestLegs
} from "./tradeleg.controller.js";

const router = express.Router();

/* CREATE LEG */
router.post("/create", createLeg);

/* GET LEGS BY DATE + STRATEGY */
router.get("/", getLegsByDate);

/* GET LATEST LEGS */
router.get("/latest/:strategy_id", getLatestLegs);

export default router;