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

router.post(
  "/alice/callback",
  authenticate,
  brokerController.aliceCallback
);

router.post("/alice/session", authenticate, brokerController.aliceSession);

/*
  GET USER BROKERS
*/
router.get( 
  "/",
  authenticate,
  brokerController.getUserBrokers
);


router.get(
  "/userbase",
  authenticate,
  brokerController.getUserbaseBrokers
)

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

router.patch(
"/:id/credentials",
  brokerController.updateBrokerCredentials
);



export default router;