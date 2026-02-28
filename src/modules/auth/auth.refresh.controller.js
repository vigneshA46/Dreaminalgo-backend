import { refreshTokenService } from "./auth.refresh.service.js";

export const refreshToken = async (req, res) => {
  const oldRefreshToken = req.cookies.refreshToken;

  const { accessToken, refreshToken } =
    await refreshTokenService(oldRefreshToken);
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true,          // MUST be true (HTTPS)
    sameSite: "none",      // MUST be none for cross-site
    path: "/" 
  });

  res.cookie("accessToken",accessToken,{
     httpOnly: true,
    secure: true,          // MUST be true (HTTPS)
    sameSite: "none",      // MUST be none for cross-site
    path: "/"
  })

  console.log("🍪 Cookies:", req.cookies);

  res.status(200).json({ accessToken });
};
