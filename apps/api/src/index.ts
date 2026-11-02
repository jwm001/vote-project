import express from "express";
import cors from "cors";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import voteRoutes from "./modules/vote/vote.routes";
import auditRoutes from "./modules/audit/audit.routes";

// Protect uploads - require admin access
// We'll use a separate route for admin to access files
app.use("/api", auditRoutes);

import authMiddleware from "./middleware/auth.middleware";
// For file access control, serve uploads only to admins
app.get("/uploads/:filename", authMiddleware, async (req: any, res) => {
  const user = req.user;
  if (!user || user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { filename } = req.params;
  const filePath = path.join(process.cwd(), "uploads", filename);
  res.sendFile(filePath, (err) => {
    if (err) {
      res.status(404).json({ error: "File not found" });
    }
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/votes", voteRoutes);

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

