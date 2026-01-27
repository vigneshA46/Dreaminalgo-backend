import {
  adminLoginService,
  adminLogoutService
} from './admin.auth.service.js';

export const adminLogin = async (req, res) => {
  const { email, password } = req.body;

  const result = await adminLoginService(email, password, res);

  return res.status(200).json({
    message: 'Admin logged in successfully',
    admin: result.admin,
  });
};

export const adminLogout = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  await adminLogoutService(refreshToken, res);

  return res.status(200).json({ message: 'Admin logged out' });
};


import { getCurrentAdminService } from './admin.auth.service.js';

export const getCurrentAdmin = async (req, res) => {
  try {
    const adminId = req.user.id; // 🔥 from middleware

    const admin = await getCurrentAdminService(adminId);

    res.status(200).json(admin);
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
};
