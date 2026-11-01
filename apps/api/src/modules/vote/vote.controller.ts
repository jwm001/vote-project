import { Response } from "express";
import { VoteService } from "./vote.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { prisma } from "../../utils/prisma";

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
}
