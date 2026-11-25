import * as service from "./backtestAccess.service.js";
import { BACKTEST_STRATEGIES } from "../backtest/backtest.registry.js";
import { BacktestError, validateBacktestInput } from "../backtest/backtest.service.js";
import { validateCustomOptions } from "../backtest/hourlyRange.service.js";
import { validateHullOptions } from "../backtest/hullMa.service.js";
import { validateEmaOptions } from "../backtest/emaRetest.service.js";
import { validateEmaStOptions } from "../backtest/emaSupertrend.service.js";
import { validateEmaStRejectionOptions } from "../backtest/emaSupertrendRejection.service.js";
import { startJob, getJob, cancelJob } from "../backtest/backtestJobs.js";

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

// strategies where a user may pick a date range (everything else: one day), capped to protect the platform's Dhan quota
// strategies a user may run over a date range (as a background job), with their option checks
const RANGE_VALIDATORS = {
  nifty_hourly_range_touch_custom: validateCustomOptions,
  nifty_hull_ma_option_buying: validateHullOptions,
  nifty_ema_crossover_retest_option_buying: validateEmaOptions,
  nifty_ema_supertrend_option_buying: validateEmaStOptions,
  nifty_ema_supertrend_rejection_option_buying: validateEmaStRejectionOptions,
};
const RANGE_KEYS = new Set(Object.keys(RANGE_VALIDATORS));
const MAX_USER_RANGE_DAYS = 31;

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
    // users run one day at a time here (ranges go through startMyBacktestJob); same date checks as the admin API
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

/* ===========================
   USER — date range as a background job
=========================== */

// POST /api/backtest-access/my/start/:key   body: { date, toDate, options? } -> { jobId }
export const startMyBacktestJob = async (req, res) => {
  const { key } = req.params;
  const userId = req.user.id;
  const strategy = BACKTEST_STRATEGIES[key];
  const { date, toDate } = req.body || {};
  const iso = /^\d{4}-\d{2}-\d{2}$/;

  if (!strategy) return res.status(404).json({ success: false, message: "Backtest strategy not found" });
  if (!RANGE_KEYS.has(key)) return res.status(400).json({ success: false, message: "This backtest runs one day at a time" });
  if (!iso.test(date || "") || !iso.test(toDate || "") || toDate < date) {
    return res.status(400).json({ success: false, message: "date and toDate are required as YYYY-MM-DD, toDate not before date" });
  }
  const span = Math.round((Date.parse(toDate) - Date.parse(date)) / 86400000) + 1;
  if (span > MAX_USER_RANGE_DAYS) {
    return res.status(400).json({ success: false, message: `Pick at most ${MAX_USER_RANGE_DAYS} days per run` });
  }

  try {
    if (!(await service.hasAccess(userId, key))) {
      return res.status(403).json({ success: false, message: "You don't have access to this backtest" });
    }
    const creds = await service.getPlatformDhanCredentials();
    const input = validateBacktestInput({ ...creds, fromDate: date, toDate, includeEvents: false, options: req.body?.options });
    RANGE_VALIDATORS[key](input.options);
    const jobId = startJob({ owner: `user:${userId}`, key, input, run: strategy.run });
    await service.logRunService({ userId, key, date, status: "ok", trades: 0 }).catch(() => {});
    res.status(202).json({ success: true, jobId });
  } catch (err) {
    let status = err instanceof BacktestError ? err.status : 500;
    let message = err.message;
    if (status === 400 && Array.isArray(err.details)) {
      message = [...new Set(err.details.map((d) => d.replace(/\b(fromDate|toDate)\b/g, "date")))].join(", ");
    }
    if (status === 401 || status === 403) {
      status = 503;
      message = "Backtest data access is temporarily unavailable. Please try again later.";
    }
    if (status >= 500) console.error("[backtest-access] job start failed:", err);
    res.status(status).json({ success: false, message, errors: [message] });
  }
};

// GET /api/backtest-access/my/jobs/:id
export const getMyBacktestJob = (req, res) => {
  const job = getJob(req.params.id, `user:${req.user.id}`);
  if (!job) return res.status(404).json({ success: false, message: "Backtest not found (it finished a long time ago, or the server restarted)" });
  // a Dhan auth problem is the platform's, not the user's
  if (job.error && [401, 403].includes(job.error.status)) {
    job.error = { status: 503, message: "Backtest data access is temporarily unavailable. Please try again later.", errors: [], logs: [] };
  }
  res.status(200).json({ success: true, ...job });
};

// POST /api/backtest-access/my/jobs/:id/cancel
export const cancelMyBacktestJob = (req, res) => {
  if (!cancelJob(req.params.id, `user:${req.user.id}`)) return res.status(404).json({ success: false, message: "Backtest not found" });
  res.status(200).json({ success: true });
};
