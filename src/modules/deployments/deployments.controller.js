import pool from "../../config/db.js";


const IST_OFFSET = 5.5 * 60 * 60 * 1000;

function getISTStartEndOfDay() {
  const now = new Date();
  const istNow = new Date(now.getTime() + IST_OFFSET);

  const start = new Date(istNow);
  start.setHours(0, 0, 0, 0);

  const end = new Date(istNow);
  end.setHours(23, 59, 59, 999);

  return {
    start: new Date(start.getTime() - IST_OFFSET),
    end: new Date(end.getTime() - IST_OFFSET)
  };
}

export const createDeployment = async (req, res) => {
  const client = await pool.connect();

  try {
    const { strategy_id, type, broker_account_id, multiplier } = req.body;
    const user_id = req.user.id;

    await client.query("BEGIN");

    // 🔒 Lock user row
    const userRes = await client.query(
      `SELECT tokens FROM users WHERE id = $1 FOR UPDATE`,
      [user_id]
    );

    if (!userRes.rows.length) {
      throw new Error("User not found");
    }

    const tokens = userRes.rows[0].tokens;

    if (tokens <= 0) {
      throw new Error("Insufficient tokens");
    }

    // ➖ Deduct token
    await client.query(
      `UPDATE users SET tokens = tokens - 1 WHERE id = $1`,
      [user_id]
    );

    /* -----------------------------------------
       1. UPSERT DEPLOYMENT CONFIG
    ----------------------------------------- */
    await client.query(
      `
      INSERT INTO deployment_configs 
        (user_id, strategy_id, broker_account_id, type, multiplier, auto_deploy)
      VALUES ($1, $2, $3, $4, $5, true)

      ON CONFLICT (user_id, strategy_id, broker_account_id, type)
      DO UPDATE SET
        multiplier = EXCLUDED.multiplier,
        auto_deploy = true,
        created_at = CURRENT_TIMESTAMP
      `,
      [user_id, strategy_id, broker_account_id || null, type, multiplier]
    );

    /* -----------------------------------------
       2. INSERT TODAY DEPLOYMENT
    ----------------------------------------- */
    const result = await client.query(
      `
      INSERT INTO deployments 
        (user_id, strategy_id, type, broker_account_id, multiplier, status)
      VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
      RETURNING *
      `,
      [user_id, strategy_id, type, broker_account_id || null, multiplier]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      deployment: result.rows[0]
    });

  } catch (err) {
    await client.query("ROLLBACK");

    res.status(400).json({
      success: false,
      message: err.message
    });
  } finally {
    client.release();
  }
};

