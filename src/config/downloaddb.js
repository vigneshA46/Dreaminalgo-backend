import fs from "fs";
import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: "postgresql://postgres:KhUMkVkuZEHdijNRrCODSmaWNAWSjjzB@shinkansen.proxy.rlwy.net:59168/railway",
});

const res = await pool.query("SELECT * FROM paper_trades");

const csv = [
  Object.keys(res.rows[0]).join(","), // headers
  ...res.rows.map(row => Object.values(row).join(","))
].join("\n");

fs.writeFileSync("paper_trades.csv", csv);

console.log("Exported!");