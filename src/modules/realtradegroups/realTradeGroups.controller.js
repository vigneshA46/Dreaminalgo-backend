import pool from "../../config/db.js";

/*
  CREATE TRADE GROUP (ENTRY)
*/
export const createTradeGroup = async (req, res) => {
  try {
    const {
      user_id,
      strategy_id,
      broker_id,
      trade_id,
      trade_date,
      event_type,   // ENTRY / EXIT
      leg_name,
      symbol,
      side,         // BUY / SELL
      quantity,
      price,
      reason,
      pnl,
      cum_pnl
    } = req.body;

    const result = await pool.query(
      `INSERT INTO real_trade_groups 
      (user_id, strategy_id, broker_id, trade_id, trade_date, event_type, leg_name, symbol, side, quantity, price, reason, pnl, cum_pnl)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING *`,
      [
        user_id,
        strategy_id,
        broker_id,
        trade_id,
        trade_date,
        event_type,
        leg_name,
        symbol,
        side,
        quantity,
        price,
        reason || null,
        pnl || 0,
        cum_pnl || 0
      ]
    );

    res.status(201).json(result.rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create trade event" });
  }
};

/*
  GET TRADES (FILTER)
  by strategy_id, broker_id, date
*/

export const getTrades = async (req, res) => {
  try {
    const { strategy_id, broker_id, date } = req.query;

    const result = await pool.query(
      `SELECT * FROM real_trade_groups
       WHERE strategy_id = $1
       AND broker_id = $2
       AND trade_date = $3
       ORDER BY timestamp DESC`,
      [strategy_id, broker_id, date]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
};
/*
  GET LATEST TRADE
*/

export const getLatestTrade = async (req, res) => {
  try {
    const { strategy_id, broker_id, date } = req.query;

    const result = await pool.query(
      `SELECT * FROM real_trade_groups
       WHERE strategy_id = $1
       AND broker_id = $2
       AND trade_date = $3
       ORDER BY timestamp DESC
       LIMIT 1`,
      [strategy_id, broker_id, date]
    );

    res.json(result.rows[0] || null);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch latest trade" });
  }
};

export const getOpenTrades = async (req, res) => {
  try {
    const { user_id, strategy_id, broker_id, date } = req.body;

    const result = await pool.query(
  `
  SELECT 
    t1.*,
    b.broker_name,
    b.credentials

  FROM real_trade_groups t1

  LEFT JOIN broker_accounts b
    ON t1.broker_id::uuid = b.id

  WHERE t1.user_id = $1
    AND t1.strategy_id = $2
    AND t1.broker_id = $3
    AND t1.trade_date = $4
    AND t1.event_type = 'ENTRY'

    AND NOT EXISTS (
      SELECT 1
      FROM real_trade_groups t2
      WHERE t2.user_id = t1.user_id
        AND t2.strategy_id = t1.strategy_id
        AND t2.broker_id = t1.broker_id
        AND t2.trade_date = t1.trade_date
        AND t2.symbol = t1.symbol
        AND t2.leg_name = t1.leg_name
        AND t2.event_type = 'EXIT'
        AND t2.timestamp > t1.timestamp
    )

  ORDER BY t1.timestamp DESC
  `,
  [user_id, strategy_id, broker_id, date]
);
    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch open trades" });
  }
};

export const getStrategyStatistics = async (req, res) => {
  try {
    const { strategy_id } = req.query;
    const userId = req.user.id

    if (!userId || !strategy_id) {
      return res.status(400).json({ error: "user_id and strategy_id are required" });
    }

    /* -----------------------------------------
       1. GET STRATEGY DETAILS
    ----------------------------------------- */
    const strategyResult = await pool.query(
      `SELECT * FROM strategies WHERE id = $1`,
      [strategy_id]
    );

    if (strategyResult.rows.length === 0) {
      return res.status(404).json({ error: "Strategy not found" });
    }

    const strategy = strategyResult.rows[0];

    /* -----------------------------------------
       2. DATE-WISE PNL
    ----------------------------------------- */
    const pnlResult = await pool.query(
      `
      SELECT DISTINCT ON (trade_date)
        trade_date,
        cum_pnl
      FROM real_trade_groups
      WHERE user_id = $1
        AND strategy_id = $2
      ORDER BY trade_date, timestamp DESC
      `,
      [userId, strategy_id]
    );

    res.json({
      strategy,
      datewise_pnl: pnlResult.rows
    });

  } catch (err) {
    console.error("getStrategyStatistics error:", err);
    res.status(500).json({ error: "Failed to fetch strategy statistics" });
  }
};