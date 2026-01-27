import { Router } from 'express';
import {
  adminLogin,
  adminLogout,
  getCurrentAdmin
} from './admin.auth.controller.js';
import  refreshAdminToken  from './admin.refresh.controller.js';
import authenticate from '../../middlewares/authenticate.js';
import authorize from '../../middlewares/authorize.js';

const router = Router();

router.post('/login', adminLogin);
router.post('/refresh', refreshAdminToken);
router.post('/logout', adminLogout);
router.post('/me',authenticate , authorize('Super Admin'),getCurrentAdmin);

export default router;
