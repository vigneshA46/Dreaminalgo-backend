import { Router } from "express";

const router = Router();
import authenticate from "../../middlewares/authenticate.js"; 
import authorize from "../../middlewares/authorize.js"; 


import { createNotification, deleteNotification, getActiveNotifications, getAllNotifications, toggleNotification } from "./notification.controller.js"

// -----------------------------
// ADMIN ROUTES
// -----------------------------
router.post("/",authenticate, createNotification);

router.get("/admin",authenticate, getAllNotifications);

router.patch("/:id/toggle",authenticate, toggleNotification);

router.delete("/:id",authenticate, deleteNotification);

// -----------------------------
// USER ROUTES
// -----------------------------
router.get("/",authenticate, getActiveNotifications);

export default router;