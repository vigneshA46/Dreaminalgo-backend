import { Router } from "express";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';

import {
  createTraderSignal,
  getAllSignals,
  getSignalsByDate,
  getSignalsByUserId,
  getSignalById,
  getSignalsBystatus,
  deleteSignal
} from "./tradersignal.controller.js";

const router = Router();

/* CREATE SIGNAL */
router.post("/",authenticate, createTraderSignal);

/* GET ALL SIGNALS */
router.get("/",authenticate, getAllSignals);

/* GET SIGNALS BY DATE */
router.get("/date/:date" , authenticate, getSignalsByDate);

/* GET SIGNALS BY USER */
router.get("/user" , authenticate, getSignalsByUserId);

router.get("/status/:status",authenticate, getSignalsBystatus);

router.delete("/signals/:id",authenticate, deleteSignal);

/* GET SINGLE SIGNAL */
router.get("/:id",authenticate, getSignalById);


export default router;