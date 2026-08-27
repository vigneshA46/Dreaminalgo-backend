import { Router } from 'express';

import authenticate from '../../middlewares/authenticate.js';
import authorize from '../../middlewares/authorize.js';

import * as tokenlogsController from './tokenlogs.controller.js';

const router = Router();


router.get(
  '/',
  authenticate,
  authorize('superadmin', 'courseadmin'),
  tokenlogsController.getAllTokenLogs
);


export default router;