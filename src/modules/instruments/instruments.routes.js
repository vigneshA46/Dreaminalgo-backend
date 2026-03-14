import express from "express";
import axios from "axios";
import fs from "fs";
import csv from "csv-parser";
import pool from '../../config/db.js';
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';

const router = express.Router();

router.get("/indexes",authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, index_name 
      FROM instruments
      ORDER BY index_name
    `);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch indexes" });
  }
});

router.post("/seed-indexes", async (req, res) => {
  try {
    const results = [];

    fs.createReadStream("./api-scrip-master.csv")
      .pipe(csv())
      .on("data", (row) => {
        if (row.SEM_INSTRUMENT_NAME === "INDEX") {
          results.push({
            index_name: row.SEM_CUSTOM_SYMBOL,
            segment: row.SEM_EXM_EXCH_ID,
            dhan: row.SEM_SMST_SECURITY_ID,
          });
        }
      })
      .on("end", async () => {
        try {
          for (const index of results) {
            await pool.query(
              `
              INSERT INTO instruments (index_name, segment, dhan)
              VALUES ($1, $2, $3)
              `,
              [index.index_name, index.segment, index.dhan]
            );
          }

          res.json({
            message: "Indexes inserted successfully",
            totalInserted: results.length,
          });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "Database insert failed" });
        }
      });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "CSV processing failed" });
  }
});


export default router;