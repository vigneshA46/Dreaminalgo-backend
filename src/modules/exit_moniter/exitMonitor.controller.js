import pool from "../../config/db.js";
import axios from "axios";

/* =========================================================
   PYTHON EXIT ENGINE CONFIG
   ========================================================= */

const PYTHON_ENGINE_URL =
  process.env.PYTHON_EXIT_ENGINE_URL || "http://localhost:8000";

/* Shared secret between Express and the Python exit engine (both directions) */
const EXIT_ENGINE_SECRET = process.env.EXIT_ENGINE_SECRET || "";

const pythonHeaders = {
  "x-exit-engine-secret": EXIT_ENGINE_SECRET,
};

/* Only Zebu is supported by the Python exit engine */
const SUPPORTED_BROKERS = ["zebumynt"];


/* =========================================================
   EXIT RULES: indicator / fixed (target + SL) / trailing SL
   ========================================================= */

const INDICATORS = ["EMA9", "EMA20", "PARABOLIC_SAR", "HALFTREND"];
const TRACKING_SOURCES = ["INDEX", "OPTION"];
const PRICE_EXIT_TYPES = ["NONE", "FIXED", "TRAILING"];
const EXIT_REASONS = ["INDICATOR", "TARGET", "STOP_LOSS", "TRAILING_SL"];

/* "" / null / undefined -> null, anything that isn't a number -> NaN */
const toNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
};

const isPositive = (n) => n !== null && !Number.isNaN(n) && n > 0;

/* INDEX + PE is the only case where the price has to FALL for the trade to profit */
const fallsForProfit = (price_source, option_type) =>
  price_source === "INDEX" && option_type === "PE";

const sourceLabel = (source) => (source === "INDEX" ? "NIFTY index" : "option");

/*
  Validates the exit rules from the request body and returns
  { rules } (DB-ready values) or { error }.
  Older app versions don't send the new fields, so the indicator exit
  defaults to ON and the price exit to NONE.
*/
const buildExitRules = (body, option_type) => {
  const fail = (message) => ({ error: message });

  /* ----- indicator exit ----- */

  let indicator_enabled = true;

  if (body.indicator_enabled !== undefined) {
    if (typeof body.indicator_enabled !== "boolean") {
      return fail("indicator_enabled must be true or false");
    }
    indicator_enabled = body.indicator_enabled;
  }

  const rules = {
    indicator_enabled,
    timeframe: null,
    indicator: null,
    indicator_period: null,
    tracking_source: null,
    price_exit_type: "NONE",
    price_source: null,
    target_price: null,
    sl_price: null,
    trailing_start: null,
    trailing_points: null,
    current_sl: null,
  };

  if (indicator_enabled) {
    const timeframe = toNumber(body.timeframe);
    const period = toNumber(body.indicator_period);

    if (!INDICATORS.includes(body.indicator)) {
      return fail(`indicator must be one of ${INDICATORS.join(", ")}`);
    }
    if (!Number.isInteger(timeframe) || timeframe <= 0) {
      return fail("timeframe must be a whole number of minutes");
    }
    if (!TRACKING_SOURCES.includes(body.tracking_source)) {
      return fail("tracking_source must be INDEX or OPTION");
    }
    if (period !== null && !(Number.isInteger(period) && period > 0)) {
      return fail("indicator_period must be a positive whole number");
    }

    rules.indicator = body.indicator;
    rules.timeframe = timeframe;
    rules.tracking_source = body.tracking_source;
    rules.indicator_period = period;
  }

  /* ----- price exit (fixed target / SL, or trailing SL: only one) ----- */

  const price_exit_type =
    body.price_exit_type === undefined || body.price_exit_type === null
      ? "NONE"
      : body.price_exit_type;

  if (!PRICE_EXIT_TYPES.includes(price_exit_type)) {
    return fail(`price_exit_type must be one of ${PRICE_EXIT_TYPES.join(", ")}`);
  }

  if (price_exit_type !== "NONE") {
    if (!TRACKING_SOURCES.includes(body.price_source)) {
      return fail("price_source must be INDEX or OPTION");
    }

    const falls = fallsForProfit(body.price_source, option_type);
    const target = toNumber(body.target_price);
    const sl = toNumber(body.sl_price);

    rules.price_exit_type = price_exit_type;
    rules.price_source = body.price_source;

    if (price_exit_type === "FIXED") {
      if (target === null && sl === null) {
        return fail("Enter a target price, a stop loss, or both");
      }
      if (target !== null && !isPositive(target)) {
        return fail("target_price must be a positive number");
      }
      if (sl !== null && !isPositive(sl)) {
        return fail("sl_price must be a positive number");
      }
      if (target !== null && sl !== null && (falls ? target >= sl : target <= sl)) {
        return fail(
          falls
            ? "For a PE on the index, the target must be below the stop loss"
            : "The target must be above the stop loss"
        );
      }

      rules.target_price = target;
      rules.sl_price = sl;
      rules.current_sl = sl;
    } else {
      const start = toNumber(body.trailing_start);
      const points = toNumber(body.trailing_points);

      if (!isPositive(start)) {
        return fail("trailing_start must be a positive number");
      }
      if (!isPositive(points)) {
        return fail("trailing_points must be a positive number");
      }
      if (!isPositive(sl)) {
        return fail("sl_price must be a positive number for trailing");
      }
      if (falls ? start >= sl : start <= sl) {
        return fail(
          falls
            ? "For a PE on the index, the trailing start must be below the stop loss"
            : "The trailing start must be above the stop loss"
        );
      }

      rules.trailing_start = start;
      rules.trailing_points = points;
      rules.sl_price = sl;
      rules.current_sl = sl;
    }
  }

  if (!rules.indicator_enabled && rules.price_exit_type === "NONE") {
    return fail("Turn on at least one exit: indicator, target or trailing");
  }

  return { rules };
};

