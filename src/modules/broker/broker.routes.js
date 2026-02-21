import { Router } from 'express';
import * as brokerController from "./broker.controller.js";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';

const router  = Router();

/*
  CONNECT BROKER
  Any authenticated user can connect
*/
router.post(
  "/",
  authenticate,
  brokerController.connectBroker
);

/*
  GET USER BROKERS
*/
router.get(
  "/",
  authenticate,
  brokerController.getUserBrokers
);

/*
  GET SINGLE BROKER
*/
router.get(
  "/:id",
  authenticate,
  brokerController.getBrokerById
);

/*
  DELETE BROKER CONNECTION
*/
router.delete(
  "/:id",
  authenticate,
  brokerController.deleteBroker
);

/*
  ADMIN: UPDATE BROKER STATUS
*/
router.patch(
  "/:id/status",
  authenticate,
  authorize("superadmin", "admin"),
  brokerController.updateBrokerStatus
);

export default router;