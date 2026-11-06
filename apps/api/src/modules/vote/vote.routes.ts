import { Router } from "express";
import { VoteController } from "./vote.controller";
import { InviteController } from "./invite.controller";
import { authMiddleware } from "../../middleware/auth.middleware";
import { verifiedMiddleware } from "../../middleware/verified.middleware";

const router = Router();
const voteController = new VoteController();
const inviteController = new InviteController();

router.post("/", authMiddleware, verifiedMiddleware, voteController.create.bind(voteController));

// My invitations must stay above "/:id".
router.get("/my/votes", authMiddleware, voteController.myVotes.bind(voteController));
router.get("/my/invites", authMiddleware, inviteController.myInvites.bind(inviteController));
router.post(
  "/my/invites/:inviteId/accept",
  authMiddleware,
  verifiedMiddleware,
  inviteController.acceptById.bind(inviteController)
);

router.post(
  "/:id/invites/usernames",
  authMiddleware,
  verifiedMiddleware,
  inviteController.createUsernames.bind(inviteController)
);
router.post(
  "/:id/invites/links",
  authMiddleware,
  verifiedMiddleware,
  inviteController.createLinks.bind(inviteController)
);
router.get(
  "/:id/invites",
  authMiddleware,
  verifiedMiddleware,
  inviteController.list.bind(inviteController)
);
router.delete(
  "/:id/invites/:inviteId",
  authMiddleware,
  verifiedMiddleware,
  inviteController.remove.bind(inviteController)
);
router.post(
  "/:id/start",
  authMiddleware,
  verifiedMiddleware,
  inviteController.start.bind(inviteController)
);

router.post("/:id/submit", authMiddleware, verifiedMiddleware, voteController.submit.bind(voteController));
router.patch("/:id", authMiddleware, verifiedMiddleware, voteController.update.bind(voteController));
router.delete("/:id", authMiddleware, verifiedMiddleware, voteController.remove.bind(voteController));
router.post("/:id/end", authMiddleware, verifiedMiddleware, voteController.end.bind(voteController));
router.get("/:id/has-voted", authMiddleware, voteController.hasVoted.bind(voteController));
router.get("/:id", authMiddleware, voteController.getById.bind(voteController));

export default router;