/* One line for the STARTED log, e.g. "EMA9 5m on option | Target 25500 on NIFTY index" */
const describeExitRules = (rules) => {
  const parts = [];

  if (rules.indicator_enabled) {
    parts.push(
      `${rules.indicator} ${rules.timeframe}m on ${sourceLabel(rules.tracking_source)}`
    );
  }

  const where = sourceLabel(rules.price_source);

  if (rules.price_exit_type === "FIXED") {
    if (rules.target_price !== null) parts.push(`Target ${rules.target_price} on ${where}`);
    if (rules.sl_price !== null) parts.push(`SL ${rules.sl_price} on ${where}`);
  }

  if (rules.price_exit_type === "TRAILING") {
    parts.push(
      `Trailing from ${rules.trailing_start} by ${rules.trailing_points} pts, SL ${rules.sl_price} on ${where}`
    );
  }

  return parts.join(" | ");
};

const omitNull = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null));


/* =========================================================
   1. CREATE / START EXIT MONITOR
   POST /api/exit-monitor
   ========================================================= */

export const createExitMonitor = async (req, res) => {
  try {
    const user_id = req.user.id;

    const {
      broker_account_id,
      symbol,
      security_id,
      index_name,
      index_security_id,
      option_type,
      strike,
      quantity,
      entry_price,
      entry_trade_id,
    } = req.body;

    /* -----------------------------------------
       BASIC VALIDATION
    ----------------------------------------- */

    if (
      !broker_account_id ||
      !symbol ||
      !option_type ||
      !strike ||
      !quantity
    ) {
      return res.status(400).json({
        success: false,
        message: "Required exit monitor fields are missing",
      });
    }

    if (!["CE", "PE"].includes(option_type)) {
      return res.status(400).json({
        success: false,
        message: "option_type must be CE or PE",
      });
    }

    const { rules, error: rulesError } = buildExitRules(req.body, option_type);

    if (rulesError) {
      return res.status(400).json({
        success: false,
        message: rulesError,
      });
    }

    /* -----------------------------------------
       BROKER ACCOUNT (must belong to the user)
    ----------------------------------------- */

    const brokerResult = await pool.query(
      `
      SELECT broker_name, credentials
      FROM broker_accounts
      WHERE id = $1
        AND user_id = $2
      `,
      [broker_account_id, user_id]
    );

    if (brokerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Broker account not found",
      });
    }

    const { broker_name, credentials } = brokerResult.rows[0];

    if (!SUPPORTED_BROKERS.includes(broker_name)) {
      return res.status(400).json({
        success: false,
        message: `Exit monitor is not supported for broker ${broker_name}`,
      });
    }

    /* -----------------------------------------
       INSERT MONITOR
    ----------------------------------------- */

    const result = await pool.query(
      `
      INSERT INTO exit_monitors (
        user_id,
        broker_account_id,
        symbol,
        security_id,
        index_name,
        index_security_id,
        option_type,
        strike,
        quantity,
        indicator_enabled,
        timeframe,
        indicator,
        indicator_period,
        tracking_source,
        price_exit_type,
        price_source,
        target_price,
        sl_price,
        trailing_start,
        trailing_points,
        current_sl,
        entry_price,
        entry_trade_id,
        status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21,
        $22, $23,
        'ACTIVE'
      )
      RETURNING *
      `,
      [
        user_id,
        broker_account_id,
        symbol,
        security_id || null,
        index_name || null,
        index_security_id || null,
        option_type,
        String(strike),
        quantity,
        rules.indicator_enabled,
        rules.timeframe,
        rules.indicator,
        rules.indicator_period,
        rules.tracking_source,
        rules.price_exit_type,
        rules.price_source,
        rules.target_price,
        rules.sl_price,
        rules.trailing_start,
        rules.trailing_points,
        rules.current_sl,
        entry_price || null,
        entry_trade_id || null,
      ]
    );

    const monitor = result.rows[0];

    /* -----------------------------------------
       CREATE STARTED LOG
    ----------------------------------------- */

    await pool.query(
      `
      INSERT INTO exit_monitor_logs (
        exit_monitor_id,
        event_type,
        message
      )
      VALUES ($1, 'STARTED', $2)
      `,
      [
        monitor.id,
        `Exit monitor started for ${symbol} ${strike} ${option_type}. Exits: ${describeExitRules(rules)}`,
      ]
    );

    /* -----------------------------------------
       TRIGGER PYTHON ENGINE
    ----------------------------------------- */

    let engine;

    try {
      const engineResponse = await axios.post(
        `${PYTHON_ENGINE_URL}/exit-monitor/start`,
        {
          monitor_id: monitor.id,
          user_id,
          broker_account_id,
          broker_name,
          credentials,
          symbol,
          security_id: security_id || undefined,
          index_name: index_name || undefined,
          index_security_id: index_security_id || undefined,
          option_type,
          strike: String(strike),
          quantity,
          ...omitNull(rules),
          entry_price: entry_price || undefined,
          entry_trade_id: entry_trade_id || undefined,
        },
        {
          headers: pythonHeaders,
          timeout: 30000, // includes indicator warm-up from Dhan history
        }
      );

      engine = engineResponse.data;
    } catch (pythonError) {
      console.error(
        "Python Exit Engine Start Error:",
        pythonError.response?.data || pythonError.message
      );

      /* Python returns 400 with a readable reason (bad strike, lot size ...) */
      const engineReason =
        typeof pythonError.response?.data?.detail === "string"
          ? pythonError.response.data.detail
          : null;

      /* -----------------------------------------
         PYTHON FAILED → MARK MONITOR FAILED
       ----------------------------------------- */

      await pool.query(
        `
        UPDATE exit_monitors
        SET status = 'FAILED'
        WHERE id = $1
        `,
        [monitor.id]
      );

      await pool.query(
        `
        INSERT INTO exit_monitor_logs (
          exit_monitor_id,
          event_type,
          message
        )
        VALUES ($1, 'ERROR', $2)
        `,
        [
          monitor.id,
          engineReason
            ? `Failed to start Python exit engine: ${engineReason}`
            : "Failed to start Python exit engine",
        ]
      );

      return res.status(pythonError.response?.status === 400 ? 400 : 500).json({
        success: false,
        message: engineReason || "Exit monitor created but Python engine failed to start",
        monitor_id: monitor.id,
      });
    }

    /* -----------------------------------------
       SAVE RESOLVED OPTION (Python resolves the current expiry contract)
    ----------------------------------------- */

    const updated = await pool.query(
      `
      UPDATE exit_monitors
      SET security_id = $2
      WHERE id = $1
      RETURNING *
      `,
      [monitor.id, engine.security_id]
    );

    if (engine.warning) {
      await pool.query(
        `
        INSERT INTO exit_monitor_logs (
          exit_monitor_id,
          event_type,
          message
        )
        VALUES ($1, 'SIGNAL', $2)
        `,
        [monitor.id, engine.warning]
      );
    }

    /* -----------------------------------------
       RESPONSE
    ----------------------------------------- */

    return res.status(201).json({
      success: true,
      message: "Exit monitor started successfully",
      monitor: updated.rows[0],
      tracking_symbol: engine.symbol,
      indicator_value: engine.indicator_value,
      warning: engine.warning,
    });
  } catch (error) {
    console.error("Create Exit Monitor Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create exit monitor",
    });
  }
};


