import express from "express";
import {  getDeploymentsByBrokerDetailed, getDeploymentsByDateDetailed, getDeploymentsByStrategyDetailed, getDeploymentsByUserDetailed, getStrategyDatewisePnl, getUserDeployedStrategies } from "./reports.controller.js";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';

const router = express.Router();

// GET unique strategies deployed by user
router.get("/strategies",authenticate, getUserDeployedStrategies);

router.get("/user/strategy/datewise-pnl/:strategy_id",authenticate , getStrategyDatewisePnl);

router.get("/admin/deployments/strategy", authenticate, authorize("superadmin"), getDeploymentsByStrategyDetailed);
router.get("/admin/deployments/broker", authenticate, authorize("superadmin"), getDeploymentsByBrokerDetailed);
router.get("/admin/deployments/user", authenticate, authorize("superadmin"), getDeploymentsByUserDetailed);
router.get("/admin/deployments/date", authenticate, authorize("superadmin"), getDeploymentsByDateDetailed);

export default router;