import express from "express";
import cors from "cors";

import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import voteRoutes from "./modules/vote/vote.routes";
import inviteRoutes from "./modules/vote/invite.routes";
import auditRoutes from "./modules/audit/audit.routes";

export function createApp() {
  const app = express();

  // 生产部署在 Nginx 后面：信任一跳代理，req.ip 才是真实客户端地址。
  // 注册 / 重新核验限流按 IP 计数，不设置会让所有用户共用一个限额。
  app.set("trust proxy", 1);

  // 默认不发 CORS 头：Web 与 API 同域部署，浏览器不需要跨域许可。
  // 确实需要跨域时用 CORS_ORIGIN 指定，多个来源用逗号分隔。
  const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (allowedOrigins.length > 0) {
    app.use(cors({ origin: allowedOrigins }));
  }

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