/* =========================================================
   2. GET USER ACTIVE MONITORS
   GET /api/exit-monitor
   ========================================================= */

export const getUserExitMonitors = async (req, res) => {
  try {
    const user_id = req.user.id;

    const result = await pool.query(
      `
      SELECT *
      FROM exit_monitors
      WHERE user_id = $1
        AND status = 'ACTIVE'
      ORDER BY created_at DESC
      `,
      [user_id]
    );

    return res.json({
      success: true,
      monitors: result.rows,
    });
  } catch (error) {
    console.error("Get Exit Monitors Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch exit monitors",
    });
  }
};


/* =========================================================
   2b. MONITOR HISTORY FOR A DAY (all statuses)
   GET /api/exitmoniter/history?date=YYYY-MM-DD&status=FAILED
   date defaults to today (IST), status is optional
   ========================================================= */

const MONITOR_STATUSES = ["ACTIVE", "EXITED", "STOPPED", "FAILED"];

export const getExitMonitorHistory = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { date, status } = req.query;

    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        message: "date must be in YYYY-MM-DD format",
      });
    }

    if (status && !MONITOR_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `status must be one of ${MONITOR_STATUSES.join(", ")}`,
      });
    }

    const result = await pool.query(
      `
      SELECT
        m.*,
        l.event_type AS last_event,
        l.message AS last_message
      FROM exit_monitors m
      LEFT JOIN LATERAL (
        SELECT event_type, message
        FROM exit_monitor_logs
        WHERE exit_monitor_id = m.id
        ORDER BY created_at DESC
        LIMIT 1
      ) l ON true
      WHERE m.user_id = $1
        AND (m.created_at AT TIME ZONE 'Asia/Kolkata')::date =
            COALESCE($2::date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
        AND ($3::text IS NULL OR m.status = $3)
      ORDER BY m.created_at DESC
      `,
      [user_id, date || null, status || null]
    );

    return res.json({
      success: true,
      monitors: result.rows,
    });
  } catch (error) {
    console.error("Get Exit Monitor History Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch exit monitor history",
    });
  }
};


