/**
 * 清理历史实名数据（Task 5：历史实名数据清理）。
 *
 * 历史用户（实名审核前）的身份证号与证件照仍残留在库中：
 * - User.idNumber 存密文串（或旧数据），User.idCardImages 存 JSON 数组（可能含 "uploads/xxx.jpg" 或绝对路径）
 * - User.status 可能是旧值 "PENDING"
 *
 * 清理策略：
 * - 解析 idCardImages 的 JSON（容错：非法 JSON 视为空），取 path.basename 去重后删除文件
 * - 清空 idNumber / idCardImages，保留 (identityVerificationRef ?? "legacy") 与 (identityVerifiedAt ?? createdAt)
 * - 迁移旧状态 "PENDING" -> "PENDING_VERIFICATION"
 * - 修正旧投票的 startedAt（原字段名 startAt）
 *
 * 幂等：文件删除带存在性检查与 force 删除；重复执行不会再计数已删文件。
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { prisma } from "../utils/prisma";

export async function cleanupLegacyIdentity(deps: {
  prisma: PrismaClient;
  uploadsDir: string;
}): Promise<{ users: number; files: number }> {
  const { prisma: prismaClient, uploadsDir } = deps;
  const users = await prismaClient.user.findMany();
  let files = 0;

  for (const user of users) {
    // 容错解析：历史值可能是 ["uploads/xxx.jpg"]、绝对路径，或非法 JSON。
    // 统一取 basename 去重后删除，basename 保证不会逃出 uploadsDir。
    const filenames = new Set<string>();
    try {
      const parsed = JSON.parse(user.idCardImages);
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const name = path.basename(String(entry ?? ""));
          if (name) filenames.add(name);
        }
      }
    } catch {
      // 非法 JSON 视为无文件
    }

    for (const filename of filenames) {
      const target = path.join(uploadsDir, filename);
      if (fs.existsSync(target)) {
        fs.rmSync(target, { force: true });
        files += 1;
      }
    }

    await prismaClient.user.update({
      where: { id: user.id },
      data: {
        idNumber: "",
        idCardImages: "[]",
        identityVerificationRef: user.identityVerificationRef ?? "legacy",
        identityVerifiedAt: user.identityVerifiedAt ?? user.createdAt,
      },
    });
  }

  await prismaClient.user.updateMany({
    where: { status: "PENDING" },
    data: { status: "PENDING_VERIFICATION" },
  });

  await prismaClient.$executeRawUnsafe('UPDATE "Vote" SET "startedAt" = "startAt" WHERE "startedAt" IS NULL');

  return { users: users.length, files };
}

async function main() {
  const result = await cleanupLegacyIdentity({
    prisma,
    uploadsDir: path.join(process.cwd(), "uploads"),
  });
  console.log(`已清理历史实名数据：更新用户 ${result.users} 个，删除文件 ${result.files} 个。`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
