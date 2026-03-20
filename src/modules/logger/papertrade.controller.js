import pool from "../../config/db.js";

/*
-----------------------------------------
CREATE PAPER TRADE
-----------------------------------------
*/
export const createTradeEvent = async (req, res) => {
  try {
    const {
      run_id,
      strategy_id,
      trade_id,        // 🔥 important
      event_type,      // ENTRY / EXIT

      leg_name,
      token,
      symbol,

      side,
      lots,
      quantity,

      price,
      reason,
      deployed_by
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO paper_trades (
        run_id,
        strategy_id,
        trade_id,
        event_type,
        leg_name,
        token,
        symbol,
        side,
        lots,
        quantity,
        price,
        reason,
        deployed_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
      RETURNING *
      `,
      [
        run_id,
        strategy_id,
        trade_id,
        event_type,
        leg_name,
        token,
        symbol,
        side,
        lots,
        quantity,
        price,
        reason,
        deployed_by
      ]
    );

    res.json({
      success: true,
      event: result.rows[0]
    });

  } catch (err) {
    console.error("Create Trade Event Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to create trade event"
    });
  }
};
/*
-----------------------------------------
GET TRADES BY DATE + TOKEN + STRATEGY
-----------------------------------------
*/
export const getEventsByDateStrategy = async (req, res) => {
  try {
    const { date, strategy_id } = req.query;

    const result = await pool.query(
      `
      SELECT *
      FROM paper_trades
      WHERE DATE(timestamp) = $1
      AND strategy_id = $2
      ORDER BY timestamp ASC
      `,
      [date, strategy_id]
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error("Fetch Events Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch events"
    });
  }
};
/*
-----------------------------------------
GET TRADES BY DATE + STRATEGY
-----------------------------------------
*/
export const getEventsByDateTokenStrategy = async (req, res) => {
  try {
    const { date, token, strategy_id } = req.query;

    const result = await pool.query(
      `
      SELECT *
      FROM paper_trades
      WHERE DATE(timestamp) = $1
      AND token = $2
      AND strategy_id = $3
      ORDER BY timestamp ASC
      `,
      [date, token, strategy_id]
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error("Fetch Events Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch events"
    });
  }
};