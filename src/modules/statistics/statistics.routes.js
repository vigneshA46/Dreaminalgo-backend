import { Router } from 'express';
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';
import * as statisticsController from '../statistics/statistics.controller.js'


const router = Router();

router.get("/",authenticate , statisticsController.getStrategyStats )

export default router;