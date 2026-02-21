import { Router } from 'express';
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';
import * as strategyController from "./strategy.controller.js";


const router = Router();

/*
  GET ALL ACTIVE STRATEGIES (User)
*/
router.get(
  "/",
  authenticate,
  strategyController.getStrategies
);

/*
  GET SINGLE STRATEGY
*/
router.get(
  "/:id",
  authenticate,
  strategyController.getStrategyById
);

/*
  CREATE STRATEGY (Admin Only)
*/
router.post(
  "/",
  authenticate,
  authorize("superadmin", "admin"),
  strategyController.createStrategy
);

/*
  UPDATE STRATEGY DETAILS
*/
router.patch(
  "/:id",
  authenticate,
  authorize("superadmin", "admin"),
  strategyController.updateStrategy
);

/*
  UPDATE STRATEGY STATUS (Approve / Reject / Disable)
*/
router.patch(
  "/:id/status",
  authenticate,
  authorize("superadmin", "admin"),
  strategyController.updateStrategyStatus
);

/*
  DELETE STRATEGY (Soft delete via status)
*/
router.delete(
  "/:id",
  authenticate,
  authorize("superadmin", "admin"),
  strategyController.deleteStrategy
);

export default router;