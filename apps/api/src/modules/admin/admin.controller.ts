import { Response } from "express";
import { AdminService } from "./admin.service";
import { AuthRequest } from "../../middleware/auth.middleware";
import { statusCodeOf, messageOf } from "../../utils/errors";

const adminService = new AdminService();

export class AdminController {
  async listUsers(req: AuthRequest, res: Response) {
    try {
      const users = await adminService.listUsers();
      res.json({ users });
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }

  async resetPassword(req: AuthRequest, res: Response) {
    try {
      const { id } = req.params;
      const result = await adminService.resetPassword(id);
      res.json(result);
    } catch (error: any) {
      res.status(statusCodeOf(error)).json({ error: messageOf(error) });
    }
  }
}
