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
      `INSERT INTO deployments (user_id, strategy_id, type, broker_account_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [user_id, strategy_id, type, broker_account_id || null]
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