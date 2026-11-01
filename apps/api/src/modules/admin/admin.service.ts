import { prisma } from "../../utils/prisma";

export class AdminService {
  async listPending() {
    const users = await prisma.user.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return users.map((user) => ({
      ...user,
      idCardImages: user.idCardImages ? JSON.parse(user.idCardImages) : [],
    }));
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
