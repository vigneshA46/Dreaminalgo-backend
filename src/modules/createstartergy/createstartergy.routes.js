import express from "express";
import {
  createStrategy,
  getAllStrategy,
  getAdminStrategy,
  getUserStrategy,
  getStrategyByUserId,
  getSingleStrategy,
  deleteStrategy,
  getStrategyByStatus
} from "./createstartergy.controller.js";
import  authenticate  from '../../middlewares/authenticate.js';
import  authorize  from '../../middlewares/authorize.js';

const router = express.Router();

/* CREATE */
router.post("/create",authenticate, createStrategy);

/* GET ALL */
router.get("/",authenticate,authorize, getAllStrategy);

/* GET ADMIN */
router.get("/admin",authenticate,authorize, getAdminStrategy);

router.get("/:id",authenticate, getSingleStrategy);
/* GET USER */
router.get("/user",authenticate, getUserStrategy);

/* GET BY USER ID */
router.post("/user/userid",authenticate, getStrategyByUserId);

/* GET SINGLE */

/* DELETE */
router.delete("/:id",authenticate, deleteStrategy);

router.get("/status/:status",authenticate, getStrategyByStatus);


export default router;