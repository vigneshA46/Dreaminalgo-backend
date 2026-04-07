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
  SELECT DISTINCT TO_CHAR(date, 'YYYY-MM-DD') as date
  FROM trade_legs
  WHERE startergy_id = $1
  ORDER BY date DESC
      `,
      [strategy_id]
    );

    res.json({
      success: true,
      count: result.rowCount,
      dates: result.rows.map(row => row.date)
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch dates"
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