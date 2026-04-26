import pool from "../../config/db.js";


export const getStrategyStats = async (req, res) => {
  try {
    const { strategy_id } = req.query;

    /* -----------------------------------------
       1. DAY-WISE PNL (latest EXIT per day)
    ----------------------------------------- */
    const dailyResult = await pool.query(
      `
      SELECT DISTINCT ON (DATE(timestamp))
  DATE(timestamp) as date,
  ROUND(COALESCE(CAST(cum_pnl AS NUMERIC), 0), 2) as day_pnl
FROM paper_trades
WHERE strategy_id = $1
AND event_type = 'EXIT'
ORDER BY DATE(timestamp), timestamp DESC;
      `,
      [strategy_id]
    );

    const daily = dailyResult.rows;

    /* -----------------------------------------
       2. MONTHLY RETURNS
       (difference between first & last cum pnl)
    ----------------------------------------- */
    const monthlyResult = await pool.query(
     `
    WITH daily AS (
  SELECT DISTINCT ON (DATE(timestamp))
    DATE(timestamp) as date,
    DATE_TRUNC('month', timestamp) as month,
    COALESCE(CAST(cum_pnl AS NUMERIC), 0) as day_pnl
  FROM paper_trades
  WHERE strategy_id = $1
  AND event_type = 'EXIT'
  ORDER BY DATE(timestamp), timestamp DESC
)

SELECT 
  TO_CHAR(month, 'YYYY-MM') as month,
  ROUND(SUM(day_pnl), 2) as monthly_return
FROM daily
GROUP BY month
ORDER BY month DESC;
     `,
      [strategy_id]
    );

    const monthly = monthlyResult.rows;

    /* -----------------------------------------
       3. OVERALL STATS
    ----------------------------------------- */
    const totalResult = await pool.query(
  `
  WITH daily AS (
    SELECT DISTINCT ON (DATE(timestamp))
      DATE(timestamp) as date,
      COALESCE(CAST(cum_pnl AS NUMERIC), 0) as day_pnl
    FROM paper_trades
    WHERE strategy_id = $1
    AND event_type = 'EXIT'
    ORDER BY DATE(timestamp), timestamp DESC
  )

  SELECT 
    ROUND(SUM(day_pnl), 2) as total_pnl,
    COUNT(*) as total_trades
  FROM daily;
  `,
  [strategy_id]
);

    const total_pnl = totalResult.rows[0]?.total_pnl || 0;
    const total_trades = totalResult.rows[0]?.total_trades || 0;

 


    /* -----------------------------------------
       RESPONSE
    ----------------------------------------- */
    res.json({
  success: true,
  daily,
  monthly,
  summary: {
    total_trades,
    total_pnl
  }
});

  } catch (error) {
    console.error("Strategy Stats Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch strategy stats"
    });
  }
};