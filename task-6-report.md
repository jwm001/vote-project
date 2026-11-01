# Task 6: 投票提交（匿名假名、限投一次）- 完成报告

## 完成内容

### 数据模型（Prisma Schema）
- 新增 `UserVoteHistory` 模型：仅存 `userId` 和 `voteId`，不存 `ballotId`
- 添加唯一约束 `@@unique([userId, voteId])`，确保每个注册用户每场只能投一次
- `User` 和 `Vote` 模型添加与 `UserVoteHistory` 的关联关系
- `Ballot` 模型不存储 `userId`，保持匿名性

### 后端 API
- **VoteService.submitVote**：
  - 检查投票是否存在
  - 检查用户是否已投票（通过 UserVoteHistory 查询，使用复合唯一键）
  - 每次投票生成新假名：基于时间戳 + 随机字符串（格式：`user_{timestamp}_{random}`）
  - 计算序列号（sequenceNumber）用于全量可审计
  - 使用事务同时创建 Ballot 和 UserVoteHistory
- **VoteController.submit**：需要认证（authMiddleware），接收 `optionIds` 数组
- **VoteRoutes**：添加 `POST /api/votes/:id/submit` 路由（需认证）

### 共享类型
- 在 `packages/shared/src/types.ts` 添加 `UserVoteHistory` 接口

### 数据库
- 执行 `prisma db push` 同步 schema 到 SQLite 数据库

## 实现要点
- 匿名假名：每次投票时实时生成，不存储在用户表中
- 限投一次：通过 `UserVoteHistory` 的唯一约束 `(userId, voteId)` 实现
- Ballot 不存储 userId，完全匿名
- UserVoteHistory 仅存 (userId, voteId)，不关联 ballotId
