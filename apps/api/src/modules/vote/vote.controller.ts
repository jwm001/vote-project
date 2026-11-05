import { Response } from "express";
import { VoteService } from "./vote.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { messageOf, statusCodeOf } from "../../utils/errors";

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

      const { title, description, allowMultiple, participationMode, resultsPublicDuringVote, endAt, durationMinutes, options } = req.body;

      if (!title || !participationMode || !options || !Array.isArray(options) || options.length === 0) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const vote = await voteService.createVote({
        creatorId: user.id,
        title,
        description,
        allowMultiple: Boolean(allowMultiple),
        participationMode,
        resultsPublicDuringVote: resultsPublicDuringVote === undefined ? undefined : Boolean(resultsPublicDuringVote),
        endAt: endAt ? new Date(endAt) : undefined,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        options,
      });

      res.status(201).json({ vote });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async update(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (user.status !== "APPROVED") {
        return res.status(403).json({ error: "Only approved users can update votes" });
      }

      const { id } = req.params;
      const vote = await voteService.updateVote(id, user.id, req.body);

      res.json({ vote });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async remove(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (user.status !== "APPROVED") {
        return res.status(403).json({ error: "Only approved users can delete votes" });
      }

      const { id } = req.params;
      await voteService.deleteVote(id, user.id);

      res.json({ ok: true });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async end(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      if (user.status !== "APPROVED") {
        return res.status(403).json({ error: "Only approved users can end votes" });
      }

      const { id } = req.params;
      const vote = await voteService.endVote(id, user.id);

      res.json({ vote });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async list(req: AuthRequest, res: Response) {
    try {
      const votes = await voteService.getVotes();
      res.json({ votes });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
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
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
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
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
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
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async myVotes(req: AuthRequest, res: Response) {
    try {
      const userId = req.user!.id;
      const votes = await voteService.getMyVotes(userId);
      res.json({ votes });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }
}
