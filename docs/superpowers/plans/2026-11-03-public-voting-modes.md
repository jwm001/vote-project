# 大众化投票模式改造实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有实名审核投票系统改造成支持「公开链接 / 邀请制」两种模式、二要素实名核验、默认弃权选项、分阶段名单与结果可见性的大众化产品。

**Architecture:** 保持 Express + Prisma + SQLite 后端与 React + Vite 前端。后端新增 `VoteInvite` 模型、投票阶段/可见性纯函数、二要素 provider 抽象；前端按模式与阶段重做创建、邀请、投票、结果页面。身份核验通过 `IdentityProvider` 接口接入，开发环境用 mock，生产用 HTTP 适配器。

**Tech Stack:** TypeScript, Node.js 20, Express, Prisma 5 + SQLite, React 18, Vite 5, pdf-lib, Vitest + Supertest。

**Spec:** [docs/superpowers/specs/2026-11-03-public-voting-modes-design.md](../specs/2026-11-03-public-voting-modes-design.md)

## Global Constraints

- 所有时间以 UTC 存储；API 返回 ISO 字符串。
- `Ballot` 不存 `userId`；一人一号靠 `User.idNumberHash` 唯一索引；每场限投一次靠 `UserVoteHistory @@unique([userId, voteId])`。
- 新注册绝不写入 `idNumber` 或 `idCardImages`；历史数据迁移时清空并删除照片文件。
- 弃权选项固定 `text = "弃权"`、`isAbstain = true`、`order` 最后；创建者不能删除/改名/排序。
- 投票进行中，非创建者/管理员下载的 PDF 不得包含选项文本或票数。
- 审计摘要只在投票 `ENDED` 后首次导出时封存；旧投票的 `canonicalPayload` 公式保持不变。
- 模式 B 的投票详情、名单、结果、PDF 只对受邀者/创建者/管理员开放。
- 保留紫色渐变 + 白色卡片视觉语言；手机端导航用 CSS 媒体查询，不用 `window.innerWidth`。
- 所有业务错误用 `AppError` + `messageOf/statusCodeOf`；不新增裸 `any` 公共接口。
- 每完成一个任务提交一次；提交信息用 `feat:` / `fix:` / `docs:` 前缀。

## Review Focus

- **邀请链接并发/重复使用**：同一 token 被两个人同时接受时只能有一个成功；过期、移除、已结束都要拒绝。
- **模式 B 越权投票**：未接受、已移除、非受邀者、已结束后的提交都必须 403/409，不能只靠前端隐藏按钮。
- **弃权绕过**：服务端必须拒绝「弃权 + 其他选项」和空选择；多选互斥不能只做在 UI。
- **投票期间 PDF 泄露**：非创建者/管理员在 `LIVE` 阶段拿到的 PDF 不能出现选项、票数或可反推的汇总。
- **历史实名残留**：迁移后数据库和 `uploads/` 里不能再有可还原的身份证号/照片；新注册不能重新写入。

---

### Task 1: 测试骨架与应用工厂

**Files:**
- Modify: `apps/api/package.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/test/global-setup.ts`
- Create: `apps/api/src/test/db.ts`
- Create: `apps/api/src/test/factories.ts`
- Create: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Test: `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: 现有 `authRoutes`、`adminRoutes`、`voteRoutes`、`auditRoutes`
- Produces: `createApp(): Express`、`resetDb(): Promise<void>`、`makeUser(username?, status?): Promise<User>`

- [ ] **Step 1: 安装测试依赖**

Run: `npm install --save-dev --workspace=@vote-project/api vitest supertest @types/supertest`

- [ ] **Step 2: 写失败测试**

`apps/api/src/app.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";

