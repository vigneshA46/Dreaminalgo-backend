import { Router } from "express";
import {
  createPaperTrade,
  getTradesByDateTokenStrategy,
  getTradesByDateStrategy
} from "./papertrade.controller.js";

import authenticate from "../../middlewares/authenticate.js"; 
import authorize from "../../middlewares/authorize.js"; 

const router = Router();

/*
-----------------------------------------
CREATE PAPER TRADE
-----------------------------------------
*/
router.post(
  "/papertradelogger",
   // authenticate,
  // authorize,
  createPaperTrade
);


/*
-----------------------------------------
GET BY DATE + TOKEN + STRATEGY
-----------------------------------------
Example:
GET /api/papertrade?date=2026-03-17&token=57735&strategy_id=xxx
-----------------------------------------
*/
router.get(
  "/by-token",
  
  getTradesByDateTokenStrategy
);


/*
-----------------------------------------
GET BY DATE + STRATEGY
-----------------------------------------
Example:
GET /api/papertrade?date=2026-03-17&strategy_id=xxx
-----------------------------------------
*/
router.get(
  "/by-strategy",
  
  getTradesByDateStrategy
);

export default router;