export const getTodayDeploymentsByStrategy = async (req, res) => {
  try {
    const { strategy_id } = req.params;

    const result = await pool.query(
      `SELECT d.*, b.broker_name, b.credentials , b.id
       FROM deployments d
       LEFT JOIN broker_accounts b
       ON d.broker_account_id = b.id
       WHERE d.strategy_id = $1
       AND d.status = 'ACTIVE'
       AND d.deployed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'
           BETWEEN date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
           AND date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day' - interval '1 second'`,
      [strategy_id]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getTodayDeploymentsByStrategyAndType = async (req, res) => {
  try {
    const { strategy_id, type } = req.params;

    const { start, end } = getISTStartEndOfDay();

    const result = await pool.query(
      `SELECT d.*, b.broker_name, b.credentials
       FROM deployments d
       LEFT JOIN broker_accounts b
       ON d.broker_account_id = b.id
       WHERE d.strategy_id = $1
       AND d.type = $2
       AND d.deployed_at BETWEEN $3 AND $4`,
      [strategy_id, type, start, end]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getUserDeployments = async (req, res) => {
  try {
    const user_id = req.user.id;

    const result = await pool.query(
      `SELECT * FROM deployments
       WHERE user_id = $1
       ORDER BY deployed_at DESC`,
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


export const getUsertodayDeployment = async (req, res) => {
  try {

    const user_id = req.user.id;


    const result = await pool.query(
  `SELECT d.*
   FROM deployments d
   WHERE d.user_id = $1
   AND d.status = "ACTIVE"
   AND d.deployed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'
       BETWEEN date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
       AND date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day' - interval '1 second'`,
  [user_id]
   );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


export const getDeploymentsByDate = async (req, res) => {
  try {
    const { date } = req.query; // format: YYYY-MM-DD

    if (!date) {
      return res.status(400).json({ error: "Date is required" });
    }

    const result = await pool.query(
      `SELECT d.*, u.fullname, u.email, u.mobile_number
       FROM deployments d
       JOIN users u ON d.user_id = u.id
       WHERE d.deployed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'
       BETWEEN $1::date
       AND $1::date + interval '1 day' - interval '1 second'
       ORDER BY d.deployed_at DESC`,
      [date]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


export const getDeploymentsGroupedByStrategy = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
          d.strategy_id,

          COUNT(*) as total_deployments,

          COUNT(*) FILTER (WHERE d.type = 'LIVE') as live_count,
          COUNT(*) FILTER (WHERE d.type = 'PAPER') as paper_count,

          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', d.id,
              'type', d.type,
              'deployed_at', d.deployed_at,
              'multiplier', d.multiplier,
              'user', JSON_BUILD_OBJECT(
                'id', u.id,
                'fullname', u.fullname,
                'email', u.email,
                'mobile_number', u.mobile_number
              )
            )
          ) as deployments

       FROM deployments d
       JOIN users u ON d.user_id = u.id

       GROUP BY d.strategy_id
       ORDER BY d.strategy_id`
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


export const getUserDeploymentsGroupedWithPnl = async (req, res) => {
  try {
    const user_id = req.user.id;

    const result = await pool.query(
      `
      WITH user_deployments AS (
        SELECT 
          d.*,
          s.name as strategy_name,
          DATE(d.deployed_at AT TIME ZONE 'Asia/Kolkata') as deploy_date
        FROM deployments d
        JOIN strategies s ON d.strategy_id = s.id
        WHERE d.user_id = $1
      ),

      /* ---------------- DAILY CUM PNL ---------------- */
      daily_cum AS (
        SELECT 
          strategy_id,
          DATE(timestamp AT TIME ZONE 'Asia/Kolkata') as date,

          (ARRAY_AGG(cum_pnl::NUMERIC ORDER BY timestamp DESC))[1] as day_cum_pnl

        FROM paper_trades
        WHERE event_type = 'EXIT'
        GROUP BY strategy_id, DATE(timestamp AT TIME ZONE 'Asia/Kolkata')
      ),

      /* ---------------- DAILY PNL ---------------- */
      daily_pnl AS (
        SELECT 
          strategy_id,
          date,
          day_cum_pnl,

          day_cum_pnl - COALESCE(
            LAG(day_cum_pnl) OVER (
              PARTITION BY strategy_id ORDER BY date
            ),
            0
          ) as day_pnl

        FROM daily_cum
      ),

      /* ---------------- TODAY PNL ---------------- */
      today_pnl AS (
        SELECT strategy_id,
               COALESCE(day_cum_pnl, 0) as today_cum_pnl
        FROM daily_cum
        WHERE date = CURRENT_DATE
      ),

      /* ---------------- OVERALL PNL ---------------- */
      overall_pnl AS (
        SELECT strategy_id,
               (ARRAY_AGG(cum_pnl::NUMERIC ORDER BY timestamp DESC))[1] as overall_cum_pnl
        FROM paper_trades
        WHERE event_type = 'EXIT'
        GROUP BY strategy_id
      )

      SELECT 
        ud.strategy_id,
        ud.strategy_name,

        COUNT(*) as total_deployments,

        JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', ud.id,
            'type', ud.type,
            'multiplier', ud.multiplier,
            'deployed_at', ud.deployed_at,

            /* 🔥 DEPLOYMENT DAY PNL */
            'pnl', COALESCE(dp.day_pnl, 0)
          )
          ORDER BY ud.deployed_at DESC
        ) as deployments,

        COALESCE(tp.today_cum_pnl, 0) as today_cumulative_pnl,
        COALESCE(op.overall_cum_pnl, 0) as overall_cumulative_pnl

      FROM user_deployments ud

      LEFT JOIN daily_pnl dp 
        ON ud.strategy_id = dp.strategy_id 
        AND ud.deploy_date = dp.date

      LEFT JOIN today_pnl tp ON ud.strategy_id = tp.strategy_id
      LEFT JOIN overall_pnl op ON ud.strategy_id = op.strategy_id

      GROUP BY 
        ud.strategy_id, 
        ud.strategy_name,
        tp.today_cum_pnl,
        op.overall_cum_pnl

      ORDER BY ud.strategy_name;
      `,
      [user_id]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error("Grouped Deployment PnL Error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch grouped deployments"
    });
  }
};


export const getTodayDeploymentsGroupedByStrategy = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id as strategy_id,
        s.name as strategy_name,

        COUNT(d.id) as total_deployments,

        COUNT(*) FILTER (WHERE d.type = 'LIVE') as live_count,
        COUNT(*) FILTER (WHERE d.type = 'PAPER') as paper_count,

        JSON_AGG(
          JSON_BUILD_OBJECT(
            'deployment_id', d.id,
            'type', d.type,
            'multiplier', d.multiplier,
            'deployed_at', d.deployed_at,

            'user', JSON_BUILD_OBJECT(
              'id', u.id,
              'fullname', u.fullname,
              'email', u.email,
              'mobile_number', u.mobile_number
            )
          )
          ORDER BY d.deployed_at DESC
        ) FILTER (WHERE d.id IS NOT NULL) as deployments

      FROM strategies s

      LEFT JOIN deployments d 
        ON d.strategy_id = s.id
        AND d.deployed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'
            BETWEEN date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata')
            AND date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') + interval '1 day' - interval '1 second'

      LEFT JOIN users u ON d.user_id = u.id

      GROUP BY s.id, s.name
      ORDER BY s.name;
    `);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (err) {
    console.error("Today grouped deployments error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch today's deployments"
    });
  }
};


export const getTodayDeploymentsByType = async (req, res) => {
  try {
    const { start, end } = getISTStartEndOfDay();

    const result = await pool.query(
      `SELECT d.*, b.broker_name, b.credentials
       FROM deployments d
       LEFT JOIN broker_accounts b
       ON d.broker_account_id = b.id
       WHERE d.deployed_at BETWEEN $1 AND $2`,
      [start, end]
    );

    res.json(result.rows);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


export const updateDeploymentStatusByDate = async (req, res) => {
  try {
    const { strategy_id, broker_account_id, date, status , user_id } = req.body;

    if (!date || !status) {
      return res.status(400).json({
        success: false,
        message: "date and status are required"
      });
    }

    const result = await pool.query(
      `
      UPDATE deployments
      SET status = $5
      WHERE user_id = $1
      AND strategy_id = $2
      AND (
        broker_account_id = $3 
        OR ($3 IS NULL AND broker_account_id IS NULL)
      )
      AND DATE(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') = $4
      RETURNING *;
      `,
      [user_id, strategy_id, broker_account_id || null, date, status]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No matching deployment found"
      });
    }

    res.json({
      success: true,
      updated: result.rows
    });

  } catch (err) {
    console.error("Update deployment status error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

export const stopDeployment = async (req, res) => {
  const client = await pool.connect();

  try {
    const { strategy_id, broker_account_id } = req.query;
    const user_id = req.user.id;

    await client.query("BEGIN");

    /* -----------------------------------------
       1. STOP AUTO DEPLOY (FUTURE)
    ----------------------------------------- */
    await client.query(
      `UPDATE deployment_configs
       SET auto_deploy = false
       WHERE user_id = $1
       AND strategy_id = $2
       AND broker_account_id IS NOT DISTINCT FROM $3`,
      [user_id, strategy_id, broker_account_id || null]
    );

    /* -----------------------------------------
       2. STOP TODAY'S DEPLOYMENT
    ----------------------------------------- */
    await client.query(
      `UPDATE deployments
       SET status = 'STOPPED'
       WHERE user_id = $1
       AND strategy_id = $2
       AND broker_account_id IS NOT DISTINCT FROM $3
       AND DATE(deployed_at AT TIME ZONE 'Asia/Kolkata') = CURRENT_DATE`,
      [user_id, strategy_id, broker_account_id || null]
    );

    await client.query("COMMIT");

    res.json({ success: true });

  } catch (err) {
    await client.query("ROLLBACK");

    res.status(500).json({
      success: false,
      message: err.message
    });
  } finally {
    client.release();
  }
};

export const exitDeployment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Deployment ID is required" });
    }

    const result = await pool.query(
      `UPDATE deployments
       SET status = 'CLOSED'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Deployment not found" });
    }

    res.json({
      message: "Deployment exited successfully",
      deployment: result.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
