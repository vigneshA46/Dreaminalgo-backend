import { Router } from "express";

import authenticate from "../../middlewares/authenticate.js";
import authorize from "../../middlewares/authorize.js";

import * as exitMonitorController from "./exitMonitor.controller.js";

const router = Router();


/* =========================================================
   FRONTEND APIs
   ========================================================= */

/* Create / Start Exit Monitor */
router.post(
  "/",
  authenticate,
  authorize,
  exitMonitorController.createExitMonitor
);


/* Get User Active Exit Monitors */
router.get(
  "/",
  authenticate,
  authorize,
  exitMonitorController.getUserExitMonitors
);


/* Get Single Exit Monitor */
router.get(
  "/:id",
  authenticate,
  authorize,
  exitMonitorController.getExitMonitor
);


/* Stop Exit Monitor */
router.post(
  "/:id/stop",
  authenticate,
  authorize,
  exitMonitorController.stopExitMonitor
);


/* Get Monitor Logs */
router.get(
  "/:id/logs",
  authenticate,
  authorize,
  exitMonitorController.getExitMonitorLogs
);


/* =========================================================
   PYTHON → EXPRESS
   ========================================================= */

/* Python reports that exit condition was triggered */
router.post(
  "/:id/exit",
  exitMonitorController.handleExitMonitorExit
);


export default router;