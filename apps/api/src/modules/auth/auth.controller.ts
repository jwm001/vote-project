import { Request, Response } from "express";
import { AuthService, toPublicUser } from "./auth.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { messageOf, statusCodeOf } from "../../utils/errors";

const authService = new AuthService();

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const { realName, idNumber, username, password } = req.body;

      const result = await authService.register({
        username,
        password,
        realName,
        idNumber,
        ip: req.ip,
      });

      res.status(201).json(result);
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const result = await authService.login(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async reverify(req: AuthRequest, res: Response) {
    try {
      const { realName, idNumber } = req.body;
      const user = req.user;
      if (!user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const result = await authService.reverifyIdentity(user.id, {
        realName,
        idNumber,
        ip: req.ip,
      });

      res.json(result);
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async me(req: AuthRequest, res: Response) {
    const user = req.user;
    if (user) {
      res.json({ user: toPublicUser(user) });
    } else {
      res.json({ user: user });
    }
  }
}
