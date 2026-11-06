import express from "express";
import cors from "cors";

import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import voteRoutes from "./modules/vote/vote.routes";
import inviteRoutes from "./modules/vote/invite.routes";
import auditRoutes from "./modules/audit/audit.routes";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api", auditRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/votes", voteRoutes);
  app.use("/api/invites", inviteRoutes);

  return app;
}
