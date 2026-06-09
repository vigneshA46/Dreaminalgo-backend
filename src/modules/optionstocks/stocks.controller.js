import pool from "../../config/db.js";

/**
 * Save Selected Stocks
 */
export const saveSelectedStocks = async (req, res) => {
  try {
    const { trade_date, stocks } = req.body;

    if (!trade_date || !stocks || !Array.isArray(stocks)) {
      return res.status(400).json({
        success: false,
        message: "Invalid payload",
      });
    }

    for (const stock of stocks) {
      await pool.query(
        `
        INSERT INTO stock_option_strategy_selection (
          trade_date,
          symbol,
          prev_close,
          iep,
          chng,
          pct_chng,
          final_price,
          final_quantity,
          value_cr,
          ffm_cap_cr
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
        )
        ON CONFLICT (trade_date, symbol)
        DO UPDATE SET
          prev_close = EXCLUDED.prev_close,
          iep = EXCLUDED.iep,
          chng = EXCLUDED.chng,
          pct_chng = EXCLUDED.pct_chng,
          final_price = EXCLUDED.final_price,
          final_quantity = EXCLUDED.final_quantity,
          value_cr = EXCLUDED.value_cr,
          ffm_cap_cr = EXCLUDED.ffm_cap_cr
        `,
        [
          trade_date,
          stock.symbol,
          stock.prev_close,
          stock.iep,
          stock.chng,
          stock.pct_chng,
          stock.final_price,
          stock.final_quantity,
          stock.value_cr,
          stock.ffm_cap_cr,
        ]
      );
    }

    res.status(200).json({
      success: true,
      message: "Stocks saved successfully",
    });
  } catch (error) {
    console.error("Save Selected Stocks Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to save stocks",
    });
  }
};

/**
 * Get Today's Stocks
 */
export const getTodayStocks = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM stock_option_strategy_selection
      WHERE trade_date = CURRENT_DATE
      ORDER BY created_at ASC
      `
    );

    res.status(200).json({
      success: true,
      stocks: result.rows,
    });
  } catch (error) {
    console.error("Get Today Stocks Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch today's stocks",
    });
  }
};

/**
 * History
 */
export const getStockSelectionHistory = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM stock_option_strategy_selection
      ORDER BY trade_date DESC, created_at DESC
      LIMIT 100
      `
    );

    res.status(200).json({
      success: true,
      stocks: result.rows,
    });
  } catch (error) {
    console.error("History Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch history",
    });
  }
};