import express from "express";
import { getStrategyDatewisePnl, getUserDeployedStrategies } from "./reports.controller.js";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';

const router = express.Router();

// GET unique strategies deployed by user
router.get("/strategies",authenticate, getUserDeployedStrategies);

router.get("/user/strategy/datewise-pnl/:strategy_id",authenticate , getStrategyDatewisePnl);

export default router;