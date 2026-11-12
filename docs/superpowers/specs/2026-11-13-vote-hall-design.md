# 投票大厅（Vote Hall）设计

日期：2026-11-13

## 要解决的问题

现在创建一场公开链接投票后，只有拿到分享链接的人才知道它存在。创建者必须自己把链接发到群里、私聊里，没收到链接的人完全没有发现渠道。

投票大厅要解决的是「发现」：所有已核验的用户打开一个固定入口，就能看到当前正在公开征集意见的投票，不用等别人发链接。

分享链接的方式保留不变。大厅是**额外**的一条发现渠道，不是替代品。

## 目标

- 已核验用户有一个固定入口（导航「投票大厅」）能浏览正在进行的公开投票。
- 创建者在创建投票时自己决定这场投票是否进大厅，默认不进。
- 大厅里点进任意一场投票，走现有的投票详情页，投票规则完全不变。
- 大厅按创建时间倒序排列，最新创建的在最前面。

## 非目标

- 不做推荐 / 个性化排序。用户已明确说「先按顺序，后面再根据喜好算法推荐」。
- 不做大厅的搜索、分类、标签、分页浏览。
- 不做已结束投票的大厅留档。
- 不做邀请制投票进大厅。
- 不做「进大厅 / 退出大厅」的事后切换。
- 不做任何形式的通知、订阅、提醒。
- 不改变现有分享链接、邀请、结果可见性、PDF、名单的任何规则。

## 反目标（做到这些就算失败）

- 大厅泄露投票者身份、假名、实名名单或结果分布。
- 大厅成为绕过实名核验或一人一票的入口。
- 大厅让邀请制投票变得「谁都能看到」。
- 大厅改变了原有投票详情页的权限判断。

## 已定的决策

### 1. 只有公开链接模式能进大厅

邀请制（`INVITE_ONLY`）的投票本来就只能凭邀请参与，放进大厅也点不进去，只会造成误解。因此：

- 创建表单里，只有选「公开链接」时才显示「在投票大厅公开」开关。
- 服务端拒绝 `participationMode === "INVITE_ONLY"` 且 `listedInHall === true` 的创建请求，返回 400（而不是静默忽略），方便以后发现前端 bug。

### 2. 只有进行中（LIVE）的投票出现在大厅

- 公开链接投票创建即 `LIVE`，勾选后立刻出现在大厅。
- 到 `endAt`、创建者提前结束、或因任何原因进入 `ENDED` 后，自动从大厅消失。
- 阶段仍用现有的 `getVotePhase` 推导，不落库、不在前端推断。

### 3. 排序：创建时间倒序

`createdAt` 新的在前。平手时用 `id` 兜底，保证顺序稳定。推荐算法以后再做。

### 4. 谁能看大厅：已核验（APPROVED）用户

- 未登录：前端提示去登录。
- 已登录但 `PENDING_VERIFICATION`：返回 403，页面提示「完成实名核验后即可浏览投票大厅」。
- 理由：只有 `APPROVED` 能投票，给待核验用户看一个点不进去的大厅没有意义；同时和其他投票接口的准入保持一致。

### 5. 开关只在创建时决定

- 创建后不能改。公开链接模式创建即开始，本来就没有「开始前编辑」的窗口；再开一个事后开关会让已投票者的预期变化。
- 服务端 `updateVote` 不接受 `listedInHall` 字段（与现有「忽略未识别字段」的行为一致，不额外报错）。

### 6. 大厅卡片显示什么

每张卡片：投票标题、创建者用户名、截止时间、已投人数、单选/多选、以及「已投」/「我创建的」标记。不显示选项内容、不显示结果分布、不显示任何投票者信息。

### 7. 已投的投票仍然显示

投过的投票留在大厅里并标注「已投」，方便回看详情和结果（结果是否可见仍由原规则决定）。

### 8. 自己创建的投票也显示

标「我创建的」，点进去就是现有的管理视图。

## 实现位置

### 数据库（`apps/api/prisma/schema.prisma`）

`Vote` 增加一个字段：

```prisma
listedInHall Boolean @default(false)
```

历史数据默认 `false`，即全部不进大厅，符合预期。用 `npx prisma db push` 同步本地库（`prisma/migrations` 不完整，不用 `migrate deploy`）。

### 创建接口

