import { prisma } from "../../utils/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { encrypt, decrypt } from "../../utils/encryption";

export class AuthService {
  async register(data: {
    username?: string;
    password?: string;
    realName: string;
    idNumber: string;
    idCardImages: string[];
  }) {
    const { password = "password", realName, idNumber, idCardImages } = data;
    const username = data.username || idNumber;

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        realName: encrypt(realName),
        idNumber: encrypt(idNumber),
        idCardImages: JSON.stringify(idCardImages),
        status: "PENDING",
        role: "USER",
      },
    });

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "test-secret-key", {
      expiresIn: "7d",
    });

    return { user, token };
  }

  async login(data: { username: string; password: string }) {
    const user = await prisma.user.findUnique({ where: { username: data.username } });
    if (!user || !(await bcrypt.compare(data.password, user.password))) {
      throw new Error('用户名或密码错误');
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || "test-secret-key", {
      expiresIn: "7d",
    });
    return { token, user: { id: user.id, username: user.username, role: user.role, status: user.status, realName: decrypt(user.realName) } };
  }
}
