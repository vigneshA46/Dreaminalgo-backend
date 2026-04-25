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


export const getDeploymentsByStrategyDetailed = async (req, res) => {
  try {
    const result = await pool.query(`
      WITH strategy_summary AS (
        SELECT 
          d.strategy_id,
          s.name,
          COUNT(*) AS total_deployments,
          COUNT(DISTINCT d.user_id) AS total_users
        FROM deployments d
        LEFT JOIN strategies s ON d.strategy_id = s.id
        GROUP BY d.strategy_id, s.name
      ),

      deployment_details AS (
        SELECT 
          d.strategy_id,
          json_agg(
            json_build_object(
              'deployment_id', d.id,
              'type', d.type,
              'status', d.status,
              'multiplier', d.multiplier,
              'deployed_at', d.deployed_at,
              'user', json_build_object(
                'id', u.id,
                'fullname', u.fullname,
                'email', u.email
              )
            )
            ORDER BY d.deployed_at DESC
          ) AS deployments
        FROM deployments d
        LEFT JOIN users u ON d.user_id = u.id
        GROUP BY d.strategy_id
      )

      SELECT 
        ss.strategy_id,
        ss.name,
        ss.total_deployments,
        ss.total_users,
        COALESCE(dd.deployments, '[]') AS deployments
      FROM strategy_summary ss
      LEFT JOIN deployment_details dd 
        ON ss.strategy_id = dd.strategy_id
      ORDER BY ss.total_deployments DESC;
    `);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });

  } catch (error) {
    console.error("Error fetching strategy deployments:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


export const getDeploymentsByBrokerDetailed = async (req, res) => {
  try {
    const result = await pool.query(`WITH broker_summary AS (
  SELECT 
    type AS broker,
    COUNT(*) AS total_deployments,
    COUNT(DISTINCT user_id) AS total_users
  FROM deployments
  GROUP BY type
),

deployment_details AS (
  SELECT 
    d.type AS broker,
    json_agg(
      json_build_object(
        'deployment_id', d.id,
        'strategy_id', d.strategy_id,
        'strategy_name', s.name,
        'status', d.status,
        'multiplier', d.multiplier,
        'deployed_at', d.deployed_at,
        'user', json_build_object(
          'id', u.id,
          'fullname', u.fullname,
          'email', u.email
        )
      )
      ORDER BY d.deployed_at DESC
    ) AS deployments
  FROM deployments d
  LEFT JOIN users u ON d.user_id = u.id
  LEFT JOIN strategies s ON d.strategy_id = s.id
  GROUP BY d.type
)

SELECT 
  bs.broker,
  bs.total_deployments,
  bs.total_users,
  COALESCE(dd.deployments, '[]') AS deployments
FROM broker_summary bs
LEFT JOIN deployment_details dd 
  ON bs.broker = dd.broker
ORDER BY bs.total_deployments DESC;`);

    res.json({ success: true, data: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};

export const getDeploymentsByUserDetailed = async (req, res) => {
  try {
    const result = await pool.query(`WITH user_summary AS (
  SELECT 
    d.user_id,
    u.fullname,
    u.email,
    COUNT(*) AS total_deployments,
    COUNT(DISTINCT d.strategy_id) AS strategies_used
  FROM deployments d
  LEFT JOIN users u ON d.user_id = u.id
  GROUP BY d.user_id, u.fullname, u.email
),

deployment_details AS (
  SELECT 
    d.user_id,
    json_agg(
      json_build_object(
        'deployment_id', d.id,
        'strategy_id', d.strategy_id,
        'strategy_name', s.name,
        'type', d.type,
        'status', d.status,
        'multiplier', d.multiplier,
        'deployed_at', d.deployed_at
      )
      ORDER BY d.deployed_at DESC
    ) AS deployments
  FROM deployments d
  LEFT JOIN strategies s ON d.strategy_id = s.id
  GROUP BY d.user_id
)

SELECT 
  us.user_id,
  us.fullname,
  us.email,
  us.total_deployments,
  us.strategies_used,
  COALESCE(dd.deployments, '[]') AS deployments
FROM user_summary us
LEFT JOIN deployment_details dd 
  ON us.user_id = dd.user_id
ORDER BY us.total_deployments DESC;`);

    res.json({ success: true, data: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};


export const getDeploymentsByDateDetailed = async (req, res) => {
  try {
    const result = await pool.query(`WITH date_summary AS (
  SELECT 
    DATE(deployed_at) AS date,
    COUNT(*) AS total_deployments,
    COUNT(DISTINCT user_id) AS total_users
  FROM deployments
  GROUP BY DATE(deployed_at)
),

deployment_details AS (
  SELECT 
    DATE(d.deployed_at) AS date,
    json_agg(
      json_build_object(
        'deployment_id', d.id,
        'strategy_id', d.strategy_id,
        'strategy_name', s.name,
        'type', d.type,
        'status', d.status,
        'multiplier', d.multiplier,
        'user', json_build_object(
          'id', u.id,
          'fullname', u.fullname,
          'email', u.email
        ),
        'deployed_at', d.deployed_at
      )
      ORDER BY d.deployed_at DESC
    ) AS deployments
  FROM deployments d
  LEFT JOIN users u ON d.user_id = u.id
  LEFT JOIN strategies s ON d.strategy_id = s.id
  GROUP BY DATE(d.deployed_at)
)

SELECT 
  ds.date,
  ds.total_deployments,
  ds.total_users,
  COALESCE(dd.deployments, '[]') AS deployments
FROM date_summary ds
LEFT JOIN deployment_details dd 
  ON ds.date = dd.date
ORDER BY ds.date DESC;`);

    res.json({ success: true, data: result.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
};