/* =========================================================
   3. GET SINGLE MONITOR
   GET /api/exit-monitor/:id
   ========================================================= */

export const getExitMonitor = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT *
      FROM exit_monitors
      WHERE id = $1
        AND user_id = $2
      `,
      [id, user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Exit monitor not found",
      });
    }

    return res.json({
      success: true,
      monitor: result.rows[0],
    });
  } catch (error) {
    console.error("Get Exit Monitor Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch exit monitor",
    });
  }
};


/* =========================================================
   4. STOP / CANCEL MONITOR
   POST /api/exit-monitor/:id/stop
   ========================================================= */

export const stopExitMonitor = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { id } = req.params;

    /* -----------------------------------------
       CHECK MONITOR
    ----------------------------------------- */

    const monitorResult = await pool.query(
      `
      SELECT *
      FROM exit_monitors
      WHERE id = $1
        AND user_id = $2
      `,
      [id, user_id]
    );

    if (monitorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Exit monitor not found",
      });
    }

    const monitor = monitorResult.rows[0];

    if (monitor.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: `Monitor is already ${monitor.status}`,
      });
    }

    /* -----------------------------------------
       TELL PYTHON ENGINE TO STOP
    ----------------------------------------- */

    try {
      await axios.post(
        `${PYTHON_ENGINE_URL}/exit-monitor/${id}/stop`,
        {},
        { headers: pythonHeaders, timeout: 10000 }
      );
    } catch (pythonError) {
      console.error(
        "Python Exit Engine Stop Error:",
        pythonError.response?.data || pythonError.message
      );

      return res.status(500).json({
        success: false,
        message: "Failed to stop exit monitor in Python engine",
      });
    }

    /* -----------------------------------------
       UPDATE DATABASE
    ----------------------------------------- */

    const result = await pool.query(
      `
      UPDATE exit_monitors
      SET status = 'STOPPED'
      WHERE id = $1
        AND user_id = $2
      RETURNING *
      `,
      [id, user_id]
    );

    await pool.query(
      `
      INSERT INTO exit_monitor_logs (
        exit_monitor_id,
        event_type,
        message
      )
      VALUES ($1, 'ERROR', $2)
      `,
      [
        id,
        "Exit monitor manually stopped",
      ]
    );

    return res.json({
      success: true,
      message: "Exit monitor stopped successfully",
      monitor: result.rows[0],
    });
  } catch (error) {
    console.error("Stop Exit Monitor Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to stop exit monitor",
    });
  }
};


/* =========================================================
   5. GET MONITOR LOGS
   GET /api/exit-monitor/:id/logs
   ========================================================= */

export const getExitMonitorLogs = async (req, res) => {
  try {
    const user_id = req.user.id;
    const { id } = req.params;

    /* -----------------------------------------
       VERIFY MONITOR BELONGS TO USER
    ----------------------------------------- */

    const monitorResult = await pool.query(
      `
      SELECT id
      FROM exit_monitors
      WHERE id = $1
        AND user_id = $2
      `,
      [id, user_id]
    );

    if (monitorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Exit monitor not found",
      });
    }

    /* -----------------------------------------
       FETCH LOGS
    ----------------------------------------- */

    const result = await pool.query(
      `
      SELECT *
      FROM exit_monitor_logs
      WHERE exit_monitor_id = $1
      ORDER BY created_at ASC
      `,
      [id]
    );

    return res.json({
      success: true,
      logs: result.rows,
    });
  } catch (error) {
    console.error("Get Exit Monitor Logs Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch exit monitor logs",
    });
  }
};


/* =========================================================
   6. PYTHON → EXPRESS EXIT UPDATE
   POST /api/exit-monitor/:id/exit
   ========================================================= */

export const handleExitMonitorExit = async (req, res) => {
  try {
    /* -----------------------------------------
       ONLY THE PYTHON ENGINE MAY CALL THIS
    ----------------------------------------- */

    if (
      !EXIT_ENGINE_SECRET ||
      req.headers["x-exit-engine-secret"] !== EXIT_ENGINE_SECRET
    ) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { id } = req.params;

    const {
      exit_trade_id,
      exit_price,
      message,
      exit_reason,
    } = req.body;

    /* -----------------------------------------
       CHECK MONITOR
    ----------------------------------------- */

    const monitorResult = await pool.query(
      `
      SELECT *
      FROM exit_monitors
      WHERE id = $1
      `,
      [id]
    );

    if (monitorResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Exit monitor not found",
      });
    }

    /* -----------------------------------------
       UPDATE MONITOR
    ----------------------------------------- */

    const result = await pool.query(
      `
      UPDATE exit_monitors
      SET
        status = 'EXITED',
        exit_trade_id = $2,
        exit_reason = $3,
        exited_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        exit_trade_id || null,
        EXIT_REASONS.includes(exit_reason) ? exit_reason : null,
      ]
    );

    /* -----------------------------------------
       CREATE EXIT LOG
    ----------------------------------------- */

    await pool.query(
      `
      INSERT INTO exit_monitor_logs (
        exit_monitor_id,
        event_type,
        message
      )
      VALUES ($1, 'EXIT', $2)
      `,
      [
        id,
        message ||
          `Exit detected at price ${exit_price ?? "N/A"}`,
      ]
    );

    return res.json({
      success: true,
      message: "Exit monitor updated successfully",
      monitor: result.rows[0],
    });
  } catch (error) {
    console.error("Handle Exit Monitor Exit Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update exit monitor",
    });
  }
};
 


