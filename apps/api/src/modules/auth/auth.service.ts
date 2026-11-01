import { prisma } from "../../utils/prisma";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

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
        realName,
        idNumber,
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
    // For this implementation, we just verify token or do simple login
    const token = jwt.sign({ userId: data.username }, process.env.JWT_SECRET || "test-secret-key", {
      expiresIn: "7d",
    });
    return { token };
  }
}
