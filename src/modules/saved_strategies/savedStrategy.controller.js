import pool from "../../config/db.js";


/*
  CREATE / SAVE STRATEGY

  Logged-in user saves an existing strategy.
*/
export const createSavedStrategy = async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategyId } = req.body;

    if (!strategyId) {
      return res.status(400).json({
        error: "Strategy ID is required"
      });
    }

    /*
      Get original strategy
    */
    const strategyResult = await pool.query(
      `
      SELECT *
      FROM strategies
      WHERE id = $1
        AND status = 'active'
      `,
      [strategyId]
    );

    if (strategyResult.rows.length === 0) {
      return res.status(404).json({
        error: "Strategy not found or not active"
      });
    }

    const strategy = strategyResult.rows[0];

    /*
      Check whether user already saved this strategy
    */
    const existingResult = await pool.query(
      `
      SELECT id
      FROM saved_strategies
      WHERE user_id = $1
        AND strategy_id = $2
      `,
      [userId, strategyId]
    );

    if (existingResult.rows.length > 0) {
      return res.status(409).json({
        error: "Strategy already saved"
      });
    }

    /*
      Create saved strategy
    */
    const result = await pool.query(
      `
      INSERT INTO saved_strategies
      (
        user_id,
        strategy_id,

        name,
        description,
        created_by,
        is_admin_strategy,

        state_id,
        capital_required,
        tokens_required,

        reducetokenonmultiplies,
        reductionmultiplier,

        status,
        category,
        is_paid,

        starting_time,
        ending_time,

        is_user_feature,
        users
      )
      VALUES
      (
        $1,
        $2,

        $3,
        $4,
        $5,
        $6,

        $7,
        $8,
        $9,

        $10,
        $11,

        'active',
        $12,
        $13,

        $14,
        $15,

        $16,
        $17
      )
      RETURNING *
      `,
      [
        userId,
        strategy.id,

        strategy.name,
        strategy.description,
        strategy.created_by,
        strategy.is_admin_strategy,

        strategy.state_id,
        strategy.capital_required,
        strategy.tokens_required,

        strategy.reducetokenonmultiplies,
        strategy.reductionmultiplier,

        strategy.category,
        strategy.is_paid,

        strategy.starting_time,
        strategy.ending_time,

        strategy.is_user_feature,
        strategy.users
      ]
    );

    res.status(201).json({
      message: "Strategy saved successfully",
      strategy: result.rows[0]
    });

  } catch (error) {
    console.error("Create Saved Strategy Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};


/*
  GET MY SAVED STRATEGIES

  Returns saved strategies belonging to
  the currently authenticated user.
*/
export const getMySavedStrategies = async (req, res) => {
  try {
    const userId = req.user.id;
    const { search, paid } = req.query;

    let values = [userId];

    let baseQuery = `
      SELECT
        ss.*,

        tl.latest_date,

        COALESCE(pt.cum_pnl, 0) AS latest_cum_pnl

      FROM saved_strategies ss

      LEFT JOIN (
        SELECT
          CASE
            WHEN startergy_id ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN startergy_id::uuid
          END AS strategy_id,

          MAX(date) AS latest_date

        FROM trade_legs

        GROUP BY startergy_id
      ) tl
        ON tl.strategy_id = ss.strategy_id

      LEFT JOIN LATERAL (
        SELECT
          CAST(cum_pnl AS NUMERIC) AS cum_pnl

        FROM paper_trades

        WHERE strategy_id::uuid = ss.strategy_id

          AND DATE(timestamp) = tl.latest_date

          AND event_type = 'EXIT'

        ORDER BY timestamp DESC

        LIMIT 1
      ) pt ON true

      WHERE ss.user_id = $1
        AND ss.status = 'active'
    `;

    /*
      Search
    */
    if (search) {
      values.push(`%${search}%`);

      baseQuery += `
        AND ss.name ILIKE $${values.length}
      `;
    }

    /*
      Paid filter
    */
    if (paid !== undefined) {
      values.push(paid === "true");

      baseQuery += `
        AND ss.is_paid = $${values.length}
      `;
    }

    /*
      Main query
    */
    const dataQuery = `
      ${baseQuery}
      ORDER BY ss.created_at DESC
    `;

    const result = await pool.query(
      dataQuery,
      values
    );

    /*
      Overall PNL
    */
    const overallQuery = `
      SELECT
        COALESCE(SUM(latest_cum_pnl), 0) AS overall_pnl

      FROM (
        ${baseQuery}
      ) AS sub
    `;

    const overallResult = await pool.query(
      overallQuery,
      values
    );

    res.json({
      strategies: result.rows,
      overall_pnl: overallResult.rows[0].overall_pnl
    });

  } catch (error) {
    console.error("Get My Saved Strategies Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};


/*
  GET ALL SAVED STRATEGIES

  Admin can see all users' saved strategies.
*/
export const getAllSavedStrategies = async (req, res) => {
  try {
    const { search, paid, userId } = req.query;

    let values = [];

    let baseQuery = `
      SELECT
        ss.*,

        u.fullname,
        u.mobile_number

      FROM saved_strategies ss

      LEFT JOIN users u
        ON u.id = ss.user_id

      WHERE ss.status = 'active'
    `;

    /*
      Search by strategy name
    */
    if (search) {
      values.push(`%${search}%`);

      baseQuery += `
        AND ss.name ILIKE $${values.length}
      `;
    }

    /*
      Paid filter
    */
    if (paid !== undefined) {
      values.push(paid === "true");

      baseQuery += `
        AND ss.is_paid = $${values.length}
      `;
    }

    /*
      Filter by user
    */
    if (userId) {
      values.push(userId);

      baseQuery += `
        AND ss.user_id = $${values.length}
      `;
    }

    const result = await pool.query(
      `
      ${baseQuery}
      ORDER BY ss.created_at DESC
      `,
      values
    );

    res.json({
      strategies: result.rows
    });

  } catch (error) {
    console.error("Get All Saved Strategies Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};


/*
  DELETE / REMOVE SAVED STRATEGY

  User can remove only their own saved strategy.
*/
export const deleteSavedStrategy = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `
      DELETE FROM saved_strategies
      WHERE id = $1
        AND user_id = $2
      RETURNING id
      `,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Saved strategy not found"
      });
    }

    res.json({
      message: "Saved strategy removed successfully"
    });

  } catch (error) {
    console.error("Delete Saved Strategy Error:", error);

    res.status(500).json({
      error: "Server error"
    });
  }
};
