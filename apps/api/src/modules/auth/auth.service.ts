import { prisma } from "../../utils/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { encrypt, decrypt } from "../../utils/encryption";
import { hashIdNumber, normalizeIdNumber, isValidIdNumber } from "../../utils/identity";
import { AppError } from "../../utils/errors";
import { checkRateLimit } from "../../utils/rate-limit";
import { getIdentityProvider, IdentityProvider, IdentityResult } from "../identity/identity.provider";

const MIN_PASSWORD_LENGTH = 6;
const REGISTER_RATE_LIMIT = 5;
const REGISTER_RATE_WINDOW_MS = 3_600_000;
const REVERIFY_RATE_LIMIT = 5;
const REVERIFY_RATE_WINDOW_MS = 3_600_000;

export interface PublicUser {
  id: string;
  username: string;
  status: string;
  role: string;
  realName: string;
  identityVerifiedAt: Date | null;
}

export function toPublicUser(user: {
  id: string;
  username: string;
  realName: string;
  status: string;
  role: string;
  identityVerifiedAt?: Date | null;
}): PublicUser {
  let realName = user.realName;
  try {
    realName = decrypt(user.realName);
  } catch {
    // 兼容历史明文数据
  }
  return {
    id: user.id,
    username: user.username,
    status: user.status,
    role: user.role,
    realName,
    identityVerifiedAt: user.identityVerifiedAt ?? null,
  };
}

interface RegisterInput {
  username?: string;
  password?: string;
  realName: string;
  idNumber: string;
  ip?: string;
}

interface ReverifyInput {
  realName: string;
  idNumber: string;
  ip?: string;
}

export class AuthService {
  constructor(private readonly identityProvider: IdentityProvider = getIdentityProvider()) {}

  async register(data: RegisterInput) {
    const realName = (data.realName || "").trim();
    const idNumber = normalizeIdNumber(data.idNumber || "");
    const username = (data.username || "").trim();
    const password = data.password || "";

    if (!realName) {
      throw new AppError("请填写真实姓名", 400);
    }
    if (!isValidIdNumber(idNumber)) {
      throw new AppError("身份证号格式不正确", 400);
    }
    if (!username) {
      throw new AppError("请填写用户名", 400);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new AppError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`, 400);
    }
    if (username.toUpperCase() === idNumber) {
      throw new AppError("用户名不能使用身份证号", 400);
    }

    const idNumberHash = hashIdNumber(idNumber);

    if (!checkRateLimit(`register:${data.ip ?? "unknown"}`, REGISTER_RATE_LIMIT, REGISTER_RATE_WINDOW_MS)) {
      throw new AppError("注册过于频繁，请稍后再试", 429);
    }

    const existingIdNumber = await prisma.user.findUnique({
      where: { idNumberHash },
    });
    if (existingIdNumber) {
      throw new AppError("该身份证号已注册", 409);
    }

    const existingUsername = await prisma.user.findUnique({
      where: { username },
    });
    if (existingUsername) {
      throw new AppError("用户名已被占用", 409);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let verifyResult: IdentityResult;
    try {
      verifyResult = await this.identityProvider.verify({ realName, idNumber });
    } catch {
      // provider 异常 / 超时 → 视为「服务不可用」，进入待核验状态
      verifyResult = { ok: false, unavailable: true };
    }

    let status: string;
    let identityVerificationRef: string | null = null;
    let identityVerifiedAt: Date | null = null;

    if (verifyResult.unavailable) {
      status = "PENDING_VERIFICATION";
    } else if (verifyResult.ok) {
      status = "APPROVED";
      identityVerificationRef = verifyResult.reference ?? null;
      identityVerifiedAt = new Date();
    } else {
      throw new AppError("实名信息核验未通过", 400);
    }

    let user;
    try {
      user = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          realName: encrypt(realName),
          // 身份证号等敏感信息只保留摘要，不落明文 / 图片
          idNumber: "",
          idNumberHash,
          idCardImages: "[]",
          status,
          role: "USER",
          identityVerificationRef,
          identityVerifiedAt,
        },
      });
    } catch (error: any) {
      // 并发注册时唯一索引兜底
      if (error?.code === "P2002") {
        const target = String(error?.meta?.target || "");
        if (target.includes("idNumberHash")) {
          throw new AppError("该身份证号已注册", 409);
        }
        throw new AppError("用户名已被占用", 409);
      }
      throw error;
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || "test-secret-key",
      { expiresIn: "7d" }
    );

    return { user: toPublicUser(user), token };
  }

  async login(data: { username: string; password: string }) {
    const user = await prisma.user.findUnique({
      where: { username: (data.username || "").trim() },
    });
    if (!user || !(await bcrypt.compare(data.password || "", user.password))) {
      throw new AppError("用户名或密码错误", 401);
    }
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || "test-secret-key",
      { expiresIn: "7d" }
    );
    return { token, user: toPublicUser(user) };
  }

  async reverifyIdentity(userId: string, data: ReverifyInput) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new AppError("用户不存在", 404);
    }
    if (user.status !== "PENDING_VERIFICATION") {
      throw new AppError("该用户已完成实名核验", 409);
    }

    const realName = (data.realName || "").trim();
    const idNumber = normalizeIdNumber(data.idNumber || "");
    const idNumberHash = hashIdNumber(idNumber);

    const existingIdNumber = await prisma.user.findUnique({
      where: { idNumberHash },
    });
    if (existingIdNumber && existingIdNumber.id !== userId) {
      throw new AppError("该身份证号已注册", 409);
    }

    if (!isValidIdNumber(idNumber)) {
      throw new AppError("身份证号格式不正确", 400);
    }

    if (
      !checkRateLimit(`reverify:${data.ip ?? "unknown"}`, REVERIFY_RATE_LIMIT, REVERIFY_RATE_WINDOW_MS)
    ) {
      throw new AppError("实名核验过于频繁，请稍后再试", 429);
    }

    let verifyResult: IdentityResult;
    try {
      verifyResult = await this.identityProvider.verify({ realName, idNumber });
    } catch {
      throw new AppError("实名核验服务暂不可用，请稍后重试", 503);
    }

    if (!verifyResult.ok) {
      throw new AppError("实名信息核验未通过", 400);
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        status: "APPROVED",
        idNumberHash,
        identityVerificationRef: verifyResult.reference ?? null,
        identityVerifiedAt: new Date(),
      },
    });

    return { user: toPublicUser(updated) };
  }
}
