import * as service from "./backtestAccess.service.js";
import { BACKTEST_STRATEGIES } from "../backtest/backtest.registry.js";
import { BacktestError, validateBacktestInput } from "../backtest/backtest.service.js";

const fail = (res, err) => {
  const status = err instanceof BacktestError ? err.status : 500;
  if (status >= 500) console.error("[backtest-access]", err);
  res.status(status).json({ success: false, message: err.message, errors: err.details || [err.message] });
};

/* ===========================
   ADMIN
=========================== */

// GET /api/backtest-access/strategies
export const listStrategies = async (req, res) => {
  try {
    res.status(200).json(await service.listStrategiesService());
  } catch (err) {
    fail(res, err);
  }
};

// PATCH /api/backtest-access/strategies/:key   body: { title?, description?, is_active? }
export const updateStrategy = async (req, res) => {
  try {
    res.status(200).json(await service.updateStrategyService(req.params.key, req.body || {}));
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/backtest-access/strategies/:key/users
export const listStrategyUsers = async (req, res) => {
  try {
    res.status(200).json(await service.listStrategyUsersService(req.params.key));
  } catch (err) {
    fail(res, err);
  }
};

// POST /api/backtest-access/strategies/:key/users   body: { userIds: [] }
export const grantAccess = async (req, res) => {
  try {
    res.status(200).json(await service.grantAccessService(req.params.key, req.body?.userIds, req.user?.id));
  } catch (err) {
    fail(res, err);
  }
};

// DELETE /api/backtest-access/strategies/:key/users/:userId
export const revokeAccess = async (req, res) => {
  try {
    res.status(200).json(await service.revokeAccessService(req.params.key, req.params.userId));
  } catch (err) {
    fail(res, err);
  }
};

// GET /api/backtest-access/users/search?q=
export const searchUsers = async (req, res) => {
  try {
    res.status(200).json(await service.searchUsersService(req.query.q));
  } catch (err) {
    fail(res, err);
  }
};

/* ===========================
   USER
=========================== */

// GET /api/backtest-access/my/strategies
export const myStrategies = async (req, res) => {
  try {
    res.status(200).json(await service.myStrategiesService(req.user.id));
  } catch (err) {
    fail(res, err);
  }
};

// one run per user at a time (each run is ~42-126 Dhan calls)
const running = new Set();

// POST /api/backtest-access/my/run/:key   body: { date: "YYYY-MM-DD", options? (strategies with settings) }
export const runMyBacktest = async (req, res) => {
  const { key } = req.params;
  const userId = req.user.id;
  const strategy = BACKTEST_STRATEGIES[key];
  const date = req.body?.date;

  if (!strategy) return res.status(404).json({ success: false, message: "Backtest strategy not found" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
    return res.status(400).json({ success: false, message: "date is required as YYYY-MM-DD" });
  }
  if (running.has(userId)) {
    return res.status(429).json({ success: false, message: "A backtest is already running for you — wait for it to finish" });
  }

  running.add(userId);
  const started = Date.now();
  try {
    if (!(await service.hasAccess(userId, key))) {
      return res.status(403).json({ success: false, message: "You don't have access to this backtest" });
    }

    const creds = await service.getPlatformDhanCredentials();
    // users run one day at a time; same date checks as the admin API
    const input = validateBacktestInput({ ...creds, fromDate: date, toDate: date, includeEvents: true, options: req.body?.options });
    const result = await strategy.run(input);

    await service.logRunService({
      userId, key, date,
      status: result.success ? "ok" : "failed",
      netPnl: result.summary?.netPnl,
      trades: result.summary?.totalTrades ?? 0,
      durationSec: result.meta?.durationSec,
    });

    res.status(result.success ? 200 : 502).json(
      result.success ? result : { ...result, message: "Backtest failed for this day — see errors / logs" }
    );
  } catch (err) {
    let status = err instanceof BacktestError ? err.status : 500;
    let message = err.message;
    if (status === 400 && Array.isArray(err.details)) {
      // input checks are shared with the admin API (fromDate / toDate) -> speak of one "date" here
      message = [...new Set(err.details.map((d) => d.replace(/\b(fromDate|toDate)\b/g, "date")))].join(", ");
    }
    // a Dhan auth problem is the platform's token, not the user's session -> never answer 401 / 403
    if (status === 401 || status === 403) {
      status = 503;
      message = "Backtest data access is temporarily unavailable. Please try again later.";
    }
    await service.logRunService({
      userId, key, date,
      status: "error", error: err.message, durationSec: (Date.now() - started) / 1000,
    });
    if (status >= 500) console.error("[backtest-access] run failed:", err);
    res.status(status).json({ success: false, message, errors: [message] });
  } finally {
    running.delete(userId);
  }
};