- `CreateVoteInput` 增加 `listedInHall?: boolean`，默认 `false`。
- `vote.controller.ts` 的 `create` 从 `req.body` 读取并转成布尔值传入 service。
- `vote.service.ts` 的 `createVote` 写入该字段，并按第 1 条校验邀请制。

### 大厅接口

`GET /api/votes/hall`，挂在 `authMiddleware` + `verifiedMiddleware` 之后。

必须注册在 `/:id` 之前（和 `/my/*` 同样的原因，`vote.routes.ts` 已有注释）。

响应：

```json
{
  "votes": [
    {
      "voteId": "cuid",
      "title": "2026 年度最佳项目评选",
      "description": "可选，原样返回",
      "creatorUsername": "alice",
      "allowMultiple": false,
      "endAt": "2026-11-20T12:00:00.000Z",
      "createdAt": "2026-11-13T09:00:00.000Z",
      "votedCount": 12,
      "hasVoted": false,
      "isCreator": false
    }
  ]
}
```

查询条件：`listedInHall = true`、`participationMode = "OPEN_LINK"`、`closedAt = null`、`endAt > now`，按 `createdAt desc` 取最多 200 条，再用 `getVotePhase` 过滤一遍（保持和详情页一致的 1ms 边界语义）。

`creatorUsername` 通过一次性批量查询 `User` 得到，不在 `Vote` 上新增 Prisma 关系。

`votedCount` 用一次 `groupBy` 批量统计；`hasVoted` 用一次 `findMany` 取当前用户在本批投票里的 `UserVoteHistory`。不要逐条查询。

### Web（`apps/web`）

- 新增页面 `src/pages/Hall.tsx`（+ `Hall.css`），路由 `/hall`，注册在 `App.tsx`。
- 导航栏加「投票大厅」，已登录时显示。
- 首页已登录状态下加「投票大厅」入口。
- `CreateVote.tsx`：在「参与方式」区块内，仅当 `OPEN_LINK` 时渲染开关「在投票大厅公开」，默认关闭，说明文字：「所有已核验用户都能在大厅看到并参与；创建后不可更改。」
- 页面包含加载骨架、错误重试、空状态（「大厅里还没有公开投票」）、未登录提示、待核验提示。
- 卡片点击进入 `/vote/:id`。已投/我创建的标记只做展示，不改变任何后端规则。

### 测试

新增 `apps/api/src/modules/vote/vote.hall.test.ts`，覆盖：

1. 未登录 → 401。
2. `PENDING_VERIFICATION` → 403。
3. 只返回 `listedInHall = true` 且 `OPEN_LINK` 且 `LIVE` 的投票。
4. 排除：未勾选、邀请制、已提前结束（`closedAt` 非空）、已过 `endAt`、草稿。
5. 按 `createdAt` 倒序。
6. `hasVoted` / `isCreator` / `votedCount` 正确。

扩展现有 `vote.create.test.ts`：

7. 默认 `listedInHall` 为 `false`。
8. `OPEN_LINK` + `listedInHall: true` 落库为 `true`。
9. `INVITE_ONLY` + `listedInHall: true` → 400。

### 文档

- `README.md`：核心特性加一条「投票大厅」；模式 A 段落补一句「创建者可勾选是否在大厅公开」。
- `AGENTS.md`：「入口与模块」补 `/hall` 路由；「不能破坏的领域约定」补大厅的准入、可见范围、生命周期、排序。
- `docs/superpowers/specs/2026-11-03-public-voting-modes-design.md`：把「不做公开投票列表 / 模式 A 只靠分享链接进入」的表述标注为「已被 2026-11-13 大厅设计部分取代」。大厅是创建者主动勾选的窄例外，其余规则不变。
- 本文件。

## 留给实现者的决定

- 卡片的具体视觉样式（沿用 `MyVotes` / `Home` 的现有设计语言即可）。
- 空状态和错误文案的具体措辞（保持现有页面语气）。
- 200 条上限的具体数值是否需要调整。
- 是否在创建页预览卡片上加一个「大厅公开」小标签（可做可不做）。

## 已知限制

- 大厅不提供分页，超过 200 条的旧投票不会出现在列表里。
- 创建者用户名对已核验用户可见（与「我的邀请」里展示发起人一致）；大厅不展示任何投票者信息。
- 排序完全按创建时间，不做任何热度 / 截止时间加权。
