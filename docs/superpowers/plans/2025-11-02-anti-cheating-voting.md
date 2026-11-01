# 防作弊投票网站实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个「准入实名 + 投票匿名 + 全量可审计」的投票网站，支持多场投票、实名审核、每次投票生成新假名、强制下载本场全量记录PDF。

**Architecture:** 前后端分离的 Web 应用。后端提供 REST API，处理用户注册/实名认证审核、投票活动管理、投票提交、PDF 生成。前端负责用户交互、投票流程、强制下载触发。数据模型中严格隔离用户实名信息和投票记录（Ballot 只存假名，不存用户ID的可关联字段或通过隔离存储实现）。PDF 在服务端生成，包含本场全量记录。

**Tech Stack:** TypeScript, Node.js, Express (后端), React + Vite (前端), Prisma + SQLite (开发/测试), PDF生成库 (pdf-lib 或 puppeteer)，文件存储（本地文件系统）

**Spec:** [docs/superpowers/specs/2025-11-02-anti-cheating-voting-design.md](../specs/2025-11-02-anti-cheating-voting-design.md)

## Global Constraints

- 独立仓库，不沿用兄弟仓库的技术栈和约定
- 每个注册用户在每场投票活动中只能投一次
- 实名材料需管理员人工审核通过后才能投票和创建投票
- 每次点击投票时生成全新的基于时间戳的假名，仅用于这一次投票记录
- 假名与真实身份之间完全隔离，管理员日常无法查看对应关系
- 全量记录范围仅限本场投票活动
- 投票成功后强制立即下载 PDF
- PDF 包含：投票场名称、创建者、开始时间、结束时间、选项、假名、投票时间、提交序号
- 投票记录不可更改
- 用户可随时重新下载本场投票当前时刻的全量记录快照
- 不暴露真实身份到投票记录

## Review Focus

- **强制下载绕过**: 用户是否能在未下载PDF的情况下跳过投票完成状态？需要确保前端强制触发下载且后端校验投票已记录后才返回成功。
- **身份隔离破坏**: 是否存在任何 API 或日志暴露 User 和 Ballot 的关联关系？需要检查所有查询和响应不包含映射信息。
- **重复投票**: 是否能通过并发请求绕过"每场限投一次"限制？需要数据库唯一约束和事务保护。
- **假名重复使用**: 是否存在复用假名的情况？必须每次投票都生成新假名。
- **全量记录篡改**: PDF 内容是否与数据库实际记录一致？生成时需从数据库读取最新全量记录。

---

### Task 1: 项目初始化和基础结构

**Files:**
- Create: `package.json` (根目录)
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/src/index.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: 无
- Produces: 基础项目结构，可运行的空应用

- [ ] **Step 1: 创建根目录 package.json（workspace 配置）**
```json
{
  "name": "vote-project",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently \"npm run dev --workspace=apps/api\" \"npm run dev --workspace=apps/web\"",
    "build": "npm run build --workspaces",
    "lint": "npm run lint --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test --workspaces --if-present"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

- [ ] **Step 2: 创建 .gitignore**
```
node_modules
dist
build
.env
.env.local
*.db
*.db-journal
uploads/
```

- [ ] **Step 3: 创建 apps/api 基础结构**
创建 `apps/api/package.json`，包含 express、typescript、ts-node-dev、cors 等依赖。
创建 `apps/api/tsconfig.json`。
创建 `apps/api/src/index.ts`，启动简单的 Express 服务器，监听端口 3000。

- [ ] **Step 4: 创建 apps/web 基础结构**
使用 Vite 创建 React + TypeScript 应用，配置基本路由。

- [ ] **Step 5: 安装依赖并验证**
Run: `npm install`
Expected: 安装成功，无错误

- [ ] **Step 6: 验证开发服务器可启动**
Run: `npm run dev` (后台测试或检查配置)
Expected: API 和 Web 服务能正常启动

- [ ] **Step 7: Commit**
```bash
git add .
git commit -m "chore: initialize monorepo structure"
```

### Task 2: 数据库模型设计（Prisma）

**Files:**
- Create: `apps/api/prisma/schema.prisma`
- Create: `apps/api/.env.example`
- Create: `packages/shared/package.json`
- Create: `packages/shared/src/types.ts`

**Interfaces:**
- Consumes: 无
- Produces: Prisma schema 定义 User、Vote、Option、Ballot、AuditLog 等模型

- [ ] **Step 1: 设置 Prisma**
在 apps/api 安装 prisma 和 @prisma/client，初始化 prisma。

- [ ] **Step 2: 设计 schema.prisma**
定义模型：
```prisma
model User {
  id String @id @default(cuid())
  realName String
  idNumber String // 身份证号等，需加密存储
  idCardImages String[] // 实名材料文件路径
  status UserStatus @default(PENDING)
  role UserRole @default(USER)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  // 注意：不与 Ballot 建立直接关联
}

