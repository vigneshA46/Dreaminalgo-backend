import pool from "../../config/db.js";

export const logout = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (refreshToken) {
    await pool.query(
      `
      UPDATE refreshtoken
      SET revokedat = NOW()
      WHERE tokenhash = $1
      `,
      [refreshToken]
    );
  }

  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
  });
  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "strict",
  });


  res.status(200).json({ message: "Logged out successfully" });
};