describe("app", () => {
  it("GET /health returns ok", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/app.test.ts`
Expected: FAIL，提示找不到 `./app` 或 `vitest` 未配置。

- [ ] **Step 4: 创建应用工厂**

`apps/api/src/app.ts` 导出 `createApp()`：创建 Express 实例，注册 `cors()`、`express.json()`、`/health`、`/api` audit 路由、`/api/auth`、`/api/admin`、`/api/votes`，返回 app。

`apps/api/src/index.ts` 只保留：

```ts
import { createApp } from "./app";
const app = createApp();
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API server running on port ${PORT}`));
```

同时删除旧的 `/uploads/:filename` 路由和 `path` 引用（Task 3 会彻底移除 multer）。

- [ ] **Step 5: 配置 Vitest 与测试数据库**

`apps/api/vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    env: {
      DATABASE_URL: "file:./test.db",
      JWT_SECRET: "test-secret-key",
      ENCRYPTION_KEY: "test-encryption-key",
      ID_HASH_SECRET: "test-id-hash-secret",
      IDENTITY_PROVIDER: "mock",
    },
    fileParallelism: false,
  },
});
```

`apps/api/src/test/global-setup.ts`：删除 `prisma/test.db`，用 `execSync("npx prisma db push --skip-generate --accept-data-loss", { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: "file:./test.db" }, stdio: "inherit" })` 建库。

`apps/api/src/test/db.ts`：

```ts
import { prisma } from "../utils/prisma";

export async function resetDb() {
  await prisma.ballot.deleteMany();
  await prisma.userVoteHistory.deleteMany();
  await prisma.voteInvite.deleteMany();
  await prisma.option.deleteMany();
  await prisma.vote.deleteMany();
  await prisma.user.deleteMany();
}
```

`apps/api/src/test/factories.ts`：

```ts
import { prisma } from "../utils/prisma";

export function makeUser(username = "alice", status = "APPROVED") {
  return prisma.user.create({
    data: { username, password: "x", realName: "enc", status },
  });
}
```

- [ ] **Step 6: 修改 API 脚本并运行测试**

`apps/api/package.json` 的 `scripts.test` 改为 `"vitest run"`，新增 `"test:watch": "vitest"`。

Run: `npm test -w @vote-project/api -- src/app.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/api/package.json apps/api/vitest.config.ts apps/api/src/test apps/api/src/app.ts apps/api/src/index.ts apps/api/src/app.test.ts
git commit -m "test(api): add vitest harness and app factory"
```

---

### Task 2: 数据模型与视图类型

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `packages/shared/src/types.ts`
- Create: `apps/api/src/modules/vote/vote.types.ts`
- Test: `apps/api/src/test/schema.test.ts`

**Interfaces:**
- Consumes: Task 1 的测试库
- Produces: 新 Prisma 模型 `VoteInvite`、`Vote.participationMode/durationMinutes/resultsPublicDuringVote/startedAt/closedAt`、`Option.isAbstain`、`User.identityVerificationRef/identityVerifiedAt`；类型 `ParticipationMode`、`VotePhase`、`InviteStatus`

- [ ] **Step 1: 写失败测试**

`apps/api/src/test/schema.test.ts`：

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../utils/prisma";
import { resetDb } from "./db";
import { makeUser } from "./factories";

beforeEach(resetDb);

describe("schema", () => {
  it("supports mode B invites and abstain options", async () => {
    const user = await makeUser("creator");
    const vote = await prisma.vote.create({
      data: {
        title: "T",
        creatorId: user.id,
        startAt: new Date(),
        endAt: new Date(Date.now() + 3600_000),
        participationMode: "INVITE_ONLY",
        durationMinutes: 60,
      },
    });
    const invite = await prisma.voteInvite.create({
      data: { voteId: vote.id, inviteeUserId: user.id, expiresAt: new Date(Date.now() + 3600_000) },
    });
    const option = await prisma.option.create({
      data: { voteId: vote.id, text: "弃权", order: 0, isAbstain: true },
    });
    expect(vote.participationMode).toBe("INVITE_ONLY");
    expect(invite.status).toBe("INVITED");
    expect(option.isAbstain).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/test/schema.test.ts`
Expected: FAIL，`participationMode` / `voteInvite` / `isAbstain` 不存在。

- [ ] **Step 3: 修改 Prisma schema**

在 `User` 增加：

```prisma
identityVerificationRef String?
identityVerifiedAt      DateTime?
invites                 VoteInvite[]
```

`idNumber` 改为 `@default("")`，`idCardImages` 改为 `@default("[]")`，`status` 默认改为 `"PENDING_VERIFICATION"`。

在 `Vote` 增加：

```prisma
participationMode   String   @default("OPEN_LINK")
durationMinutes     Int?
resultsPublicDuringVote Boolean @default(false)
startedAt           DateTime?
closedAt            DateTime?
invites             VoteInvite[]
```

在 `Option` 增加 `isAbstain Boolean @default(false)`。

新增：

```prisma
model VoteInvite {
  id            String   @id @default(cuid())
  voteId        String
  vote          Vote     @relation(fields: [voteId], references: [id])
  inviteeUserId String?
  invitee       User?    @relation(fields: [inviteeUserId], references: [id])
  token         String?  @unique
  status        String   @default("INVITED")
  acceptedAt    DateTime?
  removedAt     DateTime?
  expiresAt     DateTime?
  createdAt     DateTime @default(now())

  @@unique([voteId, inviteeUserId])
  @@index([voteId])
}
```

- [ ] **Step 4: 同步开发库并生成客户端**

Run: `cd apps/api && npx prisma db push`
Expected: 成功，`dev.db` 增加新列/表。

- [ ] **Step 5: 更新类型**

`packages/shared/src/types.ts`（目前没有被任何 app 引用，只做同步，不要新增 workspace 依赖）：把 `UserStatus` 改为 `PENDING_VERIFICATION | APPROVED | REJECTED`。

在 `apps/web/src/types.ts` 新建前端视图类型（前端直接使用）：

```ts
export type ParticipationMode = "OPEN_LINK" | "INVITE_ONLY";
export type VotePhase = "DRAFT" | "LIVE" | "ENDED";
export type InviteStatus = "INVITED" | "ACCEPTED" | "REMOVED" | "EXPIRED";

export interface VoteOptionView {
  id: string;
  text: string;
  order: number;
  isAbstain: boolean;
}

export interface VoteDetailView {
  id: string;
  title: string;
  description: string | null;
  participationMode: ParticipationMode;
  phase: VotePhase;
  allowMultiple: boolean;
  resultsPublicDuringVote: boolean;
  startAt: string;
  endAt: string;
  options: VoteOptionView[];
  votedCount: number;
  eligibleCount: number | null;
  hasVoted: boolean;
  canVote: boolean;
  isInvitee: boolean;
  isCreator: boolean;
}

export interface ResultOptionView {
  id: string;
  text: string;
  isAbstain: boolean;
  count: number;
  percent: number;
}

export interface ResultsView {
  visible: boolean;
  totalBallots: number;
  options: ResultOptionView[];
  winner: string | null;
  note: string | null;
  votedCount: number;
  eligibleCount: number | null;
}

export interface RosterEntryView {
  name: string | null;
  status?: InviteStatus;
  voted?: boolean;
}

export interface RosterView {
  visible: boolean;
  mode: "MASKED" | "FULL" | "COUNT_ONLY";
  entries: RosterEntryView[];
  votedCount: number;
  eligibleCount: number | null;
}
```

`apps/api/src/modules/vote/vote.types.ts` 定义后端 union 与 API 输入类型：

```ts
export type ParticipationMode = "OPEN_LINK" | "INVITE_ONLY";
export type VotePhase = "DRAFT" | "LIVE" | "ENDED";

export interface VoteViewer {
  id: string;
  role: string;
  status: string;
}

export interface CreateVoteInput {
  creatorId: string;
  title: string;
  description?: string;
  allowMultiple: boolean;
  participationMode: ParticipationMode;
  resultsPublicDuringVote?: boolean;
  endAt?: Date;
  durationMinutes?: number;
  options: string[];
}
```

- [ ] **Step 6: 运行测试**

Run: `npm test -w @vote-project/api -- src/test/schema.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/api/prisma/schema.prisma packages/shared/src/types.ts apps/api/src/modules/vote/vote.types.ts apps/web/src/types.ts apps/api/src/test/schema.test.ts
git commit -m "feat(api): add vote modes and invite schema"
```

---

### Task 3: 二要素核验与注册

**Files:**
- Create: `apps/api/src/modules/identity/identity.provider.ts`
- Create: `apps/api/src/modules/identity/mock.provider.ts`
- Create: `apps/api/src/modules/identity/http.provider.ts`
- Create: `apps/api/src/utils/rate-limit.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.routes.ts`
- Modify: `apps/api/package.json`（移除 multer）
- Test: `apps/api/src/modules/auth/auth.service.test.ts`
- Test: `apps/api/src/modules/identity/identity.provider.test.ts`

**Interfaces:**
- Consumes: `hashIdNumber`、`normalizeIdNumber`、`prisma`、`AppError`
- Produces: `IdentityProvider`、`getIdentityProvider()`、`checkRateLimit(key, limit?, windowMs?)`、`resetRateLimits()`、`AuthService(provider?: IdentityProvider)`、`AuthService.reverifyIdentity()`、`toPublicUser(user)`

- [ ] **Step 1: 写失败测试**

`identity.provider.test.ts` 断言：

- `getIdentityProvider()` 在 `IDENTITY_PROVIDER=mock` 时返回 mock；
- mock 对默认白名单 `110101199001011234` 返回 `{ ok: true }`；
- mock 对 `110101199001011235` 或 `123` 返回 `{ ok: false }`（需要先清掉 `MOCK_ID_NUMBERS` 环境变量，避免测试机配置干扰）。

`auth.service.test.ts` 用三个 stub provider：

```ts
const okProvider = { verify: async () => ({ ok: true, reference: "ref-1" }) };
const badProvider = { verify: async () => ({ ok: false, reason: "mismatch" }) };
const downProvider = { verify: async () => { throw new Error("timeout"); } };
```

在 `beforeEach` 里调用 `resetDb()` 和 `resetRateLimits()`，否则限流测试会污染其他用例。

断言：

```ts
const { user } = await new AuthService(okProvider as any).register({
  username: "alice", password: "secret1", realName: "张三",
  idNumber: "110101199001011234", ip: "1.1.1.1",
});
expect(user.status).toBe("APPROVED");
const saved = await prisma.user.findUniqueOrThrow({ where: { username: "alice" } });
expect(saved.idNumber).toBe("");
expect(saved.idCardImages).toBe("[]");
expect(saved.idNumberHash).toHaveLength(64);
expect(saved.identityVerificationRef).toBe("ref-1");
```

另断言：

- `badProvider` 注册抛 400，用户数为 0；
- `downProvider` 注册得到 `PENDING_VERIFICATION`，`identityVerifiedAt` 为 null；
- 同一身份证号第二次注册抛 409；
- 同一 IP 第 6 次注册抛 429；
- `PENDING_VERIFICATION` 用户调用 `reverifyIdentity`：provider 成功 → `APPROVED` 且写入 ref/时间；provider 失败 → 抛 400 且仍是 `PENDING_VERIFICATION`；provider 抛错 → 抛 503；
- 已 `APPROVED` 用户调用 `reverifyIdentity` 抛 409；
- `toPublicUser(saved)` 不含 `idNumber`、`idCardImages`、`password`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/auth/auth.service.test.ts src/modules/identity/identity.provider.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现 provider 与限流**

`identity.provider.ts`：

```ts
export interface IdentityInput { realName: string; idNumber: string; }
export interface IdentityResult {
  ok: boolean;
  reference?: string;
  unavailable?: boolean;
  reason?: string;
}
export interface IdentityProvider {
  verify(input: IdentityInput): Promise<IdentityResult>;
}
export function getIdentityProvider(): IdentityProvider;
```

`getIdentityProvider()` 按 `IDENTITY_PROVIDER` 选择：`mock` → mock，`http` → http。未设置时：`NODE_ENV === "production"` 直接抛错（不允许生产环境静默用 mock），否则默认 mock。

`mock.provider.ts`：从 `MOCK_ID_NUMBERS`（逗号分隔）读取允许通过的身份证号，默认只有 `110101199001011234`。命中白名单返回 `reference: "mock:" + hashIdNumber(idNumber).slice(0, 16)`；否则 `{ ok: false, reason: "mock_rejected" }`。本地要测多用户时在 `apps/api/.env` 里追加更多测试号。

`http.provider.ts`：读取 `IDENTITY_API_URL`、`IDENTITY_API_KEY`，`fetch` POST `{ realName, idNumber }`，8 秒超时；非 2xx 抛错，让 AuthService 走「服务不可用」分支；2xx 解析 `{ ok, reference, reason }`。

`rate-limit.ts`：

```ts
export function checkRateLimit(key: string, limit = 5, windowMs = 3_600_000, now = Date.now()): boolean;
export function resetRateLimits(): void;
```

- [ ] **Step 4: 改注册流程**

`AuthService` 构造函数接受可选 provider：

```ts
constructor(private readonly identityProvider: IdentityProvider = getIdentityProvider()) {}
```

`register` 输入改为 `{ username?, password?, realName, idNumber, ip? }`：

1. 校验用户名、密码 ≥ 6、姓名、身份证号格式、用户名 ≠ 身份证号。
2. `checkRateLimit("register:" + (ip ?? "unknown"))`，超限抛 429。
3. 检查 `idNumberHash` 和 `username` 唯一。
4. `await provider.verify(...)`；provider 抛错时视为 `{ unavailable: true }`。
5. `unavailable` → `status = PENDING_VERIFICATION`；`!ok` → 抛 400「实名信息核验未通过」；`ok` → `APPROVED`，写 `identityVerificationRef`、`identityVerifiedAt`。
6. 写入 `idNumber: ""`、`idCardImages: "[]"`，不接收文件。
7. 返回 `{ user: toPublicUser(user), token }`。

`reverifyIdentity(userId, { realName, idNumber, ip })`：

1. 取用户；`status !== "PENDING_VERIFICATION"` → 409。
2. 重新 `normalizeIdNumber`、`hashIdNumber`；若该摘要已被其他用户占用 → 409。
3. 校验格式；`checkRateLimit("reverify:" + (ip ?? "unknown"))`，超限抛 429。
4. provider 成功 → `update({ status: "APPROVED", idNumberHash, identityVerificationRef, identityVerifiedAt })`，返回 `{ user: toPublicUser(updated) }`。
5. provider 返回 `ok: false` → 抛 400，保持 `PENDING_VERIFICATION`。
6. provider 抛错 → 抛 503「实名核验服务暂不可用，请稍后重试」，保持 `PENDING_VERIFICATION`。

导出 `toPublicUser`，返回 `id, username, status, role, realName, identityVerifiedAt`。

- [ ] **Step 5: 改路由/控制器并移除 multer**

- `auth.routes.ts` 删除 multer 相关 import 与 `upload.array`，改为 `router.post("/register", authController.register.bind(authController))`。
- `auth.controller.ts` 的 `register` 从 `req.body` 取字段，传 `ip: req.ip`。
- 新增 `auth.controller.ts` 的 `reverify`，路由 `router.post("/reverify", authMiddleware, ...)`。
- `me` 直接返回 `{ user: toPublicUser(req.user) }`。
- 从 `apps/api/package.json` 移除 `multer`、`@types/multer`，Run: `npm uninstall -w @vote-project/api multer @types/multer`。

- [ ] **Step 6: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/auth/auth.service.test.ts src/modules/identity/identity.provider.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/modules/identity apps/api/src/utils/rate-limit.ts apps/api/src/modules/auth apps/api/package.json
git commit -m "feat(api): verify identity at registration and stop storing id documents"
```

---

### Task 4: 修改密码与管理员用户列表

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.routes.ts`
- Modify: `apps/api/src/modules/admin/admin.service.ts`
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Modify: `apps/api/src/modules/admin/admin.routes.ts`
- Test: `apps/api/src/modules/admin/admin.service.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `AuthService`、`prisma`
- Produces: `AuthService.changePassword(userId, currentPassword, newPassword)`、`AdminService.listUsers()`、`AdminService.resetPassword(id)`

- [ ] **Step 1: 写失败测试**

`admin.service.test.ts` 断言：

- `listUsers()` 返回的每项不含 `idNumber`、`idCardImages`；
- `resetPassword(user.id)` 返回 `{ temporaryPassword }`，用该密码 `auth.login` 成功；
- `changePassword` 当前密码错误抛 400；正确后旧密码登录失败、新密码登录成功。

测试用户用 `prisma.user.create({ data: { ..., password: await bcrypt.hash("oldpass", 10) } })` 创建，不要用 `makeUser` 里那个占位密码。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/admin/admin.service.test.ts`
Expected: FAIL，方法不存在。

- [ ] **Step 3: 实现服务与路由**

`AuthService.changePassword`：`bcrypt.compare` 当前密码，`bcrypt.hash` 新密码（≥6），更新。

`AdminService`：

```ts
async listUsers(): Promise<Array<{
  id: string; username: string; realName: string; status: string;
  identityVerificationRef: string | null; identityVerifiedAt: Date | null; createdAt: Date;
}>>;
async resetPassword(id: string): Promise<{ temporaryPassword: string }>;
```

`listUsers` 只 `select` 上述字段；`realName` 用 `decrypt`，失败时保留原值。`resetPassword` 用 `crypto.randomBytes(6).toString("base64url").slice(0, 10)` 生成临时密码，`bcrypt.hash` 后更新。

路由改为：

- `POST /api/auth/change-password`（`authMiddleware`）
- `GET /api/admin/users`（`authMiddleware` + `adminMiddleware`）
- `POST /api/admin/users/:id/reset-password`（同上）

删除 `/pending`、`/:id/approve`、`/:id/reject` 路由与 service 方法。

- [ ] **Step 4: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/admin/admin.service.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/auth apps/api/src/modules/admin
git commit -m "feat(api): add password change and admin user list"
```

---

### Task 5: 历史实名数据清理

**Files:**
- Create: `apps/api/src/scripts/cleanup-legacy-identity.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/src/scripts/cleanup-legacy-identity.test.ts`

**Interfaces:**
- Consumes: `prisma`、`decrypt`、`fs`
- Produces: `cleanupLegacyIdentity(deps: { prisma: PrismaClient; uploadsDir: string }): Promise<{ users: number; files: number }>`

- [ ] **Step 1: 写失败测试**

测试创建用户：

```ts
const user = await prisma.user.create({
  data: {
    username: "legacy", password: "x", realName: "enc",
    idNumber: "encrypted-id", idCardImages: JSON.stringify(["a.jpg"]),
    status: "APPROVED",
  },
});
fs.writeFileSync(path.join(uploadsDir, "a.jpg"), "x");
const result = await cleanupLegacyIdentity({ prisma, uploadsDir });
expect(result.files).toBe(1);
expect(fs.existsSync(path.join(uploadsDir, "a.jpg"))).toBe(false);
const saved = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
expect(saved.idNumber).toBe("");
expect(saved.idCardImages).toBe("[]");
expect(saved.identityVerificationRef).toBe("legacy");
expect(saved.identityVerifiedAt).toEqual(saved.createdAt);
```

另断言 `status: "PENDING"` 的老用户被改成 `PENDING_VERIFICATION`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/scripts/cleanup-legacy-identity.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现清理函数与脚本入口**

`cleanupLegacyIdentity`：

1. `findMany` 所有用户，解析 `idCardImages`。历史值可能是 `["uploads/xxx.jpg"]` 或绝对路径，统一取 `path.basename` 后去重。
2. 对每个文件名，`fs.rmSync(path.join(uploadsDir, filename), { force: true })`，计数已删除的文件。
3. `update` 用户：`idNumber: ""`、`idCardImages: "[]"`、`identityVerificationRef: user.identityVerificationRef ?? "legacy"`、`identityVerifiedAt: user.identityVerifiedAt ?? user.createdAt`。
4. `prisma.user.updateMany({ where: { status: "PENDING" }, data: { status: "PENDING_VERIFICATION" } })`。
5. `prisma.$executeRawUnsafe('UPDATE "Vote" SET "startedAt" = "startAt" WHERE "startedAt" IS NULL')`，让老投票在详情里显示正确阶段。
6. 返回 `{ users, files }`。

脚本入口用真实 `prisma` 和 `path.join(process.cwd(), "uploads")`，打印统计。

`apps/api/package.json` 增加：

```json
"cleanup:identity": "ts-node --transpile-only src/scripts/cleanup-legacy-identity.ts"
```

- [ ] **Step 4: 运行测试并执行一次**

Run: `npm test -w @vote-project/api -- src/scripts/cleanup-legacy-identity.test.ts`
Expected: PASS。

Run: `npm run cleanup:identity -w @vote-project/api`
Expected: 打印清理的用户/文件数；`apps/api/uploads/` 不再有身份证照片。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/scripts/cleanup-legacy-identity.ts apps/api/src/scripts/cleanup-legacy-identity.test.ts apps/api/package.json
git commit -m "feat(api): clean legacy identity documents"
```

---

### Task 6: 投票创建、弃权、编辑与删除

**Files:**
- Modify: `apps/api/src/modules/vote/vote.service.ts`
- Modify: `apps/api/src/modules/vote/vote.controller.ts`
- Modify: `apps/api/src/modules/vote/vote.routes.ts`
- Create: `apps/api/src/modules/vote/vote.constants.ts`
- Test: `apps/api/src/modules/vote/vote.create.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `CreateVoteInput`、`ParticipationMode`
- Produces: `createVote(input)`、`updateVote(id, creatorId, input)`、`deleteVote(id, creatorId)`、`endVote(id, creatorId)`、`ABSTAIN_TEXT`

- [ ] **Step 1: 写失败测试**

`vote.create.test.ts` 断言：

```ts
const creator = await makeUser("creator");
const vote = await service.createVote({
  creatorId: creator.id, title: "T", participationMode: "OPEN_LINK",
  endAt: new Date(Date.now() + 86_400_000), options: ["A", "B"],
});
const options = await prisma.option.findMany({ where: { voteId: vote.id }, orderBy: { order: "asc" } });
expect(options.map(o => o.text)).toEqual(["A", "B", "弃权"]);
expect(options[2].isAbstain).toBe(true);
expect(vote.startedAt).not.toBeNull();
```

另断言：

- 模式 B 创建得到 `startedAt = null`、`durationMinutes` 保存、`endAt ≈ now + duration`；
- 选项少于 2、重复、含「弃权」、超过 50 个都抛 400；
- 模式 A 缺 `endAt`、模式 B 缺 `durationMinutes` 抛 400；
- 模式 A 首票前可 `updateVote`，弃权仍排最后；首票后 `updateVote` 抛 409；
- 模式 B `startedAt` 为空时可 `updateVote`；`startVote` 后抛 409；
- 首票前 `deleteVote` 删除成功且相关行清空；首票后抛 409。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.create.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现创建与校验**

`vote.constants.ts`：

```ts
export const ABSTAIN_TEXT = "弃权";
export const MAX_OPTIONS = 50;
export const MAX_OPTION_LENGTH = 300;
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 43_200;
```

`createVote`：

- 标题非空。
- 选项 trim、2..50、非空、≤300、去重、不得等于 `ABSTAIN_TEXT`。
- 模式 A：`endAt` 必须是未来时间；`startAt = now`、`startedAt = now`、`durationMinutes = null`。
- 模式 B：`durationMinutes` 为 1..43200 的整数；`startAt = now`、`endAt = now + duration`、`startedAt = null`。
- 创建用户选项（`isAbstain: false`），再创建弃权选项（`order = options.length`、`isAbstain: true`）。
- `resultsPublicDuringVote` 默认 false。

- [ ] **Step 4: 实现编辑/删除/结束**

`assertCreator(voteId, creatorId)` 取 vote 并校验；从 `vote.service.ts` 导出，供邀请服务复用。

`updateVote` 允许改：标题、描述、`allowMultiple`、`resultsPublicDuringVote`、模式 A 的 `endAt`、模式 B 的 `durationMinutes`、选项。禁止改 `participationMode`。

可编辑条件：模式 A 无 ballot；模式 B `startedAt === null`。选项更新用事务：删除非弃权选项，重建用户选项 + 弃权选项。

`deleteVote` 条件同上；事务按 `ballot`、`userVoteHistory`、`voteInvite`、`option`、`vote` 顺序删除。

`endVote`：创建者、`phase === LIVE`，写 `closedAt = now`；`DRAFT` 抛 409「请先开始投票」。

- [ ] **Step 5: 接路由/控制器**

新增：

- `PATCH /api/votes/:id`（auth + verified）
- `DELETE /api/votes/:id`（auth + verified）
- `POST /api/votes/:id/end`（auth + verified）

控制器从 `req.body` 取字段；错误用 `statusCodeOf/messageOf`。

- [ ] **Step 6: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.create.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/modules/vote
git commit -m "feat(api): create votes with modes, abstain and lifecycle rules"
```

---

### Task 7: 投票阶段与详情

**Files:**
- Create: `apps/api/src/modules/vote/vote.phase.ts`
- Modify: `apps/api/src/modules/vote/vote.service.ts`
- Modify: `apps/api/src/modules/vote/vote.controller.ts`
- Modify: `apps/api/src/modules/vote/vote.routes.ts`
- Test: `apps/api/src/modules/vote/vote.phase.test.ts`
- Test: `apps/api/src/modules/vote/vote.detail.test.ts`

**Interfaces:**
- Consumes: Task 2/6 的 `Vote` 字段与 service
- Produces: `getVotePhase(vote, now?)`、`getVoteById(id, viewer)`、`getMyVotes(userId)`

- [ ] **Step 1: 写失败测试**

`vote.phase.test.ts`：

```ts
expect(getVotePhase({ participationMode: "INVITE_ONLY", startedAt: null, endAt: future, closedAt: null })).toBe("DRAFT");
expect(getVotePhase({ participationMode: "INVITE_ONLY", startedAt: past, endAt: future, closedAt: null })).toBe("LIVE");
expect(getVotePhase({ participationMode: "OPEN_LINK", startedAt: past, endAt: past, closedAt: null })).toBe("ENDED");
expect(getVotePhase({ participationMode: "OPEN_LINK", startedAt: past, endAt: future, closedAt: past })).toBe("ENDED");
```

`vote.detail.test.ts` 断言：

- 模式 A 创建者对详情 `isCreator = true`、`canVote = true`、`phase = "LIVE"`；
- 已投票用户 `hasVoted = true`、`canVote = false`；
- 模式 B 非受邀者 `getVoteById` 抛 403；
- 模式 B 受邀但未接受 `isInvitee = true`、`canVote = false`；
- 模式 B 接受后 `canVote = true`；
- `getMyVotes` 同时返回创建的和参与过的，且 `relation` 分别为 `"CREATOR"` / `"PARTICIPANT"`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.phase.test.ts src/modules/vote/vote.detail.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现阶段函数**

`vote.phase.ts` 按 spec 的状态机返回 `DRAFT | LIVE | ENDED`。

- [ ] **Step 4: 实现详情与我的投票**

`getVoteById(id, viewer)`：

1. 取 vote + options + `_count.ballots`。
2. 模式 B：查 viewer 的 invite（`status != "REMOVED"`）；没有且不是创建者/管理员 → 抛 403「你不在本场受邀名单中」。
3. 计算 `phase`、`votedCount`、`eligibleCount`（模式 B：`count({ where: { voteId, status: { not: "REMOVED" } } })`）、`hasVoted`、`isInvitee`、`isCreator`、`canVote`。
4. `canVote = phase === "LIVE" && !hasVoted && (mode A ? viewer.status === "APPROVED" : invite?.status === "ACCEPTED")`。
5. 返回 `{ vote: { ...vote, phase, votedCount, eligibleCount, hasVoted, isInvitee, isCreator, canVote } }`，不返回票数分布。

`getMyVotes(userId)`：

- 取创建的 votes 和参与的 histories（含 vote）。
- 合并为 `relation: "CREATOR" | "PARTICIPANT"`，每项含 `voteId, voteTitle, participationMode, phase, allowMultiple, startAt, endAt, votedCount, eligibleCount`；参与过的额外含 `pseudonym, submittedAt, sequenceNumber`。

- [ ] **Step 5: 改路由**

- `GET /api/votes/:id` 加 `authMiddleware`。
- 删除 `GET /api/votes` 列表路由与 `getVotes()`（避免泄露模式 B 标题）。
- 保留 `GET /api/votes/my/votes`，放在 `/:id` 之前。

- [ ] **Step 6: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.phase.test.ts src/modules/vote/vote.detail.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/modules/vote
git commit -m "feat(api): expose vote phase and viewer-specific detail"
```

---

### Task 8: 邀请创建、接受、移除与开始

**Files:**
- Create: `apps/api/src/modules/vote/invite.service.ts`
- Create: `apps/api/src/modules/vote/invite.controller.ts`
- Modify: `apps/api/src/modules/vote/vote.routes.ts`
- Test: `apps/api/src/modules/vote/invite.service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `VoteInvite`、Task 6 的 `assertCreator`、Task 7 的 `getVotePhase`
- Produces: `createUsernameInvites`、`createLinkInvites`、`listInvites`、`removeInvite`、`getInviteByToken`、`acceptInvite`、`acceptInviteById`、`getMyInvites`、`startVote`

- [ ] **Step 1: 写失败测试**

`invite.service.test.ts` 断言：

- 按用户名邀请：命中 1 人、`notFound` 返回不存在的用户名、重复邀请进 `duplicates`；
- 用户名邀请没有过期时间（`expiresAt = null`），一天后仍能接受；
- 移除后用同一用户名重新邀请能成功（`duplicates` 不含它）；
- 生成 2 个链接：token 互不相同、`expiresAt ≈ now + 7 天`；
- `acceptInvite` 把 token 邀请绑定到用户，`status = "ACCEPTED"`；
- `acceptInviteById` 让用户接受自己的用户名邀请；
- 接受别人的用户名邀请（inviteId 不属于自己）抛 404；
- 同一 token 第二个用户接受抛 409；
- 过期 token 接受抛 410；
- 模式 B 开始后 `createUsernameInvites` 抛 409；
- `startVote` 把 `startedAt/startAt` 设为当前、`endAt ≈ now + durationMinutes`，phase 变 `LIVE`；
- 没有已接受受邀人时 `startVote` 抛 409；
- `removeInvite` 在 DRAFT 可移除任意；LIVE 只能移除未投票者；ENDED 抛 409；
- `getMyInvites` 返回待接受邀请。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/vote/invite.service.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现邀请服务**

- `assertModeB(vote)`、`assertDraft(vote)`、`assertCreator(voteId, creatorId)`。
- `createUsernameInvites(voteId, creatorId, usernames)`：
  - `assertModeB` + `assertDraft` + 创建者；
  - trim、去重、1..200；
  - `findMany({ where: { username: { in: usernames } } })`，未命中的进 `notFound`；
  - 对已存在且 `status != "REMOVED"` 的邀请进 `duplicates`；
  - 对其余用户用 `upsert`（`where: { voteId_inviteeUserId: { voteId, inviteeUserId } }`）：不存在则创建，存在（已 REMOVED）则重置 `status = "INVITED"`、`acceptedAt = null`、`removedAt = null`、`expiresAt = null`；
  - 返回 `{ created, notFound, duplicates }`。
- `createLinkInvites(voteId, creatorId, count)`：
  - `assertModeB` + `assertDraft` + 创建者；
  - count 1..200；
  - `token = crypto.randomBytes(24).toString("hex")`；
  - `expiresAt = now + 7d`；
  - 返回 `{ links: [{ id, token, url: `/invite/${token}` }] }`。
- `listInvites(voteId, viewer)`：创建者/管理员；返回 `{ id, username, realName, status, acceptedAt, expiresAt, voted }`；未绑定用户的链接邀请 `username = null`、`realName = null`；`status` 只在 `expiresAt` 非空且已过期时显示 `EXPIRED`；`voted` 用 `UserVoteHistory` 判断。
- `removeInvite(voteId, inviteId, creatorId)`：按阶段规则更新 `status = "REMOVED"`、`removedAt = now`。
- `getInviteByToken(token)`：不存在/REMOVED/已过期分别 404/410；`expiresAt` 为 null 视为不过期；返回 `{ voteId, title, phase, expiresAt, accepted }`，不含实名。
- `acceptInvite(token, user)`：
  - 校验 token、过期（仅 `expiresAt` 非空时）、REMOVED、vote ENDED；
  - 若已绑定其他用户 → 409；
  - 若该用户已有同场邀请（非 REMOVED）→ 把 token 邀请标 REMOVED，返回已有邀请；
  - 否则更新 `inviteeUserId/status/acceptedAt`；如果该用户在该场有一条 REMOVED 记录，先删掉它或把它并入当前 token 行，避免撞 `@@unique([voteId, inviteeUserId])`。
- `acceptInviteById(inviteId, user)`：只允许 `inviteeUserId === user.id`、`status = "INVITED"`、vote 未结束；设置 `ACCEPTED`、`acceptedAt = now`；已接受则幂等返回。找不到/不是自己的抛 404。
- `getMyInvites(userId)`：查 `inviteeUserId = userId` 且 `status != REMOVED`，返回 `inviteId`、投票标题、创建者用户名、状态、阶段、过期时间（可能为 null）。
- `startVote(voteId, creatorId)`：模式 B + DRAFT + 创建者；至少 1 条 `status = "ACCEPTED"` 的邀请，否则 409「至少需要一位已接受的受邀人」；写 `startedAt/startAt/endAt`（`endAt = now + durationMinutes`）。

- [ ] **Step 4: 接路由/控制器**

- `POST /api/votes/:id/invites/usernames`
- `POST /api/votes/:id/invites/links`
- `GET /api/votes/:id/invites`
- `DELETE /api/votes/:id/invites/:inviteId`
- `POST /api/votes/:id/start`
- `GET /api/votes/my/invites`（放在 `/:id` 之前）
- `POST /api/votes/my/invites/:inviteId/accept`（auth + verified，放在 `/:id` 之前）
- `GET /api/invites/:token`（公开）
- `POST /api/invites/:token/accept`（auth + verified）

`/api/invites` 可以继续挂在 `vote.routes.ts` 下，或用独立 `invite.routes.ts`；保持路径不变即可。

- [ ] **Step 5: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/vote/invite.service.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/modules/vote
git commit -m "feat(api): add invite-only roster and invite lifecycle"
```

---

### Task 9: 投票提交、弃权互斥与自动结束

**Files:**
- Modify: `apps/api/src/modules/vote/vote.service.ts`
- Test: `apps/api/src/modules/vote/vote.submit.test.ts`

**Interfaces:**
- Consumes: Task 6/7/8 的阶段、邀请、弃权选项
- Produces: `submitVote({ userId, voteId, optionIds })` 新规则

- [ ] **Step 1: 写失败测试**

`vote.submit.test.ts` 断言：

- 模式 A `LIVE` 提交成功，`Ballot.optionIds` 是 JSON 数组；
- 未开始/已结束/已提前结束抛 409；
- 模式 B 非受邀者、`INVITED` 未接受者抛 403；`ACCEPTED` 成功；
- 弃权单独提交成功；弃权 + 其他选项抛 400；多选弃权单独提交成功；
- 全部选项都不选（空数组）抛 400；
- 重复提交抛 409；
- 模式 B 所有「已绑定用户且未移除」的邀请人都投票后 `Vote.closedAt` 被写入；
- 只投了已接受者、但仍有未接受的用户名邀请时，不自动结束；
- 两人并发提交，`sequenceNumber` 分别为 1、2（允许重试，但最终都成功）。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.submit.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改提交规则**

`submitVote`：

1. 取 vote + options + invites。
2. `phase = getVotePhase(vote)`；非 `LIVE` 抛 409。
3. 模式 B：查 `voteInvite` 且 `status = "ACCEPTED"`；没有抛 403「请先接受邀请或不在名单中」。
4. 选项校验：非空、无重复、都属于本场。
5. 找到 `abstain = options.find(o => o.isAbstain)`：
   - 选中弃权且 `optionIds.length > 1` → 400「弃权不能与其他选项同时选择」；
   - 单选且 `length !== 1` → 400。
6. 保留现有事务 + 序号重试逻辑，写 `Ballot` 和 `UserVoteHistory`。
7. 模式 B 事务成功后调用 `maybeAutoEnd(voteId)`：
   - 取 `status != "REMOVED"` 且 `inviteeUserId != null` 的邀请（未接受的一人一链接不参与）；
   - 这些用户里至少 1 人，且全部已有 `UserVoteHistory`；
   - 满足时 `updateMany({ where: { id: voteId, closedAt: null }, data: { closedAt: now } })`。
   - 未接受的用户名邀请会阻塞自动结束，这是故意的：创建者要么催办，要么移除。

- [ ] **Step 4: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.submit.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/api/src/modules/vote
git commit -m "feat(api): enforce invite eligibility, abstain rules and auto-end"
```

---

### Task 10: 结果与名单可见性

**Files:**
- Create: `apps/api/src/modules/vote/vote.results.ts`
- Create: `apps/api/src/utils/names.ts`
- Modify: `apps/api/src/modules/vote/vote.service.ts`
- Modify: `apps/api/src/modules/vote/vote.controller.ts`
- Modify: `apps/api/src/modules/vote/vote.routes.ts`
- Test: `apps/api/src/modules/vote/vote.results.test.ts`

**Interfaces:**
- Consumes: Task 7 `getVotePhase`、Task 8 invites
- Produces: `maskRealName(name)`、`aggregateResults(options, ballots)`、`getResults(voteId, viewer)`、`getRoster(voteId, viewer)`

- [ ] **Step 1: 写失败测试**

断言：

- `maskRealName("张三") === "张*"`、`maskRealName("欧阳娜娜") === "欧*娜"`、`maskRealName("李") === "*"`；
- `aggregateResults`：A=2、B=1、弃权=1 → total 4，百分比 50%/25%/25%，winner 是 A 的文本；
- 弃权=3、A=1 → winner null，note「弃权最多，未形成多数」；
- 弃权=2、A=2 → winner null，note「平票」；
- A=2、B=2 → winner null，note「平票」；
- 只有弃权票 → winner null，note「弃权最多，未形成多数」；
- 模式 A 进行中普通用户 `getResults` 返回 `visible: false`；
- 模式 A 结束后登录用户 `visible: true`；
- 模式 B 非受邀者 `getResults` 抛 403；
- 模式 B 受邀者在 `DRAFT` 或 `LIVE`（未开启实时结果）返回 `visible: false`，不是 403；
- 模式 B 受邀者结束后 `visible: true`；
- 模式 A 进行中 `getRoster` 返回 `visible: false`；结束后返回 `mode: "MASKED"` 且只有已投票者；
- 模式 B 结束后名单 `mode: "FULL"`、包含未投票的人、条目不含 `voted` 字段；
- 模式 B 进行中创建者名单带 `voted`，普通受邀者只拿到 `COUNT_ONLY`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.results.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现纯函数**

`maskRealName`：长度 1 → `*`；长度 2 → 首字 + `*`；长度 ≥3 → 首字 + `*` + 末字。

`aggregateResults(options, ballots)`：

- 统计每个 option 出现次数（多选时一票可计多个选项）。
- `totalBallots = ballots.length`；`percent = count / totalBallots * 100`，保留 1 位小数；多选时百分比合计可以 >100。
- `winner` 存获胜选项的 `text`，不是 id。
- `abstainCount = 弃权选项计数`、`topNonAbstain = 非弃权选项的最高票`、`topOptions = 达到最高票的非弃权选项`。
- `totalBallots === 0` → winner null + 「暂无投票」。
- `abstainCount > topNonAbstain` 或 `topNonAbstain === 0` → winner null + 「弃权最多，未形成多数」。
- `abstainCount === topNonAbstain`（且 >0）或 `topOptions.length > 1` → winner null + 「平票」。
- 否则 winner = 唯一最高票非弃权选项的 `text`，note = null。

- [ ] **Step 4: 实现结果/名单服务**

`getResults(voteId, viewer)`：

- 取 vote、ballots、viewer 的 history/invite。
- `isCreatorOrAdmin`、`isInvitee`、`isParticipant`。
- 可见性：
  - 模式 A：`isCreatorOrAdmin || resultsPublicDuringVote || (phase === "ENDED" && viewer.status === "APPROVED")`；否则 `{ visible: false, votedCount, eligibleCount }`。
  - 模式 B：非创建者/管理员且不是受邀者 → 抛 403；受邀者在 `DRAFT` 或 `LIVE` 且未开启实时结果 → `{ visible: false, votedCount, eligibleCount }`；`ENDED` 或 `resultsPublicDuringVote` → 可见。
- 可见时返回 `{ visible: true, totalBallots, options, winner, note, votedCount, eligibleCount }`。

`getRoster(voteId, viewer)`：

- 模式 A：`ENDED` → `MASKED`，取 `UserVoteHistory` 关联 user.realName，`decrypt` 后 `maskRealName`；否则 `COUNT_ONLY`。
- 模式 B：
  - 非创建者/管理员且无 invite → 403。
  - `DRAFT` → `FULL`，返回所有 `status != REMOVED` 的邀请（`name` 用解密后的 realName；未绑定用户的链接邀请 `name = null`；`status` 对过期显示 `EXPIRED`）。
  - `LIVE` → 创建者/管理员返回 `FULL` + `voted`；受邀者返回 `COUNT_ONLY`。
  - `ENDED` → `FULL`，包含所有 `status != REMOVED` 的邀请，不返回 `voted` 字段。

- [ ] **Step 5: 接路由**

- `GET /api/votes/:id/results`（auth）
- `GET /api/votes/:id/roster`（auth）

放在 `/:id` 之前或之后均可，但必须在 `/:id` 之前注册更具体的路径。

- [ ] **Step 6: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/vote/vote.results.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add apps/api/src/modules/vote apps/api/src/utils/names.ts
git commit -m "feat(api): add staged results and roster visibility"
```

---

### Task 11: PDF 隐藏选项与访问控制

**Files:**
- Modify: `apps/api/src/modules/audit/audit.service.ts`
- Test: `apps/api/src/modules/audit/audit.service.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `participationMode/startedAt/closedAt`、Task 7 `getVotePhase`、Task 8 invites
- Produces: `shouldRedactOptions(vote, requester)`、`generateAuditPdf(voteId, requester)` 新行为

- [ ] **Step 1: 写失败测试**

`audit.service.test.ts` 断言：

- `shouldRedactOptions`：LIVE + 普通参与者 → true；LIVE + 创建者 → false；LIVE + 管理员 → false；ENDED → false。
- 模式 A 进行中参与过的人可下载；未参与的人 403；结束后任何 `APPROVED` 用户可下载。
- 模式 B 非受邀者结束后仍 403；`ACCEPTED` 受邀者结束后可下载；`LIVE` 中已投票的受邀者可下载（返回 `redacted: true`）。
- 提前结束（`closedAt` 有值）后第一次导出：`integrity === "sealed"`，数据库 `auditHash` 非空。
- 旧投票的 `canonicalPayload` 不变：构造一个已封存摘要的老投票，导出后 `integrity === "match"`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -w @vote-project/api -- src/modules/audit/audit.service.test.ts`
Expected: FAIL，`shouldRedactOptions` 不存在或访问规则不符。

- [ ] **Step 3: 改访问控制**

`assertCanAccess(voteId, requester)`：

- 取 vote + phase。
- 管理员/创建者：允许。
- 参与过（`UserVoteHistory` 存在）：允许。
- 模式 A：`phase === "ENDED"` 且 `status === "APPROVED"`：允许。
- 模式 B：`phase === "ENDED"` 且存在 `ACCEPTED` invite：允许；`LIVE` 且已投票且存在 `ACCEPTED` invite：允许。
- 其他 403。

- [ ] **Step 4: 改 PDF 渲染**

- `shouldRedactOptions(vote, requester)`：`phase === "LIVE" && requester.role !== "ADMIN" && requester.id !== vote.creatorId`。
- `generateAuditPdf` 计算 `redactOptions`，传给 `renderPdf`。
- `renderPdf` 在 `redactOptions` 为 true 时：
  - 不输出 `Options` 明细和 `Summary` 票数；
  - 写 `Options: hidden until the vote ends`；
  - `Records` 行的选项列写 `(hidden)`。
- 摘要封存条件从 `new Date() < vote.endAt` 改为 `phase !== "ENDED"`（提前结束也能封存）。
- 不修改 `canonicalPayload` 的字段集合/顺序，避免老投票 `auditHash` 失效。

- [ ] **Step 5: 运行测试**

Run: `npm test -w @vote-project/api -- src/modules/audit/audit.service.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/src/modules/audit
git commit -m "feat(api): redact live audit PDFs and scope access by mode"
```

---

### Task 12: 前端骨架、响应式导航与路由

**Files:**
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/App.css`
- Create: `apps/web/src/components/ShareCard.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/index.css`
- Delete: `apps/web/src/pages/VoteList.tsx`

**Interfaces:**
- Consumes: 现有页面
- Produces: `api.get/post/patch/delete/download`、`ApiError`、响应式导航类名

- [ ] **Step 1: 写 API 客户端**

`apps/web/src/api.ts`：

```ts
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  const headers = new Headers(init.headers);
  if (!init.body || typeof init.body === "string") headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `请求失败（${res.status}）`, res.status);
  }
  return res.json();
}

async function download(path: string, filename: string) {
  const token = localStorage.getItem("token");
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error || `下载失败（${res.status}）`, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  download,
};
```

- [ ] **Step 2: 重写导航**

`App.tsx`：

- 用 `useState` 控制菜单，CSS 类 `.nav`、`.nav-toggle`、`.nav-links`、`.nav-user`。
- 删除 `window.innerWidth` 判断。
- 链接：`/` 首页、`/my-votes` 我的投票、`/my-invites` 我的邀请、`/create` 创建投票（APPROVED）、`/admin/users` 管理员；登录后用户名链接到 `/account`。
- 删除「投票列表」链接与 `/votes` 路由。
- 登录状态显示 `user.username`（不再直接显示 `realName`）。
- 保留 `/login`、`/register`、`/my-votes`、`/create`、`/vote/:id`。
- 删除 `AdminReview` import 与路由。

- [ ] **Step 3: CSS**

`App.css` 定义导航布局：

```css
.nav { position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,.98); ... }
.nav-inner { max-width: 1100px; margin: 0 auto; display: flex; ... }
.nav-toggle { display: none; }
@media (max-width: 768px) {
  .nav-toggle { display: block; }
  .nav-links { display: none; width: 100%; flex-direction: column; }
  .nav-links--open { display: flex; }
}
```

`index.css` 保留紫色渐变背景、输入/按钮样式，补充 `.card`、`.page-title`、`.pill`、`.error` 等通用类。

- [ ] **Step 4: 删除旧列表页**

删除 `apps/web/src/pages/VoteList.tsx`；确认没有 import 残留。

- [ ] **Step 4b: 分享卡片（复制链接 + 二维码）**

Run: `npm install --workspace=@vote-project/web qrcode.react`

`apps/web/src/components/ShareCard.tsx`：

```tsx
import { QRCodeSVG } from "qrcode.react";
import { useState } from "react";

export default function ShareCard({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const fullUrl = new URL(url, window.location.origin).toString();
  return (
    <div className="share-card">
      <QRCodeSVG value={fullUrl} size={160} />
      <input readOnly value={fullUrl} onFocus={(e) => e.currentTarget.select()} />
      <button type="button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(fullUrl);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* 老浏览器不支持时用户可手动全选复制 */
        }
      }}>{copied ? "已复制" : "复制链接"}</button>
    </div>
  );
}
```

- [ ] **Step 5: 验证**

Run: `npm run typecheck -w @vote-project/web`
Expected: PASS（若新导航引用了尚未创建的页面，先只在导航里放已有页面）。

Run: `npm run build -w @vote-project/web`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/api.ts apps/web/src/App.css apps/web/src/App.tsx apps/web/src/index.css apps/web/src/components/ShareCard.tsx apps/web/package.json package-lock.json
git rm apps/web/src/pages/VoteList.tsx
git commit -m "feat(web): add api client and responsive navigation"
```

---

### Task 13: 注册、登录与修改密码页

**Files:**
- Modify: `apps/web/src/pages/Register.tsx`
- Modify: `apps/web/src/pages/Login.tsx`
- Create: `apps/web/src/pages/Account.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Task 12 `api`、Task 3/4 后端接口
- Produces: `/account` 页面

- [ ] **Step 1: 改注册页**

- 表单字段：用户名、密码、真实姓名、身份证号、同意核验勾选框。
- 删除照片上传与 `FormData`，改用 `api.post("/api/auth/register", { ... })`。
- 支持 `?invite=<token>`：注册成功后跳 `/invite/<token>`；支持 `?redirect=<path>`：注册成功后跳该路径；否则跳 `/login`。
- 核验通过：提示「注册成功，请登录」；`PENDING_VERIFICATION`：提示「实名核验服务暂不可用，账号已创建，稍后可重试」，并带 token 直接进 `/account` 重验。
- 错误用页面内 `.error`，不用 `alert`。

- [ ] **Step 2: 改登录页**

- 读取 `?redirect=`，登录成功跳转该路径（默认 `/`）。
- 支持从邀请落地页带 `redirect=/invite/<token>`。
- 错误内联显示。

- [ ] **Step 3: 新增修改密码页**

`Account.tsx`：

- 显示当前用户名、实名核验状态、核验时间。
- 当前密码、新密码（≥6）、确认新密码；调用 `POST /api/auth/change-password`；成功提示并清空。
- 未通过核验（`PENDING_VERIFICATION`）时显示「重新核验」表单：真实姓名、身份证号，调用 `POST /api/auth/reverify`；成功后刷新页面状态，失败内联显示原因。

- [ ] **Step 4: 加路由**

`App.tsx` 增加 `<Route path="/account" element={<Account />} />`。

- [ ] **Step 5: 验证**

Run: `npm run typecheck -w @vote-project/web`
Expected: PASS。

Run: `npm run build -w @vote-project/web`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/pages/Register.tsx apps/web/src/pages/Login.tsx apps/web/src/pages/Account.tsx apps/web/src/App.tsx
git commit -m "feat(web): registration, login redirect and password change"
```

---

### Task 14: 首页改版

**Files:**
- Modify: `apps/web/src/pages/Home.tsx`
- Create: `apps/web/src/pages/Home.css`

**Interfaces:**
- Consumes: `Link`
- Produces: 首页第一屏入口

- [ ] **Step 1: 重写首页**

第一屏：

- 标题「发起或参与一场投票」。
- 主按钮：`创建投票`（`/create`）、`我的投票`（`/my-votes`）、`我的邀请`（`/my-invites`）。
- 未登录时显示 `登录` / `注册`。

第二屏保留三张卡片，文案改为：

- 实名核验：注册时在线核验姓名与身份证号。
- 投票匿名：投票记录不含实名，每次投票生成新假名。
- 全量可审计：投票结束后可下载全量记录并校验摘要。

删除「浏览投票」入口。

- [ ] **Step 2: 样式**

`Home.css` 用现有紫色渐变 + 白色卡片；移动端按钮纵向排列。

- [ ] **Step 3: 验证**

Run: `npm run typecheck -w @vote-project/web`
Expected: PASS。

Run: `npm run build -w @vote-project/web`
Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add apps/web/src/pages/Home.tsx apps/web/src/pages/Home.css
git commit -m "feat(web): make home a voting entry point"
```

---

### Task 15: 创建投票页

**Files:**
- Modify: `apps/web/src/pages/CreateVote.tsx`
- Modify: `apps/web/src/pages/CreateVote.css`

**Interfaces:**
- Consumes: `api.post("/api/votes", payload)`
- Produces: 模式 A/B 创建表单

- [ ] **Step 1: 改表单状态**

```ts
interface FormState {
  title: string;
  description: string;
  allowMultiple: boolean;
  participationMode: "OPEN_LINK" | "INVITE_ONLY";
  resultsPublicDuringVote: boolean;
  endAt: string;              // 模式 A
  durationValue: number;      // 模式 B
  durationUnit: "hours" | "days";
  options: string[];
}
```

- 模式 A 显示结束时间；模式 B 显示时长（小时/天）。
- 显示「实时公开结果」开关，默认关闭，附说明「开始后不可更改」。
- 选项区末尾固定展示只读「弃权」行，标注「系统自动添加」。
- 预览区显示模式、时间/时长、弃权选项。

- [ ] **Step 2: 提交**

- 模式 A payload：`{ title, description, allowMultiple, participationMode, resultsPublicDuringVote, endAt: new Date(endAt).toISOString(), options }`。
- 模式 B payload：`{ ..., durationMinutes: durationValue * (unit === "hours" ? 60 : 1440), options }`。
- 成功后跳 `/vote/${data.vote.id}`；模式 B 在详情页继续邀请。

- [ ] **Step 3: 校验**

- 标题必填、选项 ≥2、去重、不得输入「弃权」、模式 A 结束时间晚于现在、模式 B 时长 >0。
- 错误内联显示，不用 `alert`。

- [ ] **Step 4: 验证**

Run: `npm run typecheck -w @vote-project/web`
Expected: PASS。

Run: `npm run build -w @vote-project/web`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/CreateVote.tsx apps/web/src/pages/CreateVote.css
git commit -m "feat(web): create votes with modes and abstain option"
```

---

### Task 16: 邀请落地页与我的邀请

**Files:**
- Create: `apps/web/src/pages/InviteLanding.tsx`
- Create: `apps/web/src/pages/MyInvites.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: `GET /api/invites/:token`、`POST /api/invites/:token/accept`、`GET /api/votes/my/invites`、`POST /api/votes/my/invites/:inviteId/accept`
- Produces: `/invite/:token`、`/my-invites`

- [ ] **Step 1: 邀请落地页**

- 读取 `useParams` token，调用 `api.get`。
- 显示投票标题、过期时间、状态。
- 未登录：显示「登录后接受」和「注册并接受」，链接带 `redirect=/invite/<token>`；注册链接带 `invite=<token>`。
- 已登录：显示「接受邀请」按钮；成功后跳 `/vote/<voteId>`。
- token 无效/过期/已使用：显示明确文案和返回首页入口。

- [ ] **Step 2: 我的邀请页**

- 未登录提示登录。
- 列表显示投票标题、创建者用户名、状态（待接受/已接受/已过期）、过期时间（用户名邀请显示「不过期」）。
- 待接受项提供「接受」按钮，调用 `POST /api/votes/my/invites/:inviteId/accept`，成功后跳投票详情。
- 空状态文案。

- [ ] **Step 3: 路由**

`App.tsx` 增加：

```tsx
<Route path="/invite/:token" element={<InviteLanding />} />
<Route path="/my-invites" element={<MyInvites />} />
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck -w @vote-project/web`
Expected: PASS。

Run: `npm run build -w @vote-project/web`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/pages/InviteLanding.tsx apps/web/src/pages/MyInvites.tsx apps/web/src/App.tsx
git commit -m "feat(web): add invite landing and my invites pages"
```

---

### Task 17: 投票详情（参与者）

**Files:**
- Modify: `apps/web/src/pages/VoteDetail.tsx`
- Create: `apps/web/src/pages/VoteDetail.css`
- Create: `apps/web/src/components/ResultsPanel.tsx`
- Create: `apps/web/src/components/RosterPanel.tsx`
- Modify: `apps/web/src/App.tsx`（如需要）

**Interfaces:**
- Consumes: `GET /api/votes/:id`、`POST /submit`、`GET /results`、`GET /roster`、`api.download`
- Produces: 阶段感知的投票详情

- [ ] **Step 1: 详情页状态**

请求 `GET /api/votes/:id`，根据 `phase/participationMode/isInvitee/canVote/hasVoted/votedCount/eligibleCount` 渲染：

- `DRAFT`（模式 B）：显示「等待发起人开始」，受邀者显示名单，创建者显示邀请面板入口。
- `LIVE`：模式 B 非受邀者显示「你不在受邀名单」；受邀未接受显示「接受邀请」；可投显示选项。
- `ENDED`：显示结果面板、名单面板、完整 PDF 下载。
- 详情接口返回 401 时跳 `/login?redirect=/vote/<id>`；403（模式 B 非受邀者）显示「你不在本场受邀名单中」和返回首页入口。
- 模式 A 在标题下方显示 `ShareCard url={`/vote/${id}`}`，方便创建者/参与者转发；模式 B 不显示公开分享卡。

- [ ] **Step 2: 投票交互**

- 单选：选中一个选项。
- 多选：普通选项可多选；选中弃权时清空其他；选中其他时清空弃权。
- 未选或未登录时禁用提交。
- 提交成功后：
  1. 立即 `api.download('/api/votes/:id/audit/pdf', 'audit-<id>.pdf')`（投票期间后端返回隐藏选项版）。
  2. 重新拉详情，显示「已投 N/M」。
- 提交失败内联显示错误。

- [ ] **Step 3: 结果与名单组件**

`ResultsPanel`：`visible=false` 时只显示人数；可见时显示每个选项票数、百分比、弃权行、winner/note。

`RosterPanel`：`visible=false` 时只显示人数；`MASKED` 显示脱敏姓名；`FULL` 显示实名，若有 `voted` 字段则显示已投/未投。

- [ ] **Step 4: 强制下载**

投票成功后必须触发下载；如果下载失败，显示「PDF 下载失败，请重试」按钮，不阻止投票成功状态。

- [ ] **Step 5: 验证**

Run: `npm run typecheck -w @vote-project/web`
Expected: PASS。

Run: `npm run build -w @vote-project/web`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/pages/VoteDetail.tsx apps/web/src/pages/VoteDetail.css apps/web/src/components
git commit -m "feat(web): phase-aware vote detail with forced audit download"
```

---

### Task 18: 创建者面板、我的投票与管理员用户页

**Files:**
- Create: `apps/web/src/components/InvitePanel.tsx`
- Modify: `apps/web/src/pages/VoteDetail.tsx`
- Modify: `apps/web/src/pages/MyVotes.tsx`
- Create: `apps/web/src/pages/admin/AdminUsers.tsx`
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/pages/AdminReview.tsx`
- Delete: `apps/web/src/pages/admin/ReviewUsers.tsx`

**Interfaces:**
- Consumes: Task 8/10 后端接口、Task 4 管理员接口
- Produces: 创建者邀请管理、重置密码 UI

- [ ] **Step 1: 创建者面板**

`InvitePanel`（仅创建者、模式 B；`DRAFT` 可邀请，`LIVE` 只能查看/移除）：

- 输入框粘贴多个用户名（逗号/换行分隔），调用 `POST /invites/usernames`，展示 `notFound`/`duplicates`。
- 「生成一人一链接」数量输入，调用 `POST /invites/links`，列出可复制链接。
- 名单列表：姓名、用户名、状态、已投/未投（DRAFT/LIVE 创建者可见），移除按钮。
- 「开始投票」按钮：显示 `已接受 N/M`，调用 `POST /start`；`DRAFT` 之外隐藏邀请输入。
- 进行中显示「提前结束」按钮，调用 `POST /end`。
- 复制链接按钮；二维码直接复用 Task 12 的 `ShareCard`。模式 A 在详情页展示 `<ShareCard url={`/vote/${id}`} />`；模式 B 的每个一人一链接也各自显示二维码。
- 在 `VoteDetail.tsx` 里，当 `isCreator && participationMode === "INVITE_ONLY"` 时渲染 `<InvitePanel voteId={id} phase={phase} />`。

- [ ] **Step 2: 改我的投票页**

- 使用 `GET /api/votes/my/votes` 的新结构。
- 分为「我创建的」和「我参与的」两组。
- 每项显示模式、阶段、已投/应投人数、创建者/参与者标识。
- 参与过的保留假名、序号、PDF 下载；创建的点进详情管理。
- 删除「浏览投票」链接。

- [ ] **Step 3: 管理员用户页**

`AdminUsers.tsx`：

- `GET /api/admin/users` 列表：用户名、姓名、状态、核验时间、注册时间。
- 「重置密码」按钮，调用 `POST /api/admin/users/:id/reset-password`，弹窗展示一次性临时密码。
- 删除审核通过/拒绝按钮与照片展示。

- [ ] **Step 4: 路由与删除旧页**

- `App.tsx` 增加 `<Route path="/admin/users" element={<AdminUsers />} />`。
- 删除 `AdminReview.tsx`、`admin/ReviewUsers.tsx` 及相关 import。

- [ ] **Step 5: 验证**

Run: `npm run typecheck -w @vote-project/web`
Expected: PASS。

Run: `npm run build -w @vote-project/web`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/web/src/components/InvitePanel.tsx apps/web/src/pages/VoteDetail.tsx apps/web/src/pages/MyVotes.tsx apps/web/src/pages/admin/AdminUsers.tsx apps/web/src/App.tsx
git rm apps/web/src/pages/AdminReview.tsx apps/web/src/pages/admin/ReviewUsers.tsx
git commit -m "feat(web): creator invite panel, my votes and admin users"
```

---

### Task 19: 文档与最终验证

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Optionally modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: 全部任务
- Produces: 与新行为一致的文档与验证记录

- [ ] **Step 1: 更新文档**

README/AGENTS 需要写清：

- 两种模式与时间语义。
- 二要素核验、`PENDING_VERIFICATION`、不再存身份证号/照片。
- 名单可见性矩阵与模式 B 的隐私边界。
- 弃权计票规则。
- PDF 投票期间隐藏选项、结束后完整版。
- 管理员只剩用户列表 + 重置密码。
- 已知限制：PDF 中文字体、数据库层可关联、模式 B 小名单推断风险。

`apps/api/.env.example` 增加：

```env
IDENTITY_PROVIDER="mock"
MOCK_ID_NUMBERS="110101199001011234"
# 生产：
# IDENTITY_PROVIDER="http"
# IDENTITY_API_URL=""
# IDENTITY_API_KEY=""
```

同时把 `ENCRYPTION_KEY`、`ID_HASH_SECRET`、`JWT_SECRET` 写进 `.env.example`，并注明 `ID_HASH_SECRET` 一旦上线不可更换。

- [ ] **Step 2: 跑全部测试**

Run: `npm test`
Expected: 所有 workspace 测试通过。

- [ ] **Step 3: 跑类型检查与构建**

Run: `npm run typecheck`
Expected: 退出码 0。

Run: `npm run build`
Expected: 退出码 0。

- [ ] **Step 4: 手动端到端清单**

启动 `npm run dev` 后逐项验证：

1. 注册新用户（mock 身份证）→ 状态 `APPROVED`，无需人工审核。先在 `apps/api/.env` 配至少两个 `MOCK_ID_NUMBERS`，方便后面测两个人投票。
2. 创建模式 A 投票 → 选项末尾有只读「弃权」，分享链接可打开。
3. 第二个用户登录投票（选弃权）→ 强制下载 PDF；PDF 中看不到选项/票数；页面只显示「已投 N 人」。
4. 创建者结束投票 → 结果分布出现、名单为脱敏实名、可下载完整 PDF。
5. 创建模式 B 投票 → 按用户名邀请 + 生成链接；对方在「我的邀请」接受；页面显示 `N/M 已接受`。
6. 创建者点「开始」→ 只有名单内 `ACCEPTED` 用户能投；非受邀者打开 `/vote/:id` 得到 403 文案。
7. 名单内所有人投完 → 自动结束；名单显示完整实名，但不标注谁没投。
8. 管理员打开 `/admin/users` → 可重置密码；旧审核页不存在。
9. 检查 `apps/api/uploads/` 无身份证照片，数据库 `idNumber` 为空字符串、`idCardImages` 为 `[]`。
10. 手机宽度下导航折叠正常，不依赖 `window.innerWidth`。

- [ ] **Step 5: 提交**

```bash
git add README.md AGENTS.md apps/api/.env.example
git commit -m "docs: describe public voting modes and identity verification"
```

---

## 执行顺序与依赖

- Task 1 → 2 → 3 → 4 → 5 是后端地基。
- Task 6 → 7 → 8 → 9 → 10 → 11 是投票核心，必须按序。
- Task 12 → 13/14/15/16/17/18 是前端，可在后端接口稳定后并行，但建议按序减少返工。
- Task 19 最后执行。

## 完成定义

- 所有任务复选框完成，`npm test`、`npm run typecheck`、`npm run build` 全绿。
- 手动端到端清单 10 项全部通过。
- 没有新增实名信息落库路径；旧实名材料已清理。
- 模式 A/B 的可见性矩阵与 spec 一致。
