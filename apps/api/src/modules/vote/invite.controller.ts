import { Response } from "express";
import { InviteService } from "./invite.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { messageOf, statusCodeOf } from "../../utils/errors";

const inviteService = new InviteService();

export class InviteController {
  private approvedUserOrRespond(req: AuthRequest, res: Response) {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return null;
    }
    if (user.status !== "APPROVED") {
      res.status(403).json({ error: "Only approved users can perform this action" });
      return null;
    }
    return user;
  }

  async createUsernames(req: AuthRequest, res: Response) {
    try {
      const user = this.approvedUserOrRespond(req, res);
      if (!user) return;

      const raw = req.body?.usernames;
      const usernames = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? raw.split(/[\s,，]+/).filter(Boolean)
          : [];

      const result = await inviteService.createUsernameInvites(
        req.params.id,
        user.id,
        usernames
      );
      res.status(201).json(result);
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async createLinks(req: AuthRequest, res: Response) {
    try {
      const user = this.approvedUserOrRespond(req, res);
      if (!user) return;

      const count = Number(req.body?.count);
      const result = await inviteService.createLinkInvites(
        req.params.id,
        user.id,
        count
      );
      res.status(201).json(result);
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async list(req: AuthRequest, res: Response) {
    try {
      const user = this.approvedUserOrRespond(req, res);
      if (!user) return;

      const invites = await inviteService.listInvites(req.params.id, {
        id: user.id,
        role: user.role,
      });
      res.json({ invites });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async remove(req: AuthRequest, res: Response) {
    try {
      const user = this.approvedUserOrRespond(req, res);
      if (!user) return;

      await inviteService.removeInvite(
        req.params.id,
        req.params.inviteId,
        user.id
      );
      res.json({ ok: true });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async start(req: AuthRequest, res: Response) {
    try {
      const user = this.approvedUserOrRespond(req, res);
      if (!user) return;

      const vote = await inviteService.startVote(req.params.id, user.id);
      res.json({ vote });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async myInvites(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const invites = await inviteService.getMyInvites(user.id);
      res.json({ invites });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async acceptById(req: AuthRequest, res: Response) {
    try {
      const user = this.approvedUserOrRespond(req, res);
      if (!user) return;

      const invite = await inviteService.acceptInviteById(
        req.params.inviteId,
        user
      );
      res.json({ invite });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async getByToken(req: AuthRequest, res: Response) {
    try {
      const invite = await inviteService.getInviteByToken(req.params.token);
      res.json({ invite });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async acceptByToken(req: AuthRequest, res: Response) {
    try {
      const user = this.approvedUserOrRespond(req, res);
      if (!user) return;

      const invite = await inviteService.acceptInvite(req.params.token, user);
      res.json({ invite });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }
}
