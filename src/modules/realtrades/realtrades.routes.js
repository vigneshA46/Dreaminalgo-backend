import express from "express";

import * as realTradesController from "./realtrades.controller.js";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';


const router = express.Router();


// CREATE TRADE
router.post("/create", realTradesController.createTrade);

// GET TRADES WITH FILTERS
router.get("/",authenticate ,realTradesController.getTrades);
router.get("/opentrades",authenticate ,realTradesController.getOpenTrades);

export default router;
