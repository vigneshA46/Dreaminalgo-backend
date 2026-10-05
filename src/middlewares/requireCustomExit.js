import pool from '../config/db.js';

/* Allow only users with the custom exit feature enabled (users.iscustomexit) */
const requireCustomExit = async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT iscustomexit FROM users WHERE id = $1',
      [req.user.id]
    );

    if (!rows[0]?.iscustomexit) {
      return res.status(403).json({
        success: false,
        message: 'Custom exit is not enabled for this account',
      });
    }

    next();
  } catch (error) {
    console.error('Custom Exit Check Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to verify access' });
  }
};

export default requireCustomExit;
