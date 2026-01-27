import pool from "../../config/db.js";
import jwt from "jsonwebtoken";
import { signAccessToken, signRefreshToken } from "../../utils/jwt.js";

export const refreshTokenService = async (oldToken) => {
  if (!oldToken) throw new Error("Refresh token missing");

  let payload;
  try {
    payload = jwt.verify(oldToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new Error("Invalid refresh token");
  }

  // 1️⃣ Check token exists in DB and not revoked
  const tokenRes = await pool.query(
    `
    SELECT * FROM refreshtoken
    WHERE tokenhash = $1
    `,
    [oldToken]
  );

  if (!tokenRes.rows.length) {
    throw new Error("Refresh token revoked");
  }

  const userId = payload.id;

  // 2️⃣ Revoke old token
  await pool.query(
    `
    UPDATE refreshtoken
    SET revokedat = NOW()
    WHERE tokenhash = $1
    `,
    [oldToken]
  );

  // 3️⃣ Generate new tokens
  const newAccessToken = signAccessToken({ id: userId });
  const newRefreshToken = signRefreshToken({ id: userId });

  // 4️⃣ Store new refresh token
  await pool.query(
    `
    INSERT INTO refreshtoken (userid, tokenhash, expiresat)
    VALUES ($1, $2, NOW() + INTERVAL '7 days')
    `,
    [userId, newRefreshToken]
  );

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};


