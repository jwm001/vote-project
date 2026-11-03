# Vote Project

防作弊投票网站 - 准入实名 + 投票匿名 + 全量可审计

## 核心特性

- **准入实名**：用户需提交身份证等实名材料，经管理员审核通过后才能投票和创建投票
- **一人一号**：同一身份证号只能注册一个账号（存 HMAC-SHA256 摘要并加唯一索引，不存明文）
- **投票匿名**：每次投票生成全新的基于时间戳的假名，仅在本次投票记录中使用；业务接口和 PDF 中不含任何实名信息
- **全量可审计**：每场投票都有仅限本场的全量记录，投票成功后强制下载 PDF；投票结束后首次导出会固定 SHA-256 摘要，之后每次导出都会校验并在 PDF 中标注是否一致
- **防重复投票**：一个实名身份（账号）每场投票只能投一次，服务端强校验时间窗口、选项归属、单选/多选与重复提交
- **灵活配置**：支持单选/多选，由创建者配置

## 威胁模型

这套系统**承诺**防住：

- 同一个人注册多个账号反复投票
- 事后抵赖：每场投票都有可导出、带摘要校验的全量记录
- 部分内部篡改：投票结束后记录被修改时，导出的 PDF 会显示摘要不一致

**不承诺**防住：

- 组织化刷票、收买投票、一人使用他人真实身份注册
- 设备指纹、IP、浏览器指纹级别的识别
- 拥有数据库直接访问权限的人把假名还原成真人（见下）

## 匿名的边界

`Ballot` 不存 `userId`，只存 `pseudonym`；但 `UserVoteHistory` 为了防止重复投票，存了 `(userId, voteId, ballotSequenceNumber)`。

也就是说：

- 通过 API 和 PDF 的使用者**无法**把假名和真人对应起来
- 直接拿到数据库（管理员、备份、云厂商）的人**可以**用 `ballotSequenceNumber` 把 `userId → ballot → pseudonym` 关联起来

这是当前架构的已知边界。如果要求"连 DBA 都拼不起来"，需要改成在浏览器端保存假名，属于另一个量级的改造。

## 全量记录 PDF 的访问规则

- 投票创建者：随时可下载
- 参与过本场投票的用户：随时可下载（投票成功后强制下载依赖这条）
- 管理员：随时可下载
- 其他已通过实名审核的用户：投票结束后可下载
- 未通过审核的账号：不可下载

PDF 中的摘要规则：

- 投票进行中：记录本来就会持续增长，此时不封存摘要，PDF 标注为实时快照
- 投票结束后首次导出：计算全量记录的 SHA-256 摘要并写入 `Vote.auditHash`
- 之后的每次导出：重新计算并对比，PDF 中标注 `MATCH` / `MISMATCH`，响应头同时返回 `X-Audit-Digest`、`X-Audit-Sealed-Digest`、`X-Audit-Integrity`

摘要只用于发现"导出后被改动"，不等同于区块链式不可篡改。

## 项目结构

- `apps/api` - 后端 API (Express + TypeScript + Prisma)
- `apps/web` - 前端应用 (React + Vite + TypeScript)
- `packages/shared` - 共享类型和工具

## 开发

```bash
npm install
npm run dev
```

API 运行在 http://localhost:3000
Web 运行在 http://localhost:5173

> **数据库同步**：本仓库早期的 schema 是通过 `prisma db push` 直接同步的，`prisma/migrations` 历史并不完整。
> 因此本地或新环境请使用 `cd apps/api && npx prisma db push` 同步 schema（`prisma migrate deploy` 目前不适用于这套历史）。

## 测试

```bash
npm test
npm run typecheck
```

## 维护脚本

```bash
# 为历史用户回填身份证号摘要（幂等，可先 --dry-run）
npm run backfill:identity -w @vote-project/api -- --dry-run
npm run backfill:identity -w @vote-project/api
```

## 环境变量

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | SQLite 连接串 |
| `JWT_SECRET` | JWT 签名密钥 |
| `ENCRYPTION_KEY` | 实名材料加密密钥 |
| `ID_HASH_SECRET` | 身份证号 HMAC 摘要密钥（不设置时回退到 `ENCRYPTION_KEY`） |

> `ID_HASH_SECRET` 一旦用于生产环境就不要再更换，否则历史用户的 `idNumberHash` 将无法与新注册用户去重。

## 主要功能流程

1. 注册用户并提交实名材料（状态：待审核）
2. 管理员审核通过后，用户成为已认证用户
3. 已认证用户可创建投票（设置选项、单选/多选、时间范围）
4. 已认证用户参与投票，每次生成新假名，仅能投票一次
5. 投票成功后强制下载本场全量记录 PDF（包含假名、投票时间、选项、序号等）
