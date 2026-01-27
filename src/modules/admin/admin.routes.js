import { Router } from 'express';
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';
import {
  createAdmin,
/*   getAllAdmins,
  updateAdmin,
  deleteAdmin */
} from './admin.controller.js';



const router = Router();

/* SUPERADMIN ONLY */
router.post(
  '/',
  authenticate,
  authorize('Super Admin'),
  createAdmin
);

/* router.get(
  '/',
  authenticate,
  authorize('superadmin'),
  getAllAdmins
);

router.put(
  '/:id',
  authenticate,
  authorize('superadmin'),
  updateAdmin
);

router.delete(
  '/:id',
  authenticate,
  authorize('superadmin'),
  deleteAdmin
);
 */
export default router;
