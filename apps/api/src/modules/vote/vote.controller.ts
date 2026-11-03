import { Response } from "express";
import { VoteService } from "./vote.service";
import { AuthRequest } from "../../middleware/auth.middleware";

const voteService = new VoteService();

export class VoteController {
  async create(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (user.status !== "APPROVED") {
        return res.status(403).json({ error: "Only approved users can create votes" });
      }

      const { title, description, allowMultiple, startAt, endAt, options } = req.body;

      if (!title || !startAt || !endAt || !options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const vote = await voteService.createVote({
        creatorId: user.id,
        title,
        description,
        allowMultiple: Boolean(allowMultiple),
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        options,
      });

      res.status(201).json({ vote });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async list(req: AuthRequest, res: Response) {
    try {
      const votes = await voteService.getVotes();
      res.json({ votes });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async getById(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const vote = await voteService.getVoteById(id);
      if (!vote) {
        return res.status(404).json({ error: "Vote not found" });
      }
      res.json({ vote });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async submit(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { id } = req.params;
      const { optionIds } = req.body;

      if (!optionIds || !Array.isArray(optionIds) || optionIds.length === 0) {
        return res.status(400).json({ error: "Missing optionIds" });
      }

      const result = await voteService.submitVote({
        userId: user.id,
        voteId: id,
        optionIds,
      });

      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async downloadAuditPdf(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const { voteId } = req.params;
      const pdfBuffer = await voteService.generateAuditPdf(voteId);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="vote-audit-${voteId}.pdf"`
      );
      res.send(pdfBuffer);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async hasVoted(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const result = await voteService.hasUserVoted(userId, id);
      const history = result ? await voteService.getUserVoteHistory(userId, id) : null;
      res.json({ hasVoted: result, history });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async myVotes(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const votes = await voteService.getMyVotes(userId);
      res.json({ votes });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
