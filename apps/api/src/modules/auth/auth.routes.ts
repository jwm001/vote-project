import { Router } from "express";
import { AuthController } from "./auth.controller";
import { authMiddleware } from "../../middleware/auth.middleware";

const router = Router();
const authController = new AuthController();

router.post("/register", authController.register.bind(authController));
router.post("/login", authController.login.bind(authController));
router.post("/change-password", authMiddleware, authController.changePassword.bind(authController));
router.post("/reverify", authMiddleware, authController.reverify.bind(authController));
router.get("/me", authMiddleware, authController.me.bind(authController));

export default router;
