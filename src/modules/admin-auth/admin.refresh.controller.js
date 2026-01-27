import refreshAdminTokenService from './admin.refresh.service.js';

const refreshAdminToken = async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  const result = await refreshAdminTokenService(refreshToken, res);

  return res.status(200).json({
    message: 'Admin token refreshed',
    admin: result.admin,
  });
};

export default refreshAdminToken;
 