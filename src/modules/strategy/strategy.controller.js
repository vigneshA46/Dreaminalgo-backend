import pool from "../../config/db.js";

/*
  GET ALL STRATEGIES (User sees only ACTIVE)
*/
export const getStrategies = async (req, res) => {
  try {
    const { search, paid } = req.query;

    let values = [];

    let baseQuery = `
      SELECT 
        s.*,
        tl.latest_date,
        COALESCE(pt.cum_pnl, 0) AS latest_cum_pnl

      FROM strategies s

      LEFT JOIN (
        SELECT 
          startergy_id::uuid AS strategy_id,
          MAX(date) AS latest_date
        FROM trade_legs
        GROUP BY startergy_id
      ) tl ON tl.strategy_id = s.id

      LEFT JOIN LATERAL (
        SELECT 
          CAST(cum_pnl AS NUMERIC) AS cum_pnl
        FROM paper_trades
        WHERE strategy_id::uuid = s.id
          AND DATE(timestamp) = tl.latest_date
          AND event_type = 'EXIT'
        ORDER BY timestamp DESC
        LIMIT 1
      ) pt ON true

      WHERE s.status = 'active'
    `;

    // 🔍 filters
    if (search) {
      values.push(`%${search}%`);
      baseQuery += ` AND s.name ILIKE $${values.length}`;
    }

    if (paid !== undefined) {
      values.push(paid === "true");
      baseQuery += ` AND s.is_paid = $${values.length}`;
    }

    // ✅ main data query
    const dataQuery = baseQuery + ` ORDER BY s.created_at DESC`;

    const result = await pool.query(dataQuery, values);

    // ✅ overall pnl query (wrap the same query)
    const overallQuery = `
      SELECT COALESCE(SUM(latest_cum_pnl), 0) AS overall_pnl
      FROM (${baseQuery}) AS sub
    `;

    const overallResult = await pool.query(overallQuery, values);

    res.json({
      strategies: result.rows,
      overall_pnl: overallResult.rows[0].overall_pnl
    });

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
 