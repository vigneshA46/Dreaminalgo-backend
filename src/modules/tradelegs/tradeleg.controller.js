import pool from "../../config/db.js";

/* CREATE LEG */
export const createLeg = async (req, res) => {
  try {

    const { strategy_id, leg, symbol, strike_price, date } = req.body;

    const result = await pool.query(
      `
      INSERT INTO trade_legs (startergy_id, leg, symbol, strike_price, date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [strategy_id, leg, symbol, strike_price, date]
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
      SELECT *
      FROM trade_legs
      WHERE startergy_id = $1
      AND date = $2
      ORDER BY date DESC
      `,
      [strategy_id, date]
    );

    res.json({
      success: true,
      data: result.rows
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
      SELECT *
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