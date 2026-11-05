import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../utils/prisma";
import { decrypt } from "../../utils/encryption";
import { AppError } from "../../utils/errors";

export interface AdminUserSummary {
  id: string;
  username: string;
  realName: string;
  status: string;
  identityVerificationRef: string | null;
  identityVerifiedAt: Date | null;
  createdAt: Date;
}

export class AdminService {
  async listUsers(): Promise<AdminUserSummary[]> {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        realName: true,
        status: true,
        identityVerificationRef: true,
        identityVerifiedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return users.map((user) => {
      let realName = user.realName;
      try {
        realName = decrypt(user.realName);
      } catch {
        // 兼容历史明文数据
      }
      return {
        id: user.id,
        username: user.username,
        realName,
        status: user.status,
        identityVerificationRef: user.identityVerificationRef,
        identityVerifiedAt: user.identityVerifiedAt,
        createdAt: user.createdAt,
      };
    });
  }

  async resetPassword(id: string): Promise<{ temporaryPassword: string }> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new AppError("用户不存在", 404);
    }

    const temporaryPassword = crypto.randomBytes(6).toString("base64url").slice(0, 10);
    const hashedTemporaryPassword = await bcrypt.hash(temporaryPassword, 10);

    await prisma.user.update({
      where: { id },
      data: { password: hashedTemporaryPassword },
    });

    return { temporaryPassword };
  }
}
