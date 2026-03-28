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

// Get all user deployments
router.get("/user/all", authenticate, controller.getUserDeployments);

export default router;