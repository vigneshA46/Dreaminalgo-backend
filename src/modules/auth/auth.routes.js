import { Router } from "express";
import { signup, login, verifyEmail, changePassword, changePasswordAdmin } from "./auth.controller.js";

import { logout } from "./auth.logout.controller.js";
import { refreshToken } from "./auth.refresh.controller.js";
import authenticate from "../../middlewares/authenticate.js";


const router = Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/verify-email", verifyEmail);

router.post("/change-password", authenticate, changePassword);
router.post("/change-password-admin", authenticate, changePasswordAdmin);


router.post("/logout", logout);
router.post("/refresh",refreshToken)



export default router;
 