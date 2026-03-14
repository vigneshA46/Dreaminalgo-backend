import pool from "../../config/db.js";

/* CREATE TRADER SIGNAL */
export const createTraderSignal = async (req, res) => {
  try {
    const user_id = req.user.id

    const {
      creator_name,
      index_id,
      config_json,
      status
    } = req.body;

    const result = await pool.query(
      `INSERT INTO trader_signal 
      (user_id, creator_name, index_id, config_json, status)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *`,
      [user_id, creator_name, index_id, config_json, status]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to create trader signal"
    });

  }
};


/* GET ALL SIGNALS */
export const getAllSignals = async (req, res) => {

  try {

    const result = await pool.query(
      `SELECT * FROM trader_signal
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch signals"
    });

  }

};


/* GET SIGNALS BY DATE */
export const getSignalsByDate = async (req, res) => {

  try {

    const { date } = req.params;

    const result = await pool.query(
      `SELECT * FROM trader_signal
       WHERE DATE(created_at) = $1
       ORDER BY created_at DESC`,
      [date]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch signals by date"
    });

  }

};


/* GET SIGNALS BY USER ID */
export const getSignalsByUserId = async (req, res) => {

  try {

    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM trader_signal
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user_id]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch user signals"
    });

  }

};


/* GET SINGLE SIGNAL */
export const getSignalById = async (req, res) => {

  try {

    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM trader_signal
       WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch signal"
    });

  }

};