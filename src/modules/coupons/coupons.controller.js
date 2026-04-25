import pool from "../../config/db.js";

// APPLY COUPON (USER)
export const applyCoupon = async (req, res) => {
  const { code } = req.body;
  const userId = req.user.id;

  if (!code) {
    return res.status(400).json({
      success: false,
      message: "Coupon code is required",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Fetch coupon (case-insensitive + lock row)
    const couponResult = await client.query(
      `SELECT * FROM coupons WHERE LOWER(code) = LOWER($1) FOR UPDATE`,
      [code]
    );

    if (couponResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Invalid coupon",
      });
    }

    const coupon = couponResult.rows[0];

    // Validations
    if (!coupon.is_active) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Coupon is inactive",
      });
    }

    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Coupon expired",
      });
    }

    if (coupon.used_count >= coupon.max_uses) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Coupon usage limit reached",
      });
    }

    // Check already used
    const alreadyUsed = await client.query(
      `SELECT 1 FROM coupon_redemptions WHERE user_id = $1 AND coupon_id = $2`,
      [userId, coupon.id]
    );

    if (alreadyUsed.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Coupon already used",
      });
    }

    // Add tokens
    await client.query(
      `UPDATE users SET tokens = tokens + $1 WHERE id = $2`,
      [coupon.free_tokens, userId]
    );

    // Insert redemption
    await client.query(
      `INSERT INTO coupon_redemptions (user_id, coupon_id)
       VALUES ($1, $2)`,
      [userId, coupon.id]
    );

    // Increment usage
    await client.query(
      `UPDATE coupons SET used_count = used_count + 1 WHERE id = $1`,
      [coupon.id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `${coupon.free_tokens} tokens added successfully`,
    });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Apply coupon error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  } finally {
    client.release();
  }
};


// CREATE COUPON (ADMIN)
export const createCoupon = async (req, res) => {
  try {
    const { code, free_tokens, max_uses, expires_at } = req.body;

    if (!code || !free_tokens) {
      return res.status(400).json({
        success: false,
        message: "code and free_tokens are required",
      });
    }

    const result = await pool.query(
      `INSERT INTO coupons (code, free_tokens, max_uses, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [code, free_tokens, max_uses || 1, expires_at || null]
    );

    return res.status(201).json({
      success: true,
      coupon: result.rows[0],
    });

  } catch (error) {
    if (error.code === "23505") {
      return res.status(400).json({
        success: false,
        message: "Coupon already exists",
      });
    }

    console.error("Create coupon error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


// GET ALL COUPONS (ADMIN)
export const getCoupons = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM coupons ORDER BY created_at DESC`
    );

    return res.status(200).json({
      success: true,
      coupons: result.rows,
    });

  } catch (error) {
    console.error("Get coupons error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


// TOGGLE COUPON (ADMIN)
export const toggleCoupon = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE coupons
       SET is_active = NOT is_active
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Coupon not found",
      });
    }

    return res.status(200).json({
      success: true,
      coupon: result.rows[0],
    });

  } catch (error) {
    console.error("Toggle coupon error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};


// DELETE COUPON (ADMIN)
export const deleteCoupon = async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(`DELETE FROM coupons WHERE id = $1`, [id]);

    return res.status(200).json({
      success: true,
      message: "Coupon deleted successfully",
    });

  } catch (error) {
    console.error("Delete coupon error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};