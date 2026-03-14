import { Router } from "express";
import pool from "../../config/db.js";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';

const router = Router();

/*
-----------------------------------------
PAPER TRADE LOGGER
Inserts a paper trade
-----------------------------------------
*/

router.post("/papertradelogger", async (req, res) => {
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

    console.error("Paper Trade Logger Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to log paper trade"
    });
  }
}  );


/*
-----------------------------------------
PAPER ENGINE / STRATEGY LOGGER
Logs engine activity
-----------------------------------------
*/

router.post("/paperlogger", async (req, res) => {
  try {

    const {
      run_id,
      strategy_id,
      leg_name,
      token,
      symbol,
      action,
      price,
      log_type,
      remark
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO paper_logs (
        run_id,
        strategy_id,
        leg_name,
        token,
        symbol,
        action,
        price,
        log_type,
        remark
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        run_id,
        strategy_id,
        leg_name,
        token,
        symbol,
        action,
        price,
        log_type,
        remark
      ]
    );

    res.json({
      success: true,
      log: result.rows[0]
    });

  } catch (err) {

    console.error("Paper Logger Error:", err);

    res.status(500).json({
      success: false,
      message: "Failed to log paper activity"
    });
  }
});

export default router;