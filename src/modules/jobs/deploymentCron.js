import cron from "node-cron";
import pool from "../../config/db.js";

cron.schedule("1 0 * * *", async () => {
  console.log("Running daily deployment renewal...");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const activeDeployments = await client.query(`
      SELECT DISTINCT ON (user_id, strategy_id, broker_account_id)
        *
      FROM deployments
      WHERE status = 'ACTIVE'
      ORDER BY user_id, strategy_id, broker_account_id, deployed_at DESC
    `);

    for (const dep of activeDeployments.rows) {
      const userRes = await client.query(
        `SELECT tokens FROM users WHERE id = $1 FOR UPDATE`,
        [dep.user_id]
      );

      const tokens = userRes.rows[0]?.tokens || 0;

      if (tokens <= 0) {
        await client.query(
          `UPDATE deployments SET status = 'FAILED' WHERE id = $1`,
          [dep.id]
        );
        continue;
      }

      await client.query(
        `UPDATE users SET tokens = tokens - 1 WHERE id = $1`,
        [dep.user_id]
      );

      await client.query(
        `INSERT INTO deployments 
        (user_id, strategy_id, type, broker_account_id, multiplier, status)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE')`,
        [
          dep.user_id,
          dep.strategy_id,
          dep.type,
          dep.broker_account_id,
          dep.multiplier
        ]
      );
    }

    await client.query("COMMIT");
    console.log("Daily deployments processed");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Cron error:", err);
  } finally {
    client.release();
  }
});