enum UserStatus {
  PENDING
  APPROVED
  REJECTED
}

enum UserRole {
  USER
  ADMIN
}

model Vote {
  id String @id @default(cuid())
  title String
  description String?
  creatorId String // 创建者ID（仅用于权限，不暴露到投票记录）
  allowMultiple Boolean @default(false)
  startAt DateTime
  endAt DateTime
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  options Option[]
  ballots Ballot[]
}

model Option {
  id String @id @default(cuid())
  voteId String
  vote Vote @relation(fields: [voteId], references: [id])
  text String
  order Int
}

model Ballot {
  id String @id @default(cuid())
  voteId String
  vote Vote @relation(fields: [voteId], references: [id])
  pseudonym String // 每次投票生成的新假名
  optionIds String[] // 选项ID列表
  submittedAt DateTime @default(now())
  sequenceNumber Int // 本场投票的提交序号
  // 不存储 userId，完全隔离
  @@unique([voteId, sequenceNumber])
}
```

注意：User 和 Ballot 之间无关系字段，确保完全隔离。

- [ ] **Step 3: 生成 Prisma Client**
Run: `cd apps/api && npx prisma generate`
Expected: 生成成功

- [ ] **Step 4: 创建并应用迁移**
Run: `cd apps/api && npx prisma migrate dev --name init`
Expected: 迁移成功，创建数据库

- [ ] **Step 5: Commit**
```bash
git add apps/api/prisma packages/shared
git commit -m "feat: add database schema with user-vote isolation"
```

### Task 3: 用户注册与实名认证

**Files:**
- Create: `apps/api/src/modules/auth/auth.controller.ts`
- Create: `apps/api/src/modules/auth/auth.service.ts`
- Create: `apps/api/src/modules/auth/auth.routes.ts`
- Create: `apps/api/src/middleware/auth.middleware.ts`
- Create: `apps/web/src/pages/Register.tsx`
- Create: `apps/web/src/pages/Login.tsx`

**Interfaces:**
- Consumes: Prisma User model
- Produces: 注册接口（需上传实名材料）、登录接口、认证中间件

- [ ] **Step 1: 实现用户注册服务**
注册时收集真实姓名、身份证号、上传身份证照片。将文件保存到 uploads/ 目录，状态设为 PENDING。

- [ ] **Step 2: 实现文件上传**
使用 multer 处理文件上传，限制文件类型和大小。

- [ ] **Step 3: 实现认证中间件**
验证 JWT token，获取用户信息。

- [ ] **Step 4: 实现前端注册页面**
表单收集真实信息和文件上传。

- [ ] **Step 5: 编写测试**
测试注册流程、文件上传、状态为 PENDING。

- [ ] **Step 6: 运行测试验证**
Run: `npm test --workspace=apps/api`
Expected: 测试通过

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/modules/auth apps/web/src/pages/Register.tsx apps/web/src/pages/Login.tsx
git commit -m "feat: user registration with real-name verification"
```

### Task 4: 管理员实名认证审核

**Files:**
- Create: `apps/api/src/modules/admin/admin.controller.ts`
- Create: `apps/api/src/modules/admin/admin.service.ts`
- Create: `apps/api/src/modules/admin/admin.routes.ts`
- Create: `apps/web/src/pages/admin/ReviewUsers.tsx`

