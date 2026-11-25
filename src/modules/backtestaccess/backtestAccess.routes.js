import express from "express";
import authenticate from "../../middlewares/authenticate.js";
import authorize from "../../middlewares/authorize.js";
import {
  listStrategies,
  updateStrategy,
  listStrategyUsers,
  grantAccess,
  revokeAccess,
  searchUsers,
  myStrategies,
  runMyBacktest,
  startMyBacktestJob,
  getMyBacktestJob,
  cancelMyBacktestJob,
  updatePermissions,
  saveMyBacktest,
  getMySavedBacktests,
} from "./backtestAccess.controller.js";

const router = express.Router();

/* ADMIN — backtest strategies and who may use them */
router.get("/strategies", authenticate, authorize("superadmin"), listStrategies);
router.patch("/strategies/:key", authenticate, authorize("superadmin"), updateStrategy);
router.get("/strategies/:key/users", authenticate, authorize("superadmin"), listStrategyUsers);
router.post("/strategies/:key/users", authenticate, authorize("superadmin"), grantAccess);
router.patch("/strategies/:key/users/:userId", authenticate, authorize("superadmin"), updatePermissions);
router.delete("/strategies/:key/users/:userId", authenticate, authorize("superadmin"), revokeAccess);
router.get("/users/search", authenticate, authorize("superadmin"), searchUsers);

/* USER — allowed strategies, run one day with the platform Dhan data */
router.get("/my/strategies", authenticate, myStrategies);
router.post("/my/run/:key", authenticate, runMyBacktest);
router.post("/my/start/:key", authenticate, startMyBacktestJob);
router.post("/my/save/:key", authenticate, saveMyBacktest);
router.get("/my/saved/:key", authenticate, getMySavedBacktests);
router.get("/my/jobs/:id", authenticate, getMyBacktestJob);
router.post("/my/jobs/:id/cancel", authenticate, cancelMyBacktestJob);

export default router;
