import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { AuthController } from "./auth.controller";
import { authMiddleware } from "../../middleware/auth.middleware";

const router = Router();
const authController = new AuthController();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Only images and PDFs are allowed"));
    }
  },
});

router.post("/register", upload.array("idCardImages", 5), authController.register.bind(authController));
router.post("/login", authController.login.bind(authController));
router.get("/me", authMiddleware, authController.me.bind(authController));

export default router;