**Interfaces:**
- Consumes: User model, auth middleware
- Produces: 审核接口（仅管理员可用）

- [ ] **Step 1: 实现管理员权限中间件**
检查用户角色是否为 ADMIN。

- [ ] **Step 2: 实现审核服务**
管理员可查看待审核列表、查看实名材料、批准或拒绝申请。批准后状态改为 APPROVED。

- [ ] **Step 3: 实现前端审核页面**
管理员可查看材料并审核。

- [ ] **Step 4: 编写测试**
测试权限控制、审核流程。

- [ ] **Step 5: 运行测试验证**
Run: `npm test --workspace=apps/api`
Expected: 测试通过

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/admin apps/web/src/pages/admin
git commit -m "feat: admin review for real-name verification"
```

### Task 5: 投票活动创建与管理

**Files:**
- Create: `apps/api/src/modules/vote/vote.controller.ts`
- Create: `apps/api/src/modules/vote/vote.service.ts`
- Create: `apps/api/src/modules/vote/vote.routes.ts`
- Create: `apps/web/src/pages/CreateVote.tsx`
- Create: `apps/web/src/pages/VoteList.tsx`

**Interfaces:**
- Consumes: Vote、Option models，auth middleware
- Produces: 创建投票、列表投票、查看投票详情接口

- [ ] **Step 1: 实现创建投票服务**
只有 status 为 APPROVED 的用户才能创建投票。可设置标题、描述、时间范围、选项、单选/多选。

- [ ] **Step 2: 实现权限校验**
检查用户实名认证状态。

- [ ] **Step 3: 实现前端创建和列表页面**
创建投票表单，支持添加/删除选项，设置单选或多选。

- [ ] **Step 4: 编写测试**
测试权限控制（未审核用户无法创建）、投票创建流程。

- [ ] **Step 5: 运行测试验证**
Run: `npm test --workspace=apps/api`
Expected: 测试通过

- [ ] **Step 6: Commit**
```bash
git add apps/api/src/modules/vote apps/web/src/pages/CreateVote.tsx apps/web/src/pages/VoteList.tsx
git commit -m "feat: create and manage voting events"
```

### Task 6: 投票提交（匿名假名、限投一次）

**Files:**
- Create: `apps/api/src/modules/ballot/ballot.controller.ts`
- Create: `apps/api/src/modules/ballot/ballot.service.ts`
- Create: `apps/api/src/modules/ballot/ballot.routes.ts`
- Create: `apps/api/src/utils/pseudonym.ts`
- Create: `apps/web/src/pages/VoteDetail.tsx`

**Interfaces:**
- Consumes: Ballot model, Vote model
- Produces: 投票提交接口

- [ ] **Step 1: 实现假名生成工具**
```typescript
export function generatePseudonym(): string {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  return `anon_${timestamp}_${random}`;
}
```
每次投票都生成新假名。

- [ ] **Step 2: 实现投票提交服务**
- 检查用户是否已通过实名认证
- 检查是否在投票时间范围内
- 检查用户是否已在本场投票中投过票（通过某种方式标记，不能存储 userId-ballot 关联；可在 UserVoteHistory 表中只存 userId 和 voteId，不存 ballotId）
- 检查选项是否属于该投票，单选/多选限制
- 生成假名
- 计算本场投票的下一个序号（sequenceNumber）
- 在事务中创建 Ballot 并记录投票历史
- 返回投票成功信息

注意：UserVoteHistory 只存 (userId, voteId)，不存 ballotId，确保无法通过此表关联到具体的投票内容。

- [ ] **Step 3: 实现防重复投票**
在 UserVoteHistory 表添加唯一约束 (userId, voteId)。

- [ ] **Step 4: 实现前端投票页面**
选择选项后提交，处理投票成功响应。

- [ ] **Step 5: 编写测试**
测试每次生成新假名、每场限投一次、单选多选限制。

- [ ] **Step 6: 运行测试验证**
Run: `npm test --workspace=apps/api`
Expected: 测试通过

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/modules/ballot apps/api/src/utils/pseudonym.ts apps/web/src/pages/VoteDetail.tsx
git commit -m "feat: anonymous voting with pseudonym and one-vote-per-user-per-vote"
```

