import { prisma } from "../../utils/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { encrypt, decrypt } from "../../utils/encryption";
import { hashIdNumber, normalizeIdNumber } from "../../utils/identity";
import { AppError } from "../../utils/errors";

const MIN_PASSWORD_LENGTH = 6;

function publicUser(user: {
  id: string;
  username: string;
  realName: string;
  status: string;
  role: string;
}) {
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
  };
}

export class AuthService {
  async register(data: {
    username?: string;
    password?: string;
    realName: string;
    idNumber: string;
    idCardImages: string[];
  }) {
    const realName = (data.realName || "").trim();
    const idNumber = normalizeIdNumber(data.idNumber || "");
    const username = (data.username || "").trim();
    const password = data.password || "";

    if (!realName) {
      throw new AppError("请填写真实姓名", 400);
    }
    if (!idNumber) {
      throw new AppError("请填写身份证号", 400);
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

    // 同一个身份证号只能注册一个账号，这是「一人一票」的地基。
    // 用带密钥的摘要做唯一索引，明文身份证号仍然只存密文。
    const idNumberHash = hashIdNumber(idNumber);

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

    let user;
    try {
      user = await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          realName: encrypt(realName),
          idNumber: encrypt(idNumber),
          idNumberHash,
          idCardImages: JSON.stringify(data.idCardImages || []),
          status: "PENDING",
          role: "USER",
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

    return { user: publicUser(user), token };
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
    return { token, user: publicUser(user) };
  }
}
