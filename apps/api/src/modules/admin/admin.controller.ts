import { Response } from "express";
import { AdminService } from "./admin.service";
import { AuthRequest } from "../../middleware/auth.middleware";

const adminService = new AdminService();

export class AdminController {
  async listPending(req: AuthRequest, res: Response) {
    try {
      const users = await adminService.listPending();
      res.json({ users });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async approve(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const user = await adminService.approve(id);
      res.json({ user });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

  async reject(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const user = await adminService.reject(id);
      res.json({ user });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
}
