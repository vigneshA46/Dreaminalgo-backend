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
    secure: true,          // MUST be true (HTTPS)
    sameSite: "none",      // MUST be none for cross-site
    path: "/"
  });
  res.clearCookie("accessToken", {
    httpOnly: true,
    secure: true,          // MUST be true (HTTPS)
    sameSite: "none",      // MUST be none for cross-site
    path: "/"
  });


  res.status(200).json({ message: "Logged out successfully" });
};
