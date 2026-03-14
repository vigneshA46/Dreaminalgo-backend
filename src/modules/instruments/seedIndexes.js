import fs from "fs";
import csv from "csv-parser";
import pool from "../../config/db.js";

const results = [];

fs.createReadStream("../../../api-scrip-master.csv")
  .pipe(csv())
  .on("data", (row) => {
    if (row.SEM_INSTRUMENT_NAME === "INDEX") {
      results.push({
        index_name: row.SEM_CUSTOM_SYMBOL,
        segment: row.SEM_EXM_EXCH_ID,
        dhan: row.SEM_SMST_SECURITY_ID
      });
    }
  })
  .on("end", async () => {
    try {
      for (const index of results) {
        await pool.query(
          `
          INSERT INTO instruments 
          (index_name, segment, dhan)
          VALUES ($1, $2, $3)
          `,
          [index.index_name, index.segment, index.dhan]
        );
      }

      console.log("Indexes inserted successfully");
      process.exit();
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });