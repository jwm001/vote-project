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

## 项目布局

- `apps/api/src/index.ts` - API 入口
- `apps/api/src/modules/` - 功能模块（auth、admin、vote、ballot、audit）
- `apps/api/prisma/schema.prisma` - 数据库模型（User、Vote、Option、Ballot、UserVoteHistory）
- `apps/web/src/` - 前端应用
- `packages/shared/` - 共享类型

## 核心约定

- **身份隔离**: `Ballot` 不存储 `userId`，只存 `pseudonym`（每次投票生成新假名）。`UserVoteHistory` 只存 `(userId, voteId)` 用于防重复投票，不存 `ballotId`
- **实名审核**: 只有 `User.status === 'APPROVED'` 的用户才能创建投票和参与投票
- **每场限投一次**: 通过 `UserVoteHistory` 唯一约束 `(userId, voteId)` 和事务保证
- **强制下载**: 投票成功后必须下载本场全量记录 PDF
- **全量记录仅限本场**: PDF 只包含当前投票活动的所有记录，按 `sequenceNumber` 排序
- **不暴露实名**: 投票记录、PDF 中均不包含用户实名信息

## 注意事项

- 独立仓库，不沿用兄弟仓库的技术栈和约定
- 实名材料存储在 `uploads/` 目录，仅管理员可访问
- 身份证号等敏感信息加密存储
- 所有时间使用 UTC
