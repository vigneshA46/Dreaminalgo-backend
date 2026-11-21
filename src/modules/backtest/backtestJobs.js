/**
 * Background backtest jobs (date-range runs).
 *
 * A range run takes minutes, far longer than a safe HTTP request, so the endpoint starts a job and the
 * page polls it: progress + the result so far (finished days) come back on every poll.
 *   - everything lives in memory, nothing is written to disk; a job is dropped 2 h after it finishes
 *   - the Dhan credentials stay inside the running closure, they are never stored on the job
 *   - one running job per owner (a user, or the Dhan client id for the admin API) and a global cap
 */

import { randomUUID } from "crypto";
import { BacktestError } from "./backtest.service.js";

const KEEP_MS = 2 * 60 * 60 * 1000;
const MAX_RUNNING = 4;
const jobs = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > KEEP_MS) jobs.delete(id);
}, 10 * 60 * 1000).unref();

const running = () => [...jobs.values()].filter((j) => j.status === "running");

/** run(input) is the strategy runner; it is given input.onUpdate / input.isCancelled / input.slim. */
export function startJob({ owner, key, input, run }) {
  if (running().some((j) => j.owner === owner)) {
    throw new BacktestError("A backtest is already running — wait for it to finish or stop it", 429);
  }
  if (running().length >= MAX_RUNNING) {
    throw new BacktestError("The server is busy with other backtests — try again in a few minutes", 429);
  }

  const job = {
    id: randomUUID(),
    owner,
    key,
    status: "running", // running | done | stopped | error
    progress: { done: 0, total: 0, date: null },
    result: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    cancel: false,
  };
  jobs.set(job.id, job);

  const jobInput = {
    ...input,
    slim: true,
    onUpdate: ({ result, progress }) => {
      job.result = result;
      job.progress = progress;
    },
    isCancelled: () => job.cancel,
  };

  Promise.resolve()
    .then(() => run(jobInput))
    .then((result) => {
      job.result = result;
      job.status = result.cancelled ? "stopped" : "done";
    })
    .catch((err) => {
      job.status = "error";
      job.error = {
        status: err instanceof BacktestError ? err.status : 500,
        message: err.message,
        errors: err.status === 400 && Array.isArray(err.details) ? err.details : [err.message],
        logs: err.details?.logs || [],
      };
      if (!(err instanceof BacktestError)) console.error("[backtest-job] failed:", err);
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });

  return job.id;
}

/** The job's current state; owner must match (undefined = no owner check, admin API). */
export function getJob(id, owner) {
  const j = jobs.get(id);
  if (!j || (owner !== undefined && j.owner !== owner)) return null;
  return {
    id: j.id,
    status: j.status,
    progress: j.progress,
    elapsedSec: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000),
    result: j.result,
    error: j.error,
  };
}

export function cancelJob(id, owner) {
  const j = jobs.get(id);
  if (!j || (owner !== undefined && j.owner !== owner)) return false;
  if (j.status === "running") j.cancel = true;
  return true;
}
