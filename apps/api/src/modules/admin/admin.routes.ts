import { Router } from "express";
import { AdminController } from "./admin.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { adminMiddleware } from "../../middleware/admin.middleware";

const router = Router();
const adminController = new AdminController();

router.get("/pending", authMiddleware, adminMiddleware, adminController.listPending.bind(adminController));
router.post("/:id/approve", authMiddleware, adminMiddleware, adminController.approve.bind(adminController));
router.post("/:id/reject", authMiddleware, adminMiddleware, adminController.reject.bind(adminController));

export default router;
