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
    const { strategy_id, type, broker_account_id ,multiplier} = req.body;
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

    // ✅ Insert deployment
    const result = await client.query(
      `INSERT INTO deployments (user_id, strategy_id, type, broker_account_id , multiplier)
       VALUES ($1, $2, $3, $4 , $5)
       RETURNING *`,
      [user_id, strategy_id, type, broker_account_id || null , multiplier]
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

    const { start, end } = getISTStartEndOfDay();

    const result = await pool.query(
      `SELECT d.*, b.broker_name, b.credentials
       FROM deployments d
       LEFT JOIN broker_accounts b
       ON d.broker_account_id = b.id
       WHERE d.strategy_id = $1
       AND d.deployed_at BETWEEN $2 AND $3`,
      [strategy_id, start, end]
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

