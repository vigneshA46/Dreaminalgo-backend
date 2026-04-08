import pool from "../../config/db.js";

/* CREATE TRADER SIGNAL */
export const createTraderSignal = async (req, res) => {
  try {
    const user_id = req.user.id

    const {
      creator_name,
      index_id,
      index_name,
      description,
      config_json,
      status
    } = req.body;

    const result = await pool.query(
      `INSERT INTO trader_signal 
      (user_id, creator_name, index_id, config_json, status,description,index_name)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [user_id, creator_name, index_id, config_json, status,description,index_name]
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

    const user_id = req.user.id;

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

/* GET SIGNALS BY STATUS */

export const getApprovedsignals = async (req, res) => {

  try {

    

    const result = await pool.query(
      `SELECT * FROM trader_signal
       WHERE isapproved = true
       ORDER BY created_at DESC`,
       
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch published signals"
    });

  }

};


export const getunApprovedsignals = async (req, res) => {

  try {

    

    const result = await pool.query(
      `SELECT * FROM trader_signal
       WHERE isapproved = false
       ORDER BY created_at DESC`,
       
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch published signals"
    });

  }

};


/* aprove a singa using id */
export const approveSignal = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE trader_signal
       SET isapproved = true
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Signal not found",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: "Signal approved successfully",
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to approve signal",
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



export const deleteSignal = async (req, res) => {
  try {

    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM trader_signal WHERE id = $1 RETURNING *`,
      [id]
    );

    // ✅ check if signal exists
    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Signal not found"
      });
    }

    res.json({
      success: true,
      message: "Signal deleted successfully",
      data: result.rows[0] // optional (deleted row)
    });

  } catch (error) {

    console.error("Delete Signal Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to delete signal"
    });
  }
};