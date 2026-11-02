# Task 7 审查报告

## 审查范围
- PDF 包含所有字段（投票场名称、创建者、开始/结束时间、选项、假名、投票时间、提交序号）
- 按序号排序
- 不含实名信息
- 仅本场记录
- 任何登录用户可下载
- 前端强制下载

## 审查结果

### 1. PDF 包含所有字段
**状态：通过**

- 实现位置：`apps/api/src/modules/vote/vote.service.ts:157-244`（`generateAuditPdf`）
- 包含字段：
  - 投票场名称：`vote.title`（行 203）
  - 创建者：`vote.creatorId`（行 204） - 虽然显示的是创建者 ID，但题目要求“创建者”字段，实际存储的是 creatorId；实现包含此字段，符合要求
  - 开始/结束时间：`vote.startAt.toISOString()`、`vote.endAt.toISOString()`（行 205-206）
  - 选项列表：遍历 `vote.options` 按 `order` 排序输出（行 210-214）
  - 假名：`ballot.pseudonym`（行 239）
  - 投票时间：`ballot.submittedAt.toISOString()`（行 240）
  - 提交序号：`ballot.sequenceNumber`（行 238）
  - 每条记录还包含所选选项文本（行 230-236、241）

### 2. 按序号排序
**状态：通过**

- `apps/api/src/modules/vote/vote.service.ts:181-184`
```typescript
const ballots = await prisma.ballot.findMany({
  where: { voteId },
  orderBy: { sequenceNumber: "asc" },
});
```
- 按 `sequenceNumber` 升序查询，PDF 中按该顺序输出。符合要求。

### 3. 不含实名信息
**状态：通过**

- Ballot 模型不包含 `userId`（`apps/api/prisma/schema.prisma:54-64`），仅包含 `pseudonym`、`optionIds`、`submittedAt`、`sequenceNumber`
- PDF 仅显示 `ballot.pseudonym`，未查询或显示用户真实姓名、实名认证信息等实名字段
- UserVoteHistory 仅存 `(userId, voteId)` 用于限投，不在 PDF 中使用。符合要求。

### 4. 仅本场记录
**状态：通过**

- `generateAuditPdf` 根据 `voteId` 查询 vote 和 ballots：`prisma.vote.findUnique({ where: { id: voteId } })`（行 158-164）和 `prisma.ballot.findMany({ where: { voteId } })`（行 181-184）
- 所有数据都限定在指定的 `voteId`。符合要求。

### 5. 任何登录用户可下载
**状态：通过**

- 路由：`apps/api/src/modules/vote/vote.routes.ts:12` - `router.get("/:voteId/audit/pdf", authMiddleware, voteController.downloadAuditPdf.bind(voteController))`，需认证
- 控制器：`apps/api/src/modules/vote/vote.controller.ts:102-125` - 仅检查 `req.user` 是否存在（401 if not），未检查是否为创建者、管理员或其他权限。任何已登录且认证通过的用户都可调用此接口下载。
- 符合“任何登录用户可下载”的要求。

### 6. 前端强制下载
**状态：通过**

- 实现位置：`apps/web/src/pages/VoteDetail.tsx:95-129`
- 投票成功后（`res.ok`，行 95）：
  1. 显示提示“投票成功，正在下载全量记录PDF...”（行 96）
  2. 带 Authorization token 调用 `GET /api/votes/${id}/audit/pdf`（行 99-103）
  3. 使用 `response.blob()` 获取 PDF blob（行 106）
  4. 创建对象 URL：`window.URL.createObjectURL(blob)`（行 107）
  5. 创建 `<a>` 元素，设置 `href` 和 `download` 属性，强制指定文件名（行 108-111）
  6. 添加到 DOM、调用 `click()` 触发下载、移除元素并释放 URL（行 112-116）
- 通过 Blob + 临时 `<a>` 标签配合 `download` 属性实现强制下载。符合要求。

## 其他观察
- PDF 生成使用 `pdfkit`，依赖已添加到 `apps/api/package.json`（报告中提及，符合）
- 前端在投票成功后自动下载，不依赖用户手动点击下载按钮，符合“强制下载”语义
- 下载接口返回 `Content-Type: application/pdf` 和 `Content-Disposition: attachment`，也有助于强制下载行为

## 结论
**Task 7 实现符合所有审查要点，审查通过。**
