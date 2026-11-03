# AGENTS.md

## 状态

已实现防作弊投票网站（准入实名 + 投票匿名 + 全量可审计）。

## 技术栈

- **后端**: Node.js + Express + TypeScript + Prisma + SQLite
- **前端**: React + Vite + TypeScript
- **PDF生成**: pdf-lib
- **认证**: JWT

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

- `apps/api/src/index.ts` - API 入口
- `apps/api/src/modules/` - 功能模块（auth、admin、vote、ballot、audit）
- `apps/api/prisma/schema.prisma` - 数据库模型（User、Vote、Option、Ballot、UserVoteHistory）
- `apps/web/src/` - 前端应用
- `packages/shared/` - 共享类型

## 核心约定

- **身份隔离**: `Ballot` 不存储 `userId`，只存 `pseudonym`（每次投票生成新假名）。`UserVoteHistory` 存 `(userId, voteId, ballotSequenceNumber)` 用于防重复投票和"我的投票"回查
- **匿名的边界**: 业务接口和 PDF 中不出现实名信息；但 `UserVoteHistory.ballotSequenceNumber` 与 `Ballot.sequenceNumber` 可关联，直接访问数据库的人能还原"谁投了什么"。不要对外宣称"连 DBA 都无法关联"
- **一人一号**: `User.idNumberHash` 存身份证号的 HMAC-SHA256 摘要并加唯一索引，注册时必填密码（≥6 位）、用户名不得等于身份证号；明文身份证号只存密文。`ID_HASH_SECRET` 一旦启用不可更换
- **实名审核**: 只有 `User.status === 'APPROVED'` 的用户才能创建投票和参与投票
- **每场限投一次**: 通过 `UserVoteHistory` 唯一约束 `(userId, voteId)` 和事务保证，提交时写入 `ballotSequenceNumber`
- **服务端强校验**: `submitVote` 必须校验投票时间窗口、选项是否属于本场、单选只能选 1 个、选项不得重复；`sequenceNumber` 在事务内分配，冲突时重试
- **强制下载**: 投票成功后必须下载本场全量记录 PDF
- **全量记录仅限本场**: PDF 只包含当前投票活动的所有记录，按 `sequenceNumber` 排序
- **审计摘要**: 投票结束后首次导出时把全量记录的 SHA-256 写入 `Vote.auditHash` / `Vote.auditRecordedAt`，之后每次导出重新计算并标注 `MATCH` / `MISMATCH`；进行中的投票不封存摘要
- **PDF 访问控制**: 创建者、参与者、管理员随时可下载；其他已审核用户需等投票结束；未审核用户不可下载
- **不暴露实名**: 投票记录、PDF 中均不包含用户实名信息

## 注意事项

- 独立仓库，不沿用兄弟仓库的技术栈和约定
- 实名材料存储在 `uploads/` 目录，仅管理员可访问
- 身份证号等敏感信息加密存储
- 所有时间使用 UTC
