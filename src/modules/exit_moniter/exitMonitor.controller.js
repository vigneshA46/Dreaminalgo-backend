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
      timeframe,
      indicator,
      indicator_period,
      tracking_source,
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
      !quantity ||
      !timeframe ||
      !indicator ||
      !tracking_source
    ) {
      return res.status(400).json({
        success: false,
        message: "Required exit monitor fields are missing",
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
        timeframe,
        indicator,
        indicator_period,
        tracking_source,
        entry_price,
        entry_trade_id,
        status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14, $15,
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
        timeframe,
        indicator,
        indicator_period || null,
        tracking_source,
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
        `Exit monitor started for ${symbol}`,
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
          timeframe,
          indicator,
          indicator_period: indicator_period || undefined,
          tracking_source,
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
        exited_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [
        id,
        exit_trade_id || null,
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
 