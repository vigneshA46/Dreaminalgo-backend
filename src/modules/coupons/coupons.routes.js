import express from "express";
import {
  applyCoupon,
  createCoupon,
  getCoupons,
  toggleCoupon,
  deleteCoupon,
} from "./coupons.controller.js";

import authenticate from "../../middlewares/authenticate.js";
import authorize from "../../middlewares/authorize.js";

const router = express.Router();

// USER
router.post("/apply", authenticate, applyCoupon);

// ADMIN
router.post("/", authenticate, authorize("superadmin"), createCoupon);
router.get("/", authenticate, authorize("superadmin"), getCoupons);
router.patch("/:id/toggle", authenticate, authorize("superadmin"), toggleCoupon);
router.delete("/:id", authenticate, authorize("superadmin"), deleteCoupon);

export default router;