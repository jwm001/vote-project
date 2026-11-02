import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.middleware";

export const verifiedMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.status !== "APPROVED") {
    return res.status(403).json({ error: "Only approved users can perform this action" });
  }
  next();
};
