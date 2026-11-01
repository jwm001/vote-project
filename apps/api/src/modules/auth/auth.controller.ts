import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { AuthRequest } from "../../middleware/auth.middleware";

const authService = new AuthService();

export class AuthController {
  async register(req: Request, res: Response) {
    try {
      const files = req.files as Express.Multer.File[];
      const idCardImages = files?.map((f) => f.path) || [];

      const { realName, idNumber, username, password } = req.body;

      const result = await authService.register({
        username,
        password,
        realName,
        idNumber,
        idCardImages,
      });

      res.status(201).json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async login(req: Request, res: Response) {
    try {
      const result = await authService.login(req.body);
      res.json(result);
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async me(req: AuthRequest, res: Response) {
    res.json({ user: req.user });
  }
}