/* =========================================================
   PYTHON ENGINE ONLY (x-exit-engine-secret)
   ========================================================= */

const isEngineRequest = (req) =>
  Boolean(EXIT_ENGINE_SECRET) &&
  req.headers["x-exit-engine-secret"] === EXIT_ENGINE_SECRET;


/* =========================================================
   7. ACTIVE MONITORS FOR ENGINE RESTART RECOVERY
   GET /api/exitmoniter/engine/active
   ========================================================= */

export const getEngineActiveMonitors = async (req, res) => {
  try {
    if (!isEngineRequest(req)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const result = await pool.query(
      `
      SELECT
        m.*,
        b.broker_name,
        b.credentials
      FROM exit_monitors m
      JOIN broker_accounts b
        ON b.id = m.broker_account_id
      WHERE m.status = 'ACTIVE'
      ORDER BY m.created_at ASC
      `
    );

    return res.json({
      success: true,
      monitors: result.rows,
    });
  } catch (error) {
    console.error("Get Engine Active Monitors Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch active monitors",
    });
  }
};


/* =========================================================
   8. ENGINE CLOSES A MONITOR (auto-close time / restart failure)
   POST /api/exitmoniter/:id/engine-close
   body: { status: "STOPPED" | "FAILED", message }
   ========================================================= */

