import cron from "node-cron";
import pool from "../config/db.js";

cron.schedule("20 9 * * 1-5", async () => { // 9:20 AM weekdays
  console.log("Running auto-deploy...");

  const configs = await pool.query(
    `SELECT * FROM deployment_configs WHERE auto_deploy = true`
  );

  for (const config of configs.rows) {
    await pool.query(
      `INSERT INTO deployments (
        user_id, strategy_id, type, broker_account_id, multiplier
      )
      VALUES ($1, $2, $3, $4, $5)`,
      [
        config.user_id,
        config.strategy_id,
        config.type,
        config.broker_account_id,
        config.multiplier
      ]
    );

    // 🔥 trigger your engine here
  }
});