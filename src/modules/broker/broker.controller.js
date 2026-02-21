import pool from "../../config/db.js";

/*
  CONNECT BROKER
*/
export const connectBroker = async (req, res) => {
  try {
    const userId = req.user.id;
    const { brokerName, clientId, credentials } = req.body;

    if (!brokerName || !clientId || !credentials) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await pool.query(
      `
      INSERT INTO broker_accounts
      (user_id, broker_name, client_id, credentials)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [userId, brokerName, clientId, credentials]
    );

    res.status(201).json({
      message: "Broker connected successfully",
      broker: result.rows[0],
    });

  } catch (error) {
    console.error("Connect Broker Error:", error);

    if (error.code === "23505") {
      return res.status(400).json({
        error: "Broker already connected",
      });
    }

    res.status(500).json({ error: "Server error" });
  }
};

/*
  GET ALL USER BROKERS
*/
export const getUserBrokers = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT id, broker_name, client_id, status, token_expires_at, created_at
      FROM broker_accounts
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId]
    );

    res.json(result.rows);

  } catch (error) {
    console.error("Get Brokers Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  GET SINGLE BROKER
*/
export const getBrokerById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT id, broker_name, client_id, status, token_expires_at, created_at
      FROM broker_accounts
      WHERE id = $1 AND user_id = $2
      `,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Broker not found" });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error("Get Broker Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  DELETE BROKER
*/
export const deleteBroker = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM broker_accounts
      WHERE id = $1 AND user_id = $2
      RETURNING id
      `,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Broker not found" });
    }

    res.json({ message: "Broker disconnected successfully" });

  } catch (error) {
    console.error("Delete Broker Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  ADMIN: UPDATE BROKER STATUS
*/
export const updateBrokerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(
      `
      UPDATE broker_accounts
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Broker not found" });
    }

    res.json({
      message: "Status updated",
      broker: result.rows[0],
    });

  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};