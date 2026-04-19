import express from "express";

import * as controller from "./deployments.controller.js";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';


const router = express.Router();

// Create deployment
router.post("/", authenticate, controller.createDeployment);

// Get today deployments by strategy
router.get("/today/:strategy_id", controller.getTodayDeploymentsByStrategy);

// Get today deployments by strategy + type
router.get(
  "/today/:strategy_id/:type",
  controller.getTodayDeploymentsByStrategyAndType
);

router.get("/user/today/all", controller.getTodayDeploymentsByType);
router.get("/user/today", authenticate, controller.getUsertodayDeployment);

// Get all user deployments
router.get("/user/all", authenticate, controller.getUserDeployments);
router.patch("/user/status", controller.updateDeploymentStatusByDate);

// Get deployments by date
router.get("/by-date", authenticate, controller.getDeploymentsByDate);

// Grouped by strategy
router.get("/grouped/strategy", authenticate, controller.getDeploymentsGroupedByStrategy);

router.get("/userdep/all", authenticate, controller.getUserDeploymentsGroupedWithPnl);


export default router;