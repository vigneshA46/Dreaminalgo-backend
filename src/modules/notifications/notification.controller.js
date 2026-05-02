import pool from "../../config/db.js";

// -----------------------------
// CREATE NOTIFICATION
// -----------------------------
export const createNotification = async (req, res) => {
  try {
    const { title, message, type = "info", expires_in_days = 7 } = req.body;

    const result = await pool.query(
      `
      INSERT INTO notifications (title, message, type, expires_at)
      VALUES ($1, $2, $3, NOW() + ($4 || ' days')::INTERVAL)
      RETURNING *
      `,
      [title, message, type, expires_in_days]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create notification" });
  }
};

// -----------------------------
// GET ACTIVE NOTIFICATIONS (USER)
// -----------------------------
export const getActiveNotifications = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM notifications
      WHERE is_active = TRUE
      AND NOW() BETWEEN starts_at AND expires_at
      ORDER BY created_at DESC
      `
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

// -----------------------------
// GET ALL (ADMIN)
// -----------------------------
export const getAllNotifications = async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT *
      FROM notifications
      ORDER BY created_at DESC
      `
    );

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch all notifications" });
  }
};

// -----------------------------
// TOGGLE ACTIVE
// -----------------------------
export const toggleNotification = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      UPDATE notifications
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle notification" });
  }
};

// -----------------------------
// DELETE
// -----------------------------
export const deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(
      `DELETE FROM notifications WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: "Notification deleted",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete notification" });
  }
};