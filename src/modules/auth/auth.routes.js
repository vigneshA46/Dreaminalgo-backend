import { Router } from "express";
import { signup, login, verifyEmail } from "./auth.controller.js";

import { logout } from "./auth.logout.controller.js";
import { refreshToken } from "./auth.refresh.controller.js";


const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/verify-email", verifyEmail);


router.post("/logout", logout);
router.post("/refresh",refreshToken)



export default router;