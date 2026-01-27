import  createAdminService  from './admin.service.js';


export const createAdmin = async (req, res) => {
  const admin = await createAdminService(req.body, req.auth.id);

  res.status(201).json({
    message: 'Admin created successfully',
    admin,
  });
};

 