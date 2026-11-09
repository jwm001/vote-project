# AGENTS.md

## 状态

已实现大众化防作弊投票网站：准入实名 + 投票匿名 + 全量可审计，支持公开链接 / 邀请制两种模式。

## 技术栈

- **后端**: Node.js + Express + TypeScript + Prisma + SQLite
- **前端**: React + Vite + TypeScript
- **PDF生成**: pdf-lib
- **认证**: JWT
- **实名核验**: 可插拔 provider（`mock` / `http`）

## 命令（从仓库根目录执行）

| 命令 | 用途 |
|---|---|
| `npm install` | 安装所有依赖 |
| `npm run dev` | 同时启动 API (3000) 和 Web (5173) |
| `npm run build` | 构建所有工作区 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行测试 |
| `npm run backfill:identity -w @vote-project/api` | 为历史用户回填身份证号摘要（幂等） |

## 项目布局

- `apps/api/src/index.ts` - API 入口（`app.ts` 创建 Express 应用）
- `apps/api/src/modules/` - 功能模块（auth、identity、admin、vote、ballot、audit）
- `apps/api/prisma/schema.prisma` - 数据库模型（User、Vote、Option、Ballot、VoteInvite、UserVoteHistory）
- `apps/web/src/` - 前端应用
- `packages/shared/` - 共享类型

## 核心约定

### 身份与实名

- **二要素核验**: 注册时同步核验姓名 + 18 位大陆身份证号。通过 → `APPROVED`；核验服务不可用 → `PENDING_VERIFICATION` 建号，可调用 `POST /api/auth/reverify` 重验；核验失败不建号
- **一人一号**: `User.idNumberHash` 存身份证号的 HMAC-SHA256 摘要并加唯一索引，注册时必填密码（≥ 6 位）、用户名不得等于身份证号。`ID_HASH_SECRET` 一旦启用不可更换
- **不存敏感材料**: 数据库只保留 `idNumberHash`、加密姓名、核验流水/时间；不再保存身份证号明文或照片，`uploads/` 不再接收材料
- **实名准入**: 只有 `User.status === 'APPROVED'` 的用户才能创建投票和参与投票

### 投票模式

- **模式 A（OPEN_LINK）**: 创建即开始，创建时必须选固定 `endAt`；创建者可提前结束；结束后所有登录用户可见结果与完整 PDF
- **模式 B（INVITE_ONLY）**: 创建后为 `DRAFT`，创建者按用户名邀请或生成一人一链接，手动 `start` 后进入 `LIVE`；开始后不能新增受邀人，已投票者不能移除；所有绑定用户投完自动结束
- **时间语义**: 全部 UTC。模式 B 未开始一律视为 `DRAFT`（不看创建时的占位 `endAt`）；开始时写入 `startedAt`，`endAt = startedAt + durationMinutes`
- **阶段判定**: 一律以 `getVotePhase` 的结果为准（`DRAFT` / `LIVE` / `ENDED`），前端不自行推断

### 名单与结果可见性

- **模式 A 名单**: 进行中只列已投票者，姓名脱敏（张\*三）；结束后已登录用户可见
- **模式 B 名单**: `DRAFT` 受邀者可见完整实名与接受状态；`LIVE` 仅创建者可见谁已投；`ENDED` 受邀者/创建者/管理员见完整名单但不标注投票状态
- **结果**: 进行中只显示「已投 N/M 人」；`resultsPublicDuringVote` 默认关且开始后不可改；模式 A 结束后对登录用户公开，模式 B 只对本场参与者/创建者/管理员公开

### 投票与弃权

- **每场限投一次**: 通过 `UserVoteHistory` 唯一约束 `(userId, voteId)` 和事务保证，提交时写入 `ballotSequenceNumber`
- **服务端强校验**: `submitVote` 必须校验阶段、时间窗口、模式 B 邀请资格、选项是否属于本场、单选只能选 1 个、选项不得重复、弃权与其它选项互斥；`sequenceNumber` 在事务内分配，冲突时重试
- **弃权**: 系统固定选项，排最后、不能删除或改名；计一票，百分比分母包含弃权；必须显式选择，系统不自动代弃权；结果页最多显示「未形成多数」

### 审计与 PDF

- **强制下载**: 投票成功后必须下载本场全量记录 PDF
- **全量记录仅限本场**: PDF 只包含当前投票活动的所有记录，按 `sequenceNumber` 排序
- **进行中脱敏**: 非创建者/管理员在投票期间下载的 PDF 隐藏选项与票数，只保留序号、假名、提交时间、摘要
- **审计摘要**: 投票结束后首次导出时把全量记录的 SHA-256 写入 `Vote.auditHash` / `Vote.auditRecordedAt`，之后每次导出重新计算并标注 `MATCH` / `MISMATCH`；进行中的投票不封存摘要
- **PDF 访问控制**: 创建者、参与者、管理员随时可下载；其他已核验用户需等投票结束；未核验用户不可下载
- **不暴露实名**: 投票记录、PDF 中均不包含用户实名信息

### 隐私边界

- **匿名的边界**: 业务接口和 PDF 中不出现实名信息；但 `UserVoteHistory.ballotSequenceNumber` 与 `Ballot.sequenceNumber` 可关联，直接访问数据库的人能还原"谁投了什么"。不要对外宣称"连 DBA 都无法关联"
- **小名单推断**: 模式 B 人数很少时，即使不标注投票状态也可能被社交推断；这是已知产品限制

### 管理员

- 只保留 `/admin/users` 只读用户/核验列表 + 重置密码（返回一次性临时密码）
- 旧的照片审核页（`AdminReview` / `ReviewUsers`）已删除
- 不做自助找回密码

## 注意事项

- 独立仓库，不沿用兄弟仓库的技术栈和约定
- `uploads/` 中的历史实名材料已清理，不再新增
- 身份证号等敏感信息只存摘要 / 密文
- 所有时间使用 UTC
- PDF 使用 Helvetica，中文渲染为 `?`，本版未修
- API 测试共享 `test.db` 且 `fileParallelism: false`，偶有跨文件污染；改动测试数据时注意隔离
