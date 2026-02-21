import pool from "../../config/db.js";

/*
  GET ALL STRATEGIES (User sees only ACTIVE)
*/

export const getStrategies = async (req, res) => {
  try {
    const { search, paid } = req.query;

    let query = `
      SELECT *
      FROM strategies
      WHERE status = 'active'
    `;

    const values = [];

    if (search) {
      values.push(`%${search}%`);
      query += ` AND name ILIKE $${values.length}`;
    }

    if (paid !== undefined) {
      values.push(paid === "true");
      query += ` AND is_paid = $${values.length}`;
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, values);

    res.json(result.rows);
  } catch (error) {
    console.error("Get Strategies Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  GET SINGLE STRATEGY
*/

export const getStrategyById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM strategies WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Get Strategy Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  CREATE STRATEGY (Admin)
*/

export const createStrategy = async (req, res) => {
  try {
    const adminId = req.user.id;

    const {
      name,
      description,
      capitalRequired,
      tokensRequired,
      isPaid
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Strategy name required" });
    }

    const result = await pool.query(
      `
      INSERT INTO strategies
      (name, description, created_by, is_admin_strategy,
       capital_required, tokens_required, is_paid, status)
      VALUES ($1,$2,$3,true,$4,$5,$6,'pending')
      RETURNING *
      `,
      [
        name,
        description,
        adminId,
        capitalRequired,
        tokensRequired,
        isPaid
      ]
    );

    res.status(201).json({
      message: "Strategy created successfully",
      strategy: result.rows[0]
    });

  } catch (error) {
    console.error("Create Strategy Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  UPDATE STRATEGY DETAILS
*/

export const updateStrategy = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      description,
      capitalRequired,
      tokensRequired,
      isPaid
    } = req.body;

    const result = await pool.query(
      `
      UPDATE strategies
      SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        capital_required = COALESCE($3, capital_required),
        tokens_required = COALESCE($4, tokens_required),
        is_paid = COALESCE($5, is_paid),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
      `,
      [name, description, capitalRequired, tokensRequired, isPaid, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    res.json({
      message: "Strategy updated",
      strategy: result.rows[0]
    });

  } catch (error) {
    console.error("Update Strategy Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  UPDATE STRATEGY STATUS
*/

export const updateStrategyStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = await pool.query(
      `
      UPDATE strategies
      SET status = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    res.json({
      message: "Status updated",
      strategy: result.rows[0]
    });

  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};

/*
  DELETE STRATEGY (Soft Delete)
*/

export const deleteStrategy = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE strategies
      SET status = 'disabled'
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    res.json({ message: "Strategy disabled successfully" });

  } catch (error) {
    console.error("Delete Strategy Error:", error);
    res.status(500).json({ error: "Server error" });
  }
};
 