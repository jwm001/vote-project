# Task 6 审查报告

## 审查范围
- 假名每次生成
- Ballot 不含 userId
- UserVoteHistory 只存 (userId,voteId) 不存 ballotId
- 唯一约束
- 限投一次

## 审查结果

### 1. 假名每次生成
**状态：通过**

- 实现位置：`apps/api/src/modules/vote/vote.service.ts:5-9`
```typescript
function generatePseudonym() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `user_${timestamp}_${random}`;
}
```
- 每次调用 `submitVote` 都会生成新的 `pseudonym`（行 105：`const pseudonym = generatePseudonym();`），并传入创建 Ballot（行 113-121）。符合“每次投票都生成新假名”的要求。
- 注意：格式为 `user_${timestamp}_${random}`，与 Task 6 brief 中建议的 `anon_${timestamp}_${random}`（使用 `crypto.randomBytes`）不同，但不影响“每次生成”这一核心要求。

### 2. Ballot 不含 userId
**状态：通过**

- Schema：`apps/api/prisma/schema.prisma:54-64`
```prisma
model Ballot {
  id             String   @id @default(cuid())
  voteId         String
  vote           Vote     @relation(fields: [voteId], references: [id])
  pseudonym      String
  optionIds      String
  submittedAt    DateTime @default(now())
  sequenceNumber Int

  @@unique([voteId, sequenceNumber])
}
```
- Ballot 完全没有 `userId` 字段，也没有与 User 的关联关系。符合要求。

### 3. UserVoteHistory 只存 (userId,voteId) 不存 ballotId
**状态：通过**

- Schema：`apps/api/prisma/schema.prisma:66-74`
```prisma
model UserVoteHistory {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id])
  voteId String
  vote   Vote   @relation(fields: [voteId], references: [id])

  @@unique([userId, voteId])
}
```
- 仅有 `userId` 和 `voteId`，没有 `ballotId`。符合要求。

### 4. 唯一约束
**状态：通过**

- `UserVoteHistory`：`@@unique([userId, voteId])`（schema:73）- 确保每个用户每场投票只能记录一次
- `Ballot`：`@@unique([voteId, sequenceNumber])`（schema:63）- 确保每场投票的序号唯一，用于全量可审计
- `submitVote` 中也通过 `findUnique` 查询 `userId_voteId`（行 80-90）进行预检查

### 5. 限投一次
**状态：通过**

- 检查逻辑：`apps/api/src/modules/vote/vote.service.ts:80-90`
```typescript
const existingHistory = await prisma.userVoteHistory.findUnique({
  where: {
    userId_voteId: {
      userId: data.userId,
      voteId: data.voteId,
    },
  },
});

if (existingHistory) {
  throw new Error("Already voted");
}
```
- 写入逻辑：使用事务（行 107-127）同时创建 `Ballot` 和 `UserVoteHistory`
- 数据库层面也有唯一约束作为兜底，防止并发绕过

## 其他观察

- 路由配置：`apps/api/src/modules/vote/vote.routes.ts:9` 已添加 `POST /:id/submit`，并使用 `authMiddleware`（需要认证）
- 控制器：`apps/api/src/modules/vote/vote.controller.ts:69-96` 正确传递 `userId`、校验 `optionIds`
- 共享类型：`packages/shared/src/types.ts` 已添加 `UserVoteHistory` 接口

## 总结
Task 6 的所有核心要求均已实现：
- ✅ 假名每次生成（新建 Ballot 时生成新假名）
- ✅ Ballot 不含 userId
- ✅ UserVoteHistory 只存 (userId,voteId) 不存 ballotId
- ✅ 唯一约束（UserVoteHistory 和 Ballot）
- ✅ 限投一次（查询检查 + 事务 + 唯一约束）
