import cron from "node-cron";
import pool from "./src/config/db.js"

const runAutoDeployments = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const configs = await client.query(`
      SELECT *
      FROM deployment_configs
      WHERE auto_deploy = true
    `);

    for (const config of configs.rows) {
      const {
        user_id,
        strategy_id,
        broker_account_id,
        type,
        multiplier
      } = config;

      // 🔒 Lock user
      const userRes = await client.query(
        `SELECT tokens FROM users WHERE id = $1 FOR UPDATE`,
        [user_id]
      );

      if (!userRes.rows.length) continue;

      const tokens = userRes.rows[0].tokens;
      if (tokens <= 0) continue;

      // 🚫 Prevent duplicate for today
      const already = await client.query(
        `
        SELECT 1 FROM deployments
        WHERE user_id = $1
          AND strategy_id = $2
          AND broker_account_id IS NOT DISTINCT FROM $3
          AND type = $4
          AND DATE(created_at) = CURRENT_DATE
        `,
        [user_id, strategy_id, broker_account_id, type]
      );

      if (already.rows.length) continue;

      // ➖ Deduct token
      await client.query(
        `UPDATE users SET tokens = tokens - 1 WHERE id = $1`,
        [user_id]
      );

      // ➕ Insert deployment
      await client.query(
        `
        INSERT INTO deployments 
        (user_id, strategy_id, type, broker_account_id, multiplier, status)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
        `,
        [user_id, strategy_id, type, broker_account_id, multiplier]
      );
    }

    await client.query("COMMIT");
    console.log("✅ Auto deployments done");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Auto deploy failed:", err);
  } finally {
    client.release();
  }
};


// ⏰ Runs at 00:02 AM everyday
cron.schedule("2 0 * * *", async () => {
  console.log("⏳ Running auto deployment cron...");
  await runAutoDeployments();
});