import { Router } from "express";
import { AdminController } from "./admin.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { adminMiddleware } from "../../middleware/admin.middleware";

const router = Router();
const adminController = new AdminController();

router.get("/users", authMiddleware, adminMiddleware, adminController.listUsers.bind(adminController));
router.post("/users/:id/reset-password", authMiddleware, adminMiddleware, adminController.resetPassword.bind(adminController));

export default router;
