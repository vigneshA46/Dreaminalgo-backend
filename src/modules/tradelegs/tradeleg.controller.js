import pool from "../../config/db.js";

/* CREATE LEG */
export const createLeg = async (req, res) => {
  try {

    const { strategy_id, leg, symbol, strike_price, date , token} = req.body;

    const result = await pool.query(
      `
      INSERT INTO trade_legs (startergy_id, leg, symbol, strike_price, date, token)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [strategy_id, leg, symbol, strike_price, date, token]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to create trade leg"
    });
  }
};



/* GET LEGS BY DATE + STRATEGY */
export const getLegsByDate = async (req, res) => {
  try {

    const { strategy_id, date } = req.query;

    const result = await pool.query(
      `
      SELECT *,
             COALESCE(pnl, 0) as pnl
      FROM trade_legs
      WHERE startergy_id = $1
      AND date = $2
      ORDER BY date DESC
      `,
      [strategy_id, date]
    );

    // ✅ calculate total pnl
    const total_pnl = result.rows.reduce((sum, leg) => {
      return sum + parseFloat(leg.pnl || 0);
    }, 0);

    res.json({
      success: true,
      data: result.rows,
      total_pnl
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch trade legs"
    });
  }
};


/* GET LATEST LEGS BY STRATEGY */
export const getLatestLegs = async (req, res) => {
  try {

    const { strategy_id } = req.params;

    const result = await pool.query(
      `
      SELECT *,
             COALESCE(pnl, 0) as pnl
      FROM trade_legs
      WHERE startergy_id = $1
      ORDER BY date DESC
      LIMIT 10
      `,
      [strategy_id]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch latest trade legs"
    });
  }
};
/*
-----------------------------------------
GET ALL DATES BY STRATEGY
-----------------------------------------
*/

export const getDatesByStrategy = async (req, res) => {
  try {
    const { strategy_id } = req.params;

    const result = await pool.query(
      `
      SELECT 
        TO_CHAR(date, 'YYYY-MM-DD') as date,
        COALESCE(CAST(cum_pnl AS NUMERIC), 0) as total_pnl
      FROM (
        SELECT DISTINCT ON (DATE(timestamp))
          DATE(timestamp) as date,
          cum_pnl,
          timestamp
        FROM paper_trades
        WHERE strategy_id = $1
        AND event_type = 'EXIT'
        ORDER BY DATE(timestamp), timestamp DESC   -- 🔥 latest per day
      ) t
      ORDER BY date DESC
      `,
      [strategy_id]
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch dates with pnl"
    });
  }
};

export const updateLegPnl = async (req, res) => {
  try {

    const { strategy_id, date, token, pnl } = req.body;

    const result = await pool.query(
      `
      UPDATE trade_legs
      SET pnl = $1
      WHERE startergy_id = $2
      AND date = $3
      AND token = $4
      RETURNING *
      `,
      [pnl, strategy_id, date, token]
    );

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {

    console.error("Update PnL Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to update pnl"
    });
  }
};



export const getStrategyDetailedPnl = async (req, res) => {
  try {

    const { strategy_id, date } = req.query;

    /* ------------------------ -----------------
       1. GET LEGS
    ----------------------------------------- */
    const legsResult = await pool.query(
      `
      SELECT DISTINCT ON (token) *
      FROM trade_legs
      WHERE startergy_id = $1
      AND date = $2
      ORDER BY token, date DESC
      `,
      [strategy_id, date]
    );

    const legs = legsResult.rows;

    /* -----------------------------------------
       2. GET PNL FOR EACH TOKEN
    ----------------------------------------- */
    const legPnls = {};

    for (const leg of legs) {

      const pnlResult = await pool.query(
        `
        SELECT COALESCE(CAST(pnl AS NUMERIC), 0) as pnl
        FROM paper_trades
        WHERE strategy_id = $1
        AND DATE(timestamp) = $2
        AND token = $3
        AND event_type = 'EXIT'
        ORDER BY timestamp DESC
        LIMIT 1
        `,
        [strategy_id, date, leg.token]
      );

      legPnls[leg.token] = {
        symbol: leg.symbol,
        leg: leg.leg,
        pnl: pnlResult.rows[0]?.pnl || 0
      };
    }

    /* -----------------------------------------
       3. TOTAL PNL (sum of all legs)
    ----------------------------------------- */
    const total_pnl = Object.values(legPnls).reduce((sum, l) => {
      return sum + parseFloat(l.pnl || 0);
    }, 0);

    /* -----------------------------------------
       4. CUMULATIVE PNL (LATEST EXIT)
    ----------------------------------------- */
    const cumResult = await pool.query(
      `
      SELECT COALESCE(CAST(cum_pnl AS NUMERIC), 0) as cum_pnl
      FROM paper_trades
      WHERE strategy_id = $1
      AND DATE(timestamp) = $2
      AND event_type = 'EXIT'
      ORDER BY timestamp DESC
      LIMIT 1
      `,
      [strategy_id, date]
    );

    res.json({
      success: true,
      legs,
      leg_pnls: legPnls,
      total_pnl,
      cumulative_pnl: cumResult.rows[0]?.cum_pnl || 0
    });

  } catch (error) {

    console.error("Detailed PnL Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch detailed pnl"
    });
  }
};