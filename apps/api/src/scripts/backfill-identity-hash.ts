/**
 * 为历史用户回填 User.idNumberHash（身份证号 HMAC 摘要）。
 *
 * 用法（在仓库根目录）：
 *   npm run backfill:identity -w @vote-project/api -- --dry-run
 *   npm run backfill:identity -w @vote-project/api
 *
 * 该脚本是幂等的：已有 idNumberHash 的用户会被跳过。
 * 如果发现多个账号使用同一个身份证号，脚本不会替它们决定归属，
 * 而是列出冲突并返回非零退出码，由管理员人工处理。
 */
import { prisma } from "../utils/prisma";
import { decrypt } from "../utils/encryption";
import { hashIdNumber, normalizeIdNumber } from "../utils/identity";

type Candidate = {
  id: string;
  username: string;
  hash: string;
  idNumber: string;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      idNumber: true,
      idNumberHash: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`共 ${users.length} 个用户，其中 ${users.filter((u) => u.idNumberHash).length} 个已有摘要。`);

  const skipped: { id: string; reason: string }[] = [];
  const candidates: Candidate[] = [];

  for (const user of users) {
    if (user.idNumberHash) continue;

    let plain: string;
    try {
      plain = decrypt(user.idNumber);
    } catch {
      skipped.push({ id: user.id, reason: "身份证号解密失败" });
      continue;
    }

    const normalized = normalizeIdNumber(plain);
    if (!normalized) {
      skipped.push({ id: user.id, reason: "身份证号为空" });
      continue;
    }

    candidates.push({
      id: user.id,
      username: user.username,
      hash: hashIdNumber(normalized),
      idNumber: normalized,
    });
  }

  const byHash = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = byHash.get(candidate.hash) ?? [];
    group.push(candidate);
    byHash.set(candidate.hash, group);
  }

  const conflicts = [...byHash.values()].filter((group) => group.length > 1);
  const unique = [...byHash.values()].filter((group) => group.length === 1).map((group) => group[0]);

  for (const group of conflicts) {
    console.error(
      `⚠️ 身份证号重复（未回填）：${group.map((u) => `${u.username}(${u.id})`).join(", ")}`
    );
  }

  if (!dryRun) {
    for (const candidate of unique) {
      await prisma.user.updateMany({
        where: { id: candidate.id, idNumberHash: null },
        data: { idNumberHash: candidate.hash },
      });
    }
  }

  console.log(
    `${dryRun ? "[dry-run] 将回填" : "已回填"} ${unique.length} 个用户；跳过 ${skipped.length} 个，冲突 ${conflicts.length} 组。`
  );
  for (const item of skipped) {
    console.error(`⚠️ 跳过 ${item.id}：${item.reason}`);
  }

  if (conflicts.length > 0 || skipped.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
