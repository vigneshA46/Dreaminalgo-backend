import { Router } from "express";
import {
  createTradeEvent,
  getEventsByDateTokenStrategy,
  getEventsByDateStrategy
} from "./papertrade.controller.js";

import authenticate from "../../middlewares/authenticate.js"; 
import authorize from "../../middlewares/authorize.js"; 

const router = Router();

/*
-----------------------------------------
CREATE TRADE EVENT (ENTRY / EXIT)
-----------------------------------------
*/
router.post(
  "/event",
  // authenticate,
  // authorize,
  createTradeEvent
);


/*
-----------------------------------------
GET EVENTS BY DATE + TOKEN + STRATEGY
-----------------------------------------
Example:
GET /api/papertrade/event/by-token?date=2026-03-17&token=57735&strategy_id=xxx
-----------------------------------------
*/
router.get(
  "/event/by-token",
  getEventsByDateTokenStrategy
);


/*
-----------------------------------------
GET EVENTS BY DATE + STRATEGY
-----------------------------------------
Example:
GET /api/papertrade/event/by-strategy?date=2026-03-17&strategy_id=xxx
-----------------------------------------
*/
router.get(
  "/event/by-strategy",
  getEventsByDateStrategy
);

export default router;