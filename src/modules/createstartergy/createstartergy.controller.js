import pool from "../../config/db.js";

/* CREATE STRATEGY */
export const createStrategy = async (req, res) => {
  try {

    const user_id = req.user.id;

    const {
      index_id,
      description,
      entry_settings,
      config_json,
      status,
      created_by
    } = req.body;

    const result = await pool.query(
      `INSERT INTO create_strategy
      (user_id, entry_settings, config_json, status, created_by , index_id,description)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
      [user_id, entry_settings, config_json, status, created_by,index_id,description]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success:false,
      message:"Failed to create strategy"
    });

  }
};


/* GET ALL STRATEGIES */
export const getAllStrategy = async (req,res)=>{
  try{

    const result = await pool.query(`
      SELECT * FROM create_strategy
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  }catch(error){

    console.error(error);

    res.status(500).json({
      message:"Failed to fetch strategies"
    });

  }
};


/* GET ADMIN STRATEGIES */
export const getAdminStrategy = async (req,res)=>{
  try{

    const result = await pool.query(`
      SELECT * FROM create_strategy
      WHERE created_by = 'admin'
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  }catch(error){

    console.error(error);

    res.status(500).json({
      message:"Failed to fetch admin strategies"
    });

  }
};


/* GET USER STRATEGIES */
export const getUserStrategy = async (req,res)=>{
  try{

    const result = await pool.query(`
      SELECT * FROM create_strategy
      WHERE created_by = 'user'
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  }catch(error){

    console.error(error);

    res.status(500).json({
      message:"Failed to fetch user strategies"
    });

  }
};


/* GET STRATEGY BY USER ID */
export const getStrategyByUserId = async (req,res)=>{
  try{

    const { user_id } = req.params;

    const result = await pool.query(`
      SELECT * FROM create_strategy
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,[user_id]);

    res.json(result.rows);

  }catch(error){

    console.error(error);

    res.status(500).json({
      message:"Failed to fetch user strategies"
    });

  }
};


/* GET SINGLE STRATEGY */
export const getSingleStrategy = async (req,res)=>{
  try{

    const { id } = req.params;

    const result = await pool.query(`
      SELECT * FROM create_strategy
      WHERE id = $1
    `,[id]);

    res.json(result.rows[0]);

  }catch(error){

    console.error(error);

    res.status(500).json({
      message:"Failed to fetch strategy"
    });

  }
};


/* DELETE STRATEGY */
export const deleteStrategy = async (req,res)=>{
  try{

    const { id } = req.params;

    await pool.query(`
      DELETE FROM create_strategy
      WHERE id = $1
    `,[id]);

    res.json({
      success:true,
      message:"Strategy deleted successfully"
    });

  }catch(error){

    console.error(error);

    res.status(500).json({
      message:"Failed to delete strategy"
    });

  }
};

export const getStrategyByStatus = async (req, res) => {
  try {

    const { status } = req.params;

    const result = await pool.query(
      `
      SELECT * FROM create_strategy
      WHERE status = $1
      ORDER BY created_at DESC
      `,
      [status]
    );

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch strategies by status"
    });

  }
};