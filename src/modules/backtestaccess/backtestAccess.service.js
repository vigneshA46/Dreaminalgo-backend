import pool from "../../config/db.js";
import { BACKTEST_STRATEGIES } from "../backtest/backtest.registry.js";
import { BacktestError } from "../backtest/backtest.service.js";

/* ===========================
   STRATEGY LIST (seeded from the registry)
=========================== */

let seeded = null;

// insert any registry strategy that has no row yet (admin edits to title / description are kept)
const ensureSeeded = () => {
  if (!seeded) {
    seeded = (async () => {
      for (const [key, s] of Object.entries(BACKTEST_STRATEGIES)) {
        await pool.query(
          `INSERT INTO backtest_strategies (key, title, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (key) DO NOTHING`,
          [key, s.title, s.description]
        );
      }
    })().catch((err) => {
      seeded = null;
      throw err;
    });
  }
  return seeded;
};

export const listStrategiesService = async () => {
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT s.key, s.title, s.description, s.is_active, s.updated_at,
            COUNT(a.id)::int AS user_count
     FROM backtest_strategies s
     LEFT JOIN backtest_strategy_access a ON a.strategy_key = s.key
     GROUP BY s.key
     ORDER BY s.created_at, s.key`
  );
  // only strategies the backend can still run
  return rows.filter((r) => BACKTEST_STRATEGIES[r.key]);
};

export const updateStrategyService = async (key, { title, description, is_active }) => {
  await ensureSeeded();
  const { rows } = await pool.query(
    `UPDATE backtest_strategies
     SET title = COALESCE($2, title),
         description = COALESCE($3, description),
         is_active = COALESCE($4, is_active),
         updated_at = CURRENT_TIMESTAMP
     WHERE key = $1
     RETURNING key, title, description, is_active`,
    [key, title ?? null, description ?? null, typeof is_active === "boolean" ? is_active : null]
  );
  if (!rows.length) throw new BacktestError("Backtest strategy not found", 404);
  return rows[0];
};

/* ===========================
   USER ACCESS (admin)
=========================== */

export const listStrategyUsersService = async (key) => {
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT u.id, u.fullname, u.email, u.mobile_number, a.created_at AS granted_at,
            a.can_run, a.can_read, a.can_write
     FROM backtest_strategy_access a
     JOIN users u ON u.id = a.user_id
     WHERE a.strategy_key = $1
     ORDER BY a.created_at DESC`,
    [key]
  );
  return rows;
};

const asFlag = (v, dflt) => (typeof v === "boolean" ? v : dflt);

/** perms: { can_run?, can_read?, can_write? } — a plain grant means "may run" like before */
const cleanPerms = (perms) => {
  const p = perms && typeof perms === "object" ? perms : {};
  const out = { can_run: asFlag(p.can_run, true), can_read: asFlag(p.can_read, false), can_write: asFlag(p.can_write, false) };
  if (!out.can_run && !out.can_read && !out.can_write) throw new BacktestError("Pick at least one of run / read / write (or remove the user)", 400);
  return out;
};

export const grantAccessService = async (key, userIds, adminId, perms) => {
  await ensureSeeded();
  if (!BACKTEST_STRATEGIES[key]) throw new BacktestError("Backtest strategy not found", 404);
  if (!Array.isArray(userIds) || !userIds.length) throw new BacktestError("userIds is required", 400);
  const f = cleanPerms(perms);

  const { rowCount } = await pool.query(
    `INSERT INTO backtest_strategy_access (strategy_key, user_id, granted_by, can_run, can_read, can_write)
     SELECT $1, u.id, $3, $4, $5, $6 FROM users u WHERE u.id = ANY($2::uuid[])
     ON CONFLICT (strategy_key, user_id) DO NOTHING`,
    [key, userIds, adminId || null, f.can_run, f.can_read, f.can_write]
  );
  return { message: "Access granted", added: rowCount };
};

