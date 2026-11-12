# AGENTS.md

## 项目

大众化防作弊投票站：实名准入 + 匿名投票 + 全量可审计，支持 `OPEN_LINK`（公开链接）与 `INVITE_ONLY`（邀请制）两种模式。
产品规则看 `README.md`；验收口径看 `docs/superpowers/specs/2026-11-03-public-voting-modes-design.md`。

## 技术栈与工作区

- npm workspaces：`apps/api`（Express + TS + Prisma + SQLite，CommonJS），`apps/web`（React + Vite，ESM）。
- `packages/shared` 目前没有任何代码引用，且 `main`/`types` 指向不存在的 `src/index.ts`；不要从这里 import。
- `docs/superpowers/*/2025-*` 是历史产物（提到已删除的 multer / 照片审核），不要当作现状。

## 命令（根目录执行）

| 命令 | 用途 |
|---|---|
| `npm install` | 安装所有 workspace 依赖 |
| `cd apps/api && npx prisma generate` | 生成 Prisma Client（install scripts 被拦截后必须手动跑） |
| `cd apps/api && npx prisma db push` | 同步本地 schema（`prisma/migrations` 不完整，不要用 `migrate deploy`） |
| `npm run dev` | 同时启动 API :3000 与 Web :5173 |
| `npm test` | 全部测试（实际只跑 `apps/api`，Web 没有测试） |
| `npm run test -w @vote-project/api -- src/modules/vote/vote.phase.test.ts` | 只跑单个测试文件 |
| `npm run typecheck` | 所有 workspace 类型检查 |
| `npm run build` | 构建所有 workspace |
| `npm run lint` | 当前各 workspace 都是 `echo 'no lint configured'`，没有真正的 lint |
| `npm run backfill:identity -w @vote-project/api -- --dry-run` | 为历史用户回填身份证摘要（幂等） |
| `npm run cleanup:identity -w @vote-project/api` | 清理历史实名材料并迁移旧状态；必须先 backfill 再 cleanup |

改完代码按 `npm test` → `npm run typecheck` → `npm run build` 验证。

## 数据库与测试

- 若 npm 拦截 install scripts，Prisma Client 不会生成，测试会报 `Cannot read properties of undefined (reading 'deleteMany')`；先执行 `cd apps/api && npx prisma generate`。
- `apps/api/.env` 由 Prisma Client 自动加载；`dev.db`、`test.db`、`.env`、`uploads/` 都被 gitignore，`uploads/` 应保持为空。
- Vitest 配置固定了测试环境变量；global setup 每次删除并重建 `apps/api/prisma/test.db`。
- `fileParallelism: false`，但所有测试文件共享同一个库；测试前用 `apps/api/src/test/db.ts` 的 `resetDb()`，仍偶有跨文件污染，改测试数据时注意隔离。

## 本地默认值

- 未设置时：`JWT_SECRET=test-secret-key`、`ENCRYPTION_KEY=test-encryption-key`、`ID_HASH_SECRET` 回退到 `ENCRYPTION_KEY`。
- 非 production 且未设 `IDENTITY_PROVIDER` 时用 mock；mock 白名单默认只有 `110101199001011234`，用 `MOCK_ID_NUMBERS` 覆盖。production 未设置会直接拒绝启动。
- `ID_HASH_SECRET` 一旦有真实账号就不能更换，否则一人一号去重失效。

## 入口与模块

- `apps/api/src/index.ts` → `app.ts`；路由挂载：`/api`（审计 PDF）、`/api/auth`、`/api/admin`、`/api/votes`、`/api/invites`。
- `GET /api/votes/hall` 是投票大厅列表，仅 `APPROVED` 可访问；路由必须留在 `/:id` 之前。
- `modules/vote/` 同时负责阶段、邀请、提交、结果/名单；没有独立的 `ballot` 模块。
- 改路由时保留 `/my/*` 在 `/:id` 之前（`vote.routes.ts` 有注释）。
- Web 路由集中在 `apps/web/src/App.tsx`，API 调用封装在 `apps/web/src/api.ts`。
- 领域类型目前在 `apps/web/src/types.ts` 与 API 模块类型中，不在 `packages/shared`。

## 不能破坏的领域约定

- 阶段不落库，一律用 `getVotePhase` 推导（`DRAFT` / `LIVE` / `ENDED`）；模式 B 只要 `startedAt === null` 就是 `DRAFT`，忽略占位 `endAt`；前端不自行推断。所有时间使用 UTC。
- `Ballot` 不存 `userId`，只存 `pseudonym`；一人一票靠 `UserVoteHistory` 的 `(userId, voteId)` 唯一约束与 `ballotSequenceNumber`。不要合并或暴露这层关联，也不要宣称「连 DBA 都无法关联」。
- 弃权是系统 `Option`（`isAbstain`），固定最后，计一票且进入百分比分母，与其它选项互斥，必须显式选择。
- 只有 `status === 'APPROVED'` 可创建投票和投票；`role` 只有 `USER` / `ADMIN`；管理员页面仅 `/admin/users` 只读列表 + 重置密码，不做自助找回。
- 模式 A：创建即 `LIVE`，固定 `endAt`，创建者可提前结束。
- 模式 B：创建为 `DRAFT`；用户名邀请不过期，一人一链接 7 天 / 单次 / 可撤销且 token 只展示一次；`start` 后不能新增受邀人，已投票者不能移除；所有非 `REMOVED` 的已绑定受邀人投完自动结束（未接受的用户名邀请阻塞，未接受链接不阻塞）；创建者也要被邀请才能投。
- 名单：A 进行中不可见（含创建者），结束后登录用户可见「已投票者 + 脱敏姓名」。B `DRAFT` 受邀者 / 创建者见完整名单与接受状态；`LIVE` 创建者 / 管理员见谁已投，其他受邀者只见人数；`ENDED` 受邀者 / 创建者 / 管理员见完整实名，但不标投票状态。
- 大厅：仅 `listedInHall` 且 `OPEN_LINK` 且 `LIVE` 的投票出现，按 `createdAt` 倒序、最多 200 条；仅 `APPROVED` 可访问；不展示任何投票者信息；邀请制不能进大厅（服务端 400）；开关创建后不可改。
- 结果：`resultsPublicDuringVote` 默认关且开始后不可改；不可见时只显示「已投 N / M」。模式 A 进行中仅创建者 / 管理员可见，结束后对 `APPROVED` 用户开放；模式 B 进行中仅创建者 / 管理员可见，结束后对本场受邀者 / 创建者 / 管理员开放。
- PDF：提交后强制下载本场全量记录；进行中非创建者 / 管理员看到脱敏版；结束后首次导出写入 `Vote.auditHash`，之后标注 `MATCH` / `MISMATCH`。访问：创建者 / 管理员 / 本场参与者随时；模式 B 已接受受邀者在 `LIVE` / `ENDED` 可下；模式 A 结束后其他 `APPROVED` 用户可下；模式 B 非受邀者不可下。
- 实名：注册同步核验，失败不建号，服务不可用才建 `PENDING_VERIFICATION`（可 `POST /api/auth/reverify`）；只存 `idNumberHash` + 加密姓名，不恢复身份证号 / 照片存储或 `uploads/` 写入。

## 已知限制

- PDF 使用 Helvetica，中文渲染为 `?`。
- 模式 B 小名单存在投票状态推断风险。
- `getVotePhase` 用 `>` 比较 `endAt`，正好相等时仍是 `LIVE`（1ms 边界）。
