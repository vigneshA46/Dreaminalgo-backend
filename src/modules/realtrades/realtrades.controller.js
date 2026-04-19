import pool from "../../config/db.js";

// ✅ CREATE TRADE
export const createTrade = async (req, res) => {
  try {
    const data = req.body;

    const result = await pool.query(
      `
      INSERT INTO real_trades (
        user_id, strategy_id, broker_id,
        order_id, event_type, leg_name, symbol,
        side, order_type, product_type, exchange,
        lot, quantity, filled_quantity,
        price, average_price,
        status, reason,
        timestamp, executed_at,
        pnl, cum_pnl,
        raw_response
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
        $12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23
      )
      RETURNING *;
      `,
      [
        data.user_id,
        data.strategy_id,
        data.broker_id,
        data.order_id,
        data.event_type,
        data.leg_name,
        data.symbol,
        data.side,
        data.order_type,
        data.product_type,
        data.exchange,
        data.lot,
        data.quantity,
        data.filled_quantity || 0,
        data.price,
        data.average_price,
        data.status,
        data.reason,
        data.timestamp,
        data.executed_at,
        data.pnl || 0,
        data.cum_pnl || 0,
        data.raw_response,
      ]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });

  } catch (err) {
    console.error("Create Trade Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};



// ✅ GET TRADES (FILTER BASED)
export const getTrades = async (req, res) => {
  try {
    const {
      user_id,
      strategy_id,
      broker_id,
      leg_name,
      date
    } = req.query;

    let query = `SELECT * FROM real_trades WHERE 1=1`;
    let values = [];
    let index = 1;

    if (user_id) {
      query += ` AND user_id = $${index++}`;
      values.push(user_id);
    }

    if (strategy_id) {
      query += ` AND strategy_id = $${index++}`;
      values.push(strategy_id);
    }

    if (broker_id) {
      query += ` AND broker_id = $${index++}`;
      values.push(broker_id);
    }

    if (leg_name) {
      query += ` AND leg_name = $${index++}`;
      values.push(leg_name);
    }

    // ✅ Filter by date (entire day)
    if (date) {
      query += ` AND DATE(timestamp) = $${index++}`;
      values.push(date);
    }

    query += ` ORDER BY timestamp DESC`;

    const result = await pool.query(query, values);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
    });

  } catch (err) {
    console.error("Get Trades Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};


export const getOpenTrades = async (req, res) => {
  try {
    const { user_id, strategy_id, broker_id, date } = req.query;

    const result = await pool.query(
      `
      SELECT *
      FROM real_trade_groups t1
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