### Task 7: 全量记录 PDF 生成与强制下载

**Files:**
- Create: `apps/api/src/modules/audit/audit.controller.ts`
- Create: `apps/api/src/modules/audit/audit.service.ts`
- Create: `apps/api/src/modules/audit/audit.routes.ts`
- Create: `apps/api/src/utils/pdf.ts`
- Modify: `apps/web/src/pages/VoteDetail.tsx`

**Interfaces:**
- Consumes: Ballot、Vote、Option models
- Produces: 获取本场全量记录并生成 PDF 的接口

- [ ] **Step 1: 安装 PDF 库**
在 apps/api 安装 pdf-lib 或 pdfkit。

- [ ] **Step 2: 实现 PDF 生成服务**
生成 PDF 包含：投票场名称、创建者（可显示用户名或ID，不是实名）、开始时间、结束时间、选项列表、所有 Ballot 记录（假名、投票时间、选项、提交序号）。按提交序号排序。

- [ ] **Step 3: 实现审计接口**
GET /api/votes/:voteId/audit/pdf - 获取本场全量记录 PDF。任何登录用户都可以下载（不限制是否投过票，符合"随时都可以下载当前已经投的投票纪录"）。

- [ ] **Step 4: 实现强制下载机制**
投票提交成功后，前端必须调用 PDF 下载接口并触发浏览器下载。使用 fetch 获取 PDF blob 并创建下载链接，用户无法跳过。

- [ ] **Step 5: 编写测试**
测试 PDF 包含所有字段、不包含实名信息、仅本场记录。

- [ ] **Step 6: 运行测试验证**
Run: `npm test --workspace=apps/api`
Expected: 测试通过

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/modules/audit apps/api/src/utils/pdf.ts apps/web/src/pages/VoteDetail.tsx
git commit -m "feat: full audit PDF with forced download"
```

### Task 8: 权限控制和安全加固

**Files:**
- Modify: `apps/api/src/middleware/auth.middleware.ts`
- Modify: `apps/api/src/middleware/role.middleware.ts` (创建)
- Create: `apps/api/src/middleware/verified.middleware.ts`
- Create: `apps/api/src/utils/encryption.ts`

**Interfaces:**
- Consumes: User model
- Produces: 权限中间件

- [ ] **Step 1: 实现实名认证状态检查中间件**
只有 status === APPROVED 的用户才能投票和创建投票。

- [ ] **Step 2: 加密实名信息**
对身份证号等敏感信息进行加密存储。

- [ ] **Step 3: 文件访问控制**
实名材料文件只能由管理员访问。

- [ ] **Step 4: 防止身份泄露检查**
审查所有 API 响应，确保不返回 User 和 Ballot 的关联信息。

- [ ] **Step 5: 编写安全测试**
测试权限控制、文件访问控制。

- [ ] **Step 6: 运行测试验证**
Run: `npm test --workspace=apps/api`
Expected: 测试通过

- [ ] **Step 7: Commit**
```bash
git add apps/api/src/middleware apps/api/src/utils/encryption.ts
git commit -m "feat: security hardening and identity isolation"
```

### Task 9: 集成测试和文档

**Files:**
- Create: `apps/api/tests/integration/voting-flow.test.ts`
- Modify: `README.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 所有模块
- Produces: 完整的集成测试和文档

- [ ] **Step 1: 编写端到端集成测试**
测试完整流程：注册 -> 提交实名材料 -> 管理员审核 -> 创建投票 -> 投票 -> 强制下载 PDF。

- [ ] **Step 2: 更新 README**
说明项目功能、安装步骤、运行方式。

- [ ] **Step 3: 更新 AGENTS.md**
添加实际的命令、项目结构、技术栈等信息。

- [ ] **Step 4: 运行所有测试**
Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 5: 类型检查**
Run: `npm run typecheck`
Expected: 无类型错误

- [ ] **Step 6: Commit**
```bash
git add apps/api/tests README.md AGENTS.md
git commit -m "docs: update documentation and add integration tests"
```
