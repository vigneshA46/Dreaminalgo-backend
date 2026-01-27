import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from '../../config/db.js';
import crypto from 'crypto';

export const adminLoginService = async (email, password, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM admins WHERE email=$1 AND isactive=true',
    [email]
  );

  if (!rows.length) throw new Error('Invalid credentials');

  const admin = rows[0];

  const match = await bcrypt.compare(password, admin.passwordhash);
  if (!match) throw new Error('Invalid credentials');

  /* ACCESS TOKEN */
  const accessToken = jwt.sign(
    { id: admin.id, role: admin.role },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.ADMIN_ACCESS_TOKEN_EXPIRES }
  );

  /* REFRESH TOKEN */
  const refreshToken = jwt.sign(
    { id: admin.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.ADMIN_REFRESH_TOKEN_EXPIRES }
  );

  const tokenHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  await pool.query(
    `INSERT INTO adminrefreshtoken (adminid, tokenhash, expiresat)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [admin.id, tokenHash]
  );

  /* COOKIES */
  res.cookie('accessToken', accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  });

  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
  });

  return {
    admin: {
      id: admin.id,
      email: admin.email,
      role: admin.role,
    },
  };
};

export const adminLogoutService = async (refreshToken, res) => {
  if (!refreshToken) return;

  const tokenHash = crypto
    .createHash('sha256')
    .update(refreshToken)
    .digest('hex');

  await pool.query(
    'DELETE FROM adminrefreshtoken WHERE tokenhash=$1',
    [tokenHash]
  );

  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
};
 


export const getCurrentAdminService = async (adminId) => {
  const { rows } = await pool.query(
    `
    SELECT
      id,
      email,
      role,
      isactive,
      createdat
    FROM admins
    WHERE id = $1 AND isactive = true
    `,
    [adminId]
  );

  if (!rows.length) {
    throw new Error('Admin not found');
  }

  return rows[0];
};
