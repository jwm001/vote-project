import { Router } from "express";
import { VoteController } from "./vote.controller";
import { authMiddleware } from "../../middleware/auth.middleware";

const router = Router();
const voteController = new VoteController();

router.post("/", authMiddleware, voteController.create.bind(voteController));
router.post("/:id/submit", authMiddleware, voteController.submit.bind(voteController));
router.get("/", voteController.list.bind(voteController));
router.get("/:id", voteController.getById.bind(voteController));

export default router;
