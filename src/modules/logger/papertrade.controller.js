import pool from "../../config/db.js";

/*
-----------------------------------------
CREATE PAPER TRADE
-----------------------------------------
*/
export const createPaperTrade = async (req, res) => {
  try {
    const {
      run_id,
      strategy_id,
      leg_name,
      token,
      symbol,
      side,
      lots,
      quantity,
      entry_price,
      entry_time,
      exit_price,
      exit_time,
      pnl,
      cumulative_pnl,
      trade_status,
      reason,
      deployed_by
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO paper_trades (
        run_id,
        strategy_id,
        leg_name,
        token,
        symbol,
        side,
        lots,
        quantity,
        entry_price,
        entry_time,
        exit_price,
        exit_time,
        pnl,
        cumulative_pnl,
        trade_status,
        reason,
        deployed_by
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17
      )
      RETURNING *
      `,
      [
        run_id,
        strategy_id,
        leg_name,
        token,
        symbol,
        side,
        lots,
        quantity,
        entry_price,
        entry_time,
        exit_price,
        exit_time,
        pnl,
        cumulative_pnl,
        trade_status,
        reason,
        deployed_by
      ]
    );

    res.json({
      success: true,
      trade: result.rows[0]
    });

  } catch (err) {
    console.error("Create Paper Trade Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to create paper trade"
    });
  }
};


/*
-----------------------------------------
GET TRADES BY DATE + TOKEN + STRATEGY
-----------------------------------------
*/
export const getTradesByDateTokenStrategy = async (req, res) => {
  try {
    const { date, token, strategy_id } = req.query;

    const result = await pool.query(
      `
      SELECT *
      FROM paper_trades
      WHERE DATE(entry_time) = $1
      AND token = $2
      AND strategy_id = $3
      ORDER BY entry_time ASC
      `,
      [date, token, strategy_id]
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error("Fetch Trades Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch trades"
    });
  }
};


/*
-----------------------------------------
GET TRADES BY DATE + STRATEGY
-----------------------------------------
*/
export const getTradesByDateStrategy = async (req, res) => {
  try {
    const { date, strategy_id } = req.query;

    const result = await pool.query(
      `
      SELECT *
      FROM paper_trades
      WHERE DATE(entry_time) = $1
      AND strategy_id = $2
      ORDER BY entry_time ASC
      `,
      [date, strategy_id]
    );

    res.json({
      success: true,
      count: result.rowCount,
      data: result.rows
    });

  } catch (err) {
    console.error("Fetch Trades Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to fetch trades"
    });
  }
};
 