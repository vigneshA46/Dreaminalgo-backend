import { Router } from "express";

import authenticate from "../../middlewares/authenticate.js";
import authorize from "../../middlewares/authorize.js";

import * as savedStrategyController from "./savedStrategy.controller.js";

const router = Router();

/*
  SAVE STRATEGY
  Logged-in user saves an existing strategy
*/
router.post(
  "/",
  authenticate,
  savedStrategyController.createSavedStrategy
);

/*
  GET MY SAVED STRATEGIES
  Logged-in user gets their own saved strategies
*/
router.get(
  "/my",
  authenticate,
  savedStrategyController.getMySavedStrategies
);

/*
  GET ALL SAVED STRATEGIES
  Admin only
*/
router.get(
  "/",
  authenticate,
  authorize("superadmin", "admin"),
  savedStrategyController.getAllSavedStrategies
);

/*
  REMOVE SAVED STRATEGY
*/
router.delete(
  "/:id",
  authenticate,
  savedStrategyController.deleteSavedStrategy
);

export default router;
