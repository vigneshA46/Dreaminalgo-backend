import * as authService from "./auth.service.js";

export const signup = async (req, res) => {
  const result = await authService.signupService(req.body);
  res.status(201).json(result);
};

export const login = async (req, res) => {
  const { accessToken, refreshToken ,userid} =
    await authService.loginService(req.body);

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: true,          // MUST be true (HTTPS)
    sameSite: "none",      // MUST be none for cross-site
    path: "/"
  });

    res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: true,          // MUST be true (HTTPS)
    sameSite: "none",      // MUST be none for cross-site
    path: "/"
  });

  res.json({ userid });
};

export const verifyEmail = async (req, res) => {
  await authService.verifyEmailService(req.query.token);
  res.json({ message: "Email verified successfully" });
};


export const changePassword = async (req, res) => {
  try {

    const userId = req.user.id; // ✅ from auth middleware
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required"
      });
    }

    const result = await authService.changePasswordService(userId, password);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {

    console.error("Change Password Error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Failed to change password"
    });
  }
};

export const changePasswordAdmin = async (req, res) => {
  try {

    const { userId , password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required"
      });
    }

    const result = await authService.changePasswordService(userId, password);

    res.json({
      success: true,
      ...result
    });

  } catch (error) {

    console.error("Change Password Error:", error);

    res.status(500).json({
      success: false,
      message: error.message || "Failed to change password"
    });
  }
};