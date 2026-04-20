import pool from "../../config/db.js";

// Get unique deployed strategies for a user
export const getUserDeployedStrategies = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(400).json({ message: "user_id is required" });
    }
const result = await pool.query(
  `
  WITH deployed_strategies AS (
    SELECT DISTINCT s.id, s.name
    FROM deployments d
    JOIN strategies s ON d.strategy_id = s.id
    WHERE d.user_id = $1
  ),

  daily_latest AS (
    SELECT
      rtg.strategy_id,
      rtg.trade_date,
      rtg.cum_pnl,
      ROW_NUMBER() OVER (
        PARTITION BY rtg.strategy_id, rtg.trade_date
        ORDER BY rtg.timestamp DESC, rtg.created_at DESC
      ) AS rn
    FROM real_trade_groups rtg
    WHERE rtg.user_id::uuid = $1   -- 🔥 FIX HERE
  ),

  daily_final AS (
    SELECT
      strategy_id,
      trade_date,
      cum_pnl
    FROM daily_latest
    WHERE rn = 1
  ),

  strategy_pnl AS (
    SELECT
      strategy_id,
      SUM(cum_pnl) AS overall_pnl
    FROM daily_final
    GROUP BY strategy_id
  )

  SELECT
    ds.id AS strategy_id,
    ds.name,
    COALESCE(sp.overall_pnl, 0) AS overall_pnl
  FROM deployed_strategies ds
  LEFT JOIN strategy_pnl sp 
    ON sp.strategy_id::uuid = ds.id   -- 🔥 FIX HERE
  `,
  [userId]
);

    return res.status(200).json({
      success: true,
      strategies: result.rows,
    });

  } catch (error) {
    console.error("Error fetching deployed strategies with pnl:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

export const getStrategyDatewisePnl = async (req, res) => {
  try {
    const userId = req.user.id;
    const { strategy_id } = req.params;

    if (!userId || !strategy_id) {
      return res.status(400).json({
        message: "user_id and strategy_id are required",
      });
    }

    const result = await pool.query(
      `
      WITH daily_latest AS (
        SELECT
          trade_date,
          cum_pnl,
          ROW_NUMBER() OVER (
            PARTITION BY trade_date
            ORDER BY timestamp DESC, created_at DESC
          ) AS rn
        FROM real_trade_groups
        WHERE user_id::uuid = $1
          AND strategy_id::uuid = $2
      )

      SELECT
        trade_date,
        cum_pnl AS pnl
      FROM daily_latest
      WHERE rn = 1
      ORDER BY trade_date;
      `,
      [userId, strategy_id]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });

  } catch (error) {
    console.error("Error fetching date-wise pnl:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};