/** change run / read / write of a user who already has access */
export const updatePermissionsService = async (key, userId, perms) => {
  const p = perms && typeof perms === "object" ? perms : {};
  const { rows } = await pool.query(
    `SELECT can_run, can_read, can_write FROM backtest_strategy_access WHERE strategy_key = $1 AND user_id = $2`,
    [key, userId]
  );
  if (!rows.length) throw new BacktestError("This user does not have access", 404);
  const f = cleanPerms({
    can_run: asFlag(p.can_run, rows[0].can_run),
    can_read: asFlag(p.can_read, rows[0].can_read),
    can_write: asFlag(p.can_write, rows[0].can_write),
  });
  await pool.query(
    `UPDATE backtest_strategy_access SET can_run = $3, can_read = $4, can_write = $5 WHERE strategy_key = $1 AND user_id = $2`,
    [key, userId, f.can_run, f.can_read, f.can_write]
  );
  return { message: "Permissions updated", ...f };
};

export const revokeAccessService = async (key, userId) => {
  const { rowCount } = await pool.query(
    `DELETE FROM backtest_strategy_access WHERE strategy_key = $1 AND user_id = $2`,
    [key, userId]
  );
  if (!rowCount) throw new BacktestError("This user does not have access", 404);
  return { message: "Access removed" };
};

export const searchUsersService = async (q) => {
  const term = String(q || "").trim();
  if (term.length < 2) return [];
  const { rows } = await pool.query(
    `SELECT id, fullname, email, mobile_number
     FROM users
     WHERE fullname ILIKE $1 OR email ILIKE $1 OR mobile_number ILIKE $1
     ORDER BY fullname NULLS LAST, email
     LIMIT 20`,
    [`%${term}%`]
  );
  return rows;
};

/* ===========================
   USER SIDE
=========================== */

export const myStrategiesService = async (userId) => {
  await ensureSeeded();
  const { rows } = await pool.query(
    `SELECT s.key, s.title, s.description, a.can_run, a.can_read, a.can_write
     FROM backtest_strategy_access a
     JOIN backtest_strategies s ON s.key = a.strategy_key
     WHERE a.user_id = $1 AND s.is_active = true AND (a.can_run OR a.can_read OR a.can_write)
     ORDER BY s.created_at, s.key`,
    [userId]
  );
  return rows.filter((r) => BACKTEST_STRATEGIES[r.key]);
};

/** the user's rights on one (active) strategy: { can_run, can_read, can_write } or null */
export const getAccess = async (userId, key) => {
  const { rows } = await pool.query(
    `SELECT a.can_run, a.can_read, a.can_write
     FROM backtest_strategy_access a
     JOIN backtest_strategies s ON s.key = a.strategy_key
     WHERE a.user_id = $1 AND a.strategy_key = $2 AND s.is_active = true`,
    [userId, key]
  );
  return rows[0] || null;
};

export const hasAccess = async (userId, key) => !!(await getAccess(userId, key))?.can_run;

/**
 * The platform's Dhan login, kept fresh by the trading engine (dhan_token.py) in
 * broker_access_tokens. Read only: generating a new token here would invalidate the
 * one the live engine is using.
 */
export const getPlatformDhanCredentials = async () => {
  const params = [];
  let where = `broker_name = 'dhan'`;
  if (process.env.BACKTEST_DHAN_CLIENT_ID) {
    params.push(process.env.BACKTEST_DHAN_CLIENT_ID);
    where += ` AND client_id = $1`;
  }
  const { rows } = await pool.query(
    `SELECT client_id, access_token, expiry_time
     FROM broker_access_tokens
     WHERE ${where}
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`,
    params
  );
  if (!rows.length) {
    throw new BacktestError("Backtest data access is not set up yet (no platform Dhan token). Please contact support.", 503);
  }
  if (rows[0].expiry_time && new Date(rows[0].expiry_time) < new Date()) {
    throw new BacktestError("Backtest data access has expired for today. Please try again later or contact support.", 503);
  }
  return { clientId: rows[0].client_id, accessToken: rows[0].access_token };
};

export const logRunService = async (run) => {
  try {
    await pool.query(
      `INSERT INTO backtest_runs (user_id, strategy_key, run_date, status, net_pnl, trades, error, duration_sec)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [run.userId, run.key, run.date, run.status, run.netPnl ?? null, run.trades ?? null, run.error ?? null, run.durationSec ?? null]
    );
  } catch (err) {
    console.error("[backtest-access] run log failed:", err.message);
  }
};
