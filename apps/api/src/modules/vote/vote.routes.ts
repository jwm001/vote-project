import { Router } from "express";
import { VoteController } from "./vote.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { verifiedMiddleware } from "../../middleware/verified.middleware";

const router = Router();
const voteController = new VoteController();

router.post("/", authMiddleware, verifiedMiddleware, voteController.create.bind(voteController));
router.post("/:id/submit", authMiddleware, verifiedMiddleware, voteController.submit.bind(voteController));
router.get("/", voteController.list.bind(voteController));
router.get("/my/votes", authMiddleware, voteController.myVotes.bind(voteController));
router.get("/:id/has-voted", authMiddleware, voteController.hasVoted.bind(voteController));
router.get("/:id", voteController.getById.bind(voteController));
router.get("/:voteId/audit/pdf", authMiddleware, voteController.downloadAuditPdf.bind(voteController));

export default router;
