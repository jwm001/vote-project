import { prisma } from "../../utils/prisma";
import { decrypt } from "../../utils/encryption";

export class AdminService {
  async listPending() {
    const users = await prisma.user.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return users.map((user) => {
      try {
        return {
          ...user,
          realName: user.realName ? decrypt(user.realName) : user.realName,
          idNumber: user.idNumber ? decrypt(user.idNumber) : user.idNumber,
          idCardImages: user.idCardImages ? JSON.parse(user.idCardImages) : [],
        };
      } catch (e) {
        return {
          ...user,
          idCardImages: user.idCardImages ? JSON.parse(user.idCardImages) : [],
        };
      }
    });
  }

  async approve(id: string) {
    return prisma.user.update({
      where: { id },
      data: { status: "APPROVED" },
    });
  }

  async reject(id: string) {
    return prisma.user.update({
      where: { id },
      data: { status: "REJECTED" },
    });
  }
}
