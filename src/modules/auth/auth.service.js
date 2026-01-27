    import pool from "../../config/db.js";
import { hashPassword, comparePassword } from "../../utils/password.js";
import { signAccessToken, signRefreshToken } from "../../utils/jwt.js";
import { generateToken, hashToken } from "../../utils/crypto.js";
import { sendVerificationEmail } from "../../utils/email.js";

export const signupService = async ({ email, password, fullname }) => {
  const passwordHash = await hashPassword(password);

  const userRes = await pool.query(
    `INSERT INTO users (email, passwordhash, fullname, isactive)
     VALUES ($1, $2, $3, false) RETURNING id`,
    [email, passwordHash, fullname]
  );

  const userId = userRes.rows[0].id;

  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);

  await pool.query(
    `INSERT INTO email_verifications (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '24 hours')`,
    [userId, tokenHash]
  );

  const verifyLink = `${process.env.CLIENT_URL}/verify-email?token=${rawToken}`;
  await sendVerificationEmail(email, verifyLink);

  return { message: "Verification email sent" };
};


export const loginService = async ({ email, password }) => {
  const userRes = await pool.query(
    `SELECT * FROM users WHERE email=$1`,
    [email]
  );

  const user = userRes.rows[0];
  if (!user || !user.isactive) throw new Error("Invalid credentials");

  const isMatch = await comparePassword(password, user.passwordhash);
  if (!isMatch) throw new Error("Invalid credentials");

  const accessToken = signAccessToken({ id: user.id, role: user.role });
  const refreshToken = signRefreshToken({ id: user.id });
  const userid = user.id;

  await pool.query(
    `INSERT INTO refreshtoken (userid, tokenhash, expiresat)
     VALUES ($1, $2, NOW() + INTERVAL '7 days')`,
    [user.id, refreshToken]
  );

  return { accessToken, refreshToken,userid };
};


export const verifyEmailService = async (token) => {
  const tokenHash = hashToken(token);

  const res = await pool.query(
    `SELECT * FROM email_verifications
     WHERE token_hash=$1 AND expires_at > NOW() AND verified_at IS NULL`,
    [tokenHash]
  );

  if (!res.rows.length) throw new Error("Invalid or expired token");

  const record = res.rows[0];

  await pool.query(`UPDATE users SET isactive=true WHERE id=$1`, [
    record.user_id,
  ]);

  await pool.query(
    `UPDATE email_verifications SET verified_at=NOW() WHERE id=$1`,
    [record.id]
  );
};
