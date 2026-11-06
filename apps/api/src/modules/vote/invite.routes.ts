import { Router } from "express";
import { InviteController } from "./invite.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { verifiedMiddleware } from "../../middleware/verified.middleware";

const router = Router();
const inviteController = new InviteController();

router.get("/:token", inviteController.getByToken.bind(inviteController));
router.post(
  "/:token/accept",
  authMiddleware,
  verifiedMiddleware,
  inviteController.acceptByToken.bind(inviteController)
);

export default router;
