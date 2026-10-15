import { Router } from "express";

import authenticate from "../../middlewares/authenticate.js";
import requireCustomExit from "../../middlewares/requireCustomExit.js";

import * as exitMonitorController from "./exitMonitor.controller.js";

const router = Router();


/* =========================================================
   FRONTEND APIs
   ========================================================= */

/* Create / Start Exit Monitor */
router.post(
  "/",
  authenticate,
  requireCustomExit,
  exitMonitorController.createExitMonitor
);


/* Get User Active Exit Monitors */
router.get(
  "/",
  authenticate,
  requireCustomExit,
  exitMonitorController.getUserExitMonitors
);


/* Python engine: ACTIVE monitors for restart recovery (must be above "/:id") */
router.get(
  "/engine/active",
  exitMonitorController.getEngineActiveMonitors
);


/* Monitor History For A Day (must be above "/:id") */
router.get(
  "/history",
  authenticate,
  requireCustomExit,
  exitMonitorController.getExitMonitorHistory
);


/* Get Single Exit Monitor */
router.get(
  "/:id",
  authenticate,
  requireCustomExit,
  exitMonitorController.getExitMonitor
);


/* Stop Exit Monitor */
router.post(
  "/:id/stop",
  authenticate,
  requireCustomExit,
  exitMonitorController.stopExitMonitor
);


/* Get Monitor Logs */
router.get(
  "/:id/logs",
  authenticate,
  requireCustomExit,
  exitMonitorController.getExitMonitorLogs
);


/* =========================================================
   PYTHON → EXPRESS
   ========================================================= */

/* Python closes a monitor (auto-close time / restart failure) */
router.post(
  "/:id/engine-close",
  exitMonitorController.closeMonitorFromEngine
);


/* Python reports that exit condition was triggered */
router.post(
  "/:id/exit",
  exitMonitorController.handleExitMonitorExit
);


export default router;