export const closeMonitorFromEngine = async (req, res) => {
  try {
    if (!isEngineRequest(req)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { id } = req.params;
    const { status, message } = req.body;

    if (!["STOPPED", "FAILED"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "status must be STOPPED or FAILED",
      });
    }

    /* Only close monitors that are still ACTIVE (an exit may have won the race) */
    const result = await pool.query(
      `
      UPDATE exit_monitors
      SET status = $2
      WHERE id = $1
        AND status = 'ACTIVE'
      RETURNING *
      `,
      [id, status]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        closed: false,
        message: "Monitor was not active",
      });
    }

    await pool.query(
      `
      INSERT INTO exit_monitor_logs (
        exit_monitor_id,
        event_type,
        message
      )
      VALUES ($1, 'ERROR', $2)
      `,
      [id, message || `Exit monitor ${status.toLowerCase()} by engine`]
    );

    return res.json({
      success: true,
      closed: true,
      monitor: result.rows[0],
    });
  } catch (error) {
    console.error("Close Monitor From Engine Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to close exit monitor",
    });
  }
};


/* =========================================================
   9. ENGINE SAVES THE TRAILING SL (so a restart resumes from it)
   POST /api/exitmoniter/:id/engine-state
   body: { current_sl, message? }
   The SL can only move in the profit direction, so a late or
   repeated update can never loosen it.
   ========================================================= */

export const updateMonitorStateFromEngine = async (req, res) => {
  try {
    if (!isEngineRequest(req)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { id } = req.params;
    const current_sl = toNumber(req.body.current_sl);

    if (!isPositive(current_sl)) {
      return res.status(400).json({
        success: false,
        message: "current_sl must be a positive number",
      });
    }

    const result = await pool.query(
      `
      UPDATE exit_monitors
      SET current_sl = $2
      WHERE id = $1
        AND status = 'ACTIVE'
        AND price_exit_type = 'TRAILING'
        AND (
          current_sl IS NULL
          OR (price_source = 'INDEX' AND option_type = 'PE' AND $2 < current_sl)
          OR (NOT (price_source = 'INDEX' AND option_type = 'PE') AND $2 > current_sl)
        )
      RETURNING current_sl
      `,
      [id, current_sl]
    );

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        updated: false,
        message: "Nothing to update",
      });
    }

    await pool.query(
      `
      INSERT INTO exit_monitor_logs (
        exit_monitor_id,
        event_type,
        message
      )
      VALUES ($1, 'SIGNAL', $2)
      `,
      [id, req.body.message || `Trailing SL moved to ${current_sl}`]
    );

    return res.json({
      success: true,
      updated: true,
      current_sl: result.rows[0].current_sl,
    });
  } catch (error) {
    console.error("Update Monitor State From Engine Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update exit monitor state",
    });
  }
};
