# 大众化投票模式改造设计

日期：2026-11-03

## 目标

把现有「实名审核 + 单场公开投票」改造成更适合大众使用的产品，支持每场二选一的两种参与模式：

- **模式 A（公开链接）**：任何拿到链接的人，登录并完成实名核验后都可以投票。
- **模式 B（邀请制）**：创建者先邀请一批人，名单固定后手动开始，只有名单内的人可以投票。

保留现有视觉语言（紫色渐变 + 白色卡片）、一人一号、投票匿名、全量记录 PDF 与 SHA-256 审计摘要。

## 非目标

- 不做邮件、短信、微信通知；邀请靠创建者自行转发链接。
- 不做自助找回密码；管理员可以重置为临时密码。
- 不做封禁/申诉/举报后台。
- 不解决 PDF 中文字体问题（当前 Helvetica 会把中文渲染成 `?`，见「已知限制」）。
- 不承诺「连 DBA 都无法关联」；`UserVoteHistory.ballotSequenceNumber` 与 `Ballot.sequenceNumber` 仍可在数据库层关联。

## 核心决策

### 模式与时间

| | 模式 A | 模式 B |
|---|---|---|
| 开始 | 创建即开始 | 创建者手动点「开始」 |
| 结束 | 创建时选的固定结束时间 | 点「开始」时选的时长，从开始时刻算 |
| 提前结束 | 创建者可提前结束 | 创建者可提前结束 |
| 自动结束 | 无 | 已绑定的受邀人全部投完后自动结束 |
| 投票资格 | 任意 `APPROVED` 用户 | 名单内 `ACCEPTED` 用户 |

- 模式 B 在「开始」之前是 `DRAFT`；创建者可以催办、移除、强制开始。
- 模式 B 提前开始时，开始前已邀请但未接受的人仍保留邀请，开始后接受仍可投票（前提是投票还没结束）。
- 模式 B 开始后不能新增受邀人。
- 模式 B 开始后只能移除「未投票」的人；已投票的人不能移除。
- 模式 B 点「开始」时至少要有一个已接受的受邀人，否则 409。
- 模式 B 的创建者如果也想投票，必须把自己的用户名加进名单并接受邀请；创建者身份本身不自动获得投票资格。
- 模式 B 自动结束条件：所有「未被移除且已绑定用户」的邀请人都已投票；尚未被接受的一人一链接不算在内（它们还没有绑定任何用户）。未接受的用户名邀请会阻塞自动结束，创建者需要催办或移除。
- 模式 A 在投出第一张票之前可以编辑/删除；模式 B 在点「开始」之前可以编辑/删除。之后只能提前结束，不能改选项/时长，不能重新开启。
- 移除公开的 `GET /api/votes` 列表接口：模式 B 的标题/存在性不能泄露；模式 A 靠分享链接进入。
  > 2026-11-13 更新：本条的「不做公开投票列表」已被 `2026-11-13-vote-hall-design.md` 部分取代。大厅是创建者主动勾选的窄例外，其余规则不变。
- `GET /api/votes/:id` 需要登录；模式 B 的非受邀者返回 403，只有受邀者/创建者/管理员能看详情。

### 实名与账号

- 只支持大陆 18 位身份证（`^\d{17}[\dX]$`，末位 X 统一大写）；港澳台证件和护照本版不做。
- 注册时同步调用二要素（姓名 + 身份证号）核验服务。
- 核验通过：`status = APPROVED`，记录 `identityVerificationRef` / `identityVerifiedAt`。
- 核验不通过：拒绝注册，不创建账号。
- 核验服务不可用：创建 `status = PENDING_VERIFICATION` 的账号，可以登录但不能投票/创建；用户可稍后重试核验。
- 不做人工看照片审核；管理员只保留只读用户/核验信息列表 + 重置密码。
- **不存身份证号和照片**：新注册只写 `idNumberHash`（HMAC-SHA256 唯一索引）+ 加密姓名 + 核验流水/时间。`idNumber`、`idCardImages` 作为历史列保留但强制清空，新代码不再写入。
- 历史账号继续可用；迁移时清空其身份证号和照片文件，补 `identityVerificationRef = "legacy"`、`identityVerifiedAt = createdAt`。
- 注册限流：同一 IP 每小时最多 5 次核验尝试。
- 密码至少 6 位；用户名不得等于身份证号。

### 名单与隐私

| 阶段 | 模式 A | 模式 B |
|---|---|---|
| 投票前 | 无名单概念 | 受邀者可见名单 + 接受状态 |
| 投票中（普通参与者） | 只看「已投 N 人」 | 只看「已投 N/M」 |
| 投票中（创建者） | 只看「已投 N 人」 | 可见谁已投/未投（用于催办） |
| 结束后 | 已投票者的脱敏实名（张*三） | 所有受邀人的完整实名，**不标注**已投/未投 |

- 模式 A 名单对所有人（含创建者）脱敏，且只在结束后出现。
- 模式 B 名单只对受邀者/创建者/管理员可见；非受邀者看不到名单。
- 模式 B 结束后名单包含未投票的人，但不暴露谁没投。
- 业务接口、PDF、投票记录中不出现实名；模式 B 名单是唯一例外，且只给授权查看者。

### 弃权

- 每场投票由系统自动创建一个 `text = "弃权"`、`isAbstain = true`、排序最后的选项。
- 创建者不能删除、改名、排序弃权选项；创建页只读展示。
- 创建者填写的选项不得叫「弃权」。
- 弃权算一票，占一个 `sequenceNumber`，写入 `UserVoteHistory`，之后不能再投。
- 计票：弃权单独一行；百分比分母 = 含弃权的总票数；弃权不参与「获胜选项」判定。
- 若弃权票严格多于所有非弃权选项：`winner = null`，提示「弃权最多，未形成多数」。
- 若弃权票与最高非弃权选项相同（且都大于 0）：`winner = null`，提示「平票」。
- 多选时百分比可以相加超过 100%，分母仍是总票数（ ballots 数），不是选项被选次数。
- 多选时弃权与其他选项互斥；服务端拒绝「弃权 + 其他选项」。
- 必须显式选择弃权才能提交；服务端拒绝空选择。

### 结果与 PDF

- 投票进行中，普通参与者只看人数；创建者可用创建时选定的「实时公开结果」开关（默认关闭，开始后不可改）。
- 结束后：模式 A 对登录用户公开分布；模式 B 只对本场受邀者/创建者/管理员公开。
- 强制下载保留：
  - 投票进行中，非创建者/管理员下载的 PDF **隐藏选项和票数**，只保留序号、假名、提交时间、摘要。
  - 结束后同一入口给含选项和票数的完整版。
  - 创建者/管理员在投票期间可以下载完整版（便于主办方核对）。
- 审计摘要只在投票结束后（含提前结束）首次导出时封存；进行中标注 `live`；之后 `sealed` / `match` / `mismatch`。

### 邀请

- 已注册用户：创建者按**精确用户名**批量添加，不暴露用户目录；被邀请后出现在对方的「我的邀请」页，用「接受」按钮接受（不需要链接，也不会过期）。
- 已移除的邀请可以重新邀请，复用同一行记录（重置为 `INVITED`），不会因为唯一约束失败。
- 未注册用户：创建者生成一人一链接（`/invite/:token`），单次有效、可撤销、7 天过期、不绑定预期身份。
- 邀请被转发时「谁先接受谁算」；创建者可在名单里看到实际接受人，不合适就移除并重新生成。
- 邀请页只有「知道了/接受」，不做「不参加」；不想参加就不点，创建者可以移除。
- 系统不发送通知；创建者需自行告知被邀请人。「催办」只是创建者在名单里看到谁还没投/未接受，然后线下提醒。

### 管理员与前端

- 管理员：只读用户/核验列表 + 重置密码；删除审核看图页 `AdminReview` / `ReviewUsers`。
- 首页第一屏：创建投票 / 我的投票 / 我的邀请；防作弊说明下沉。
- 分享方式：复制链接 + 二维码。
- 手机端导航改为响应式，不再用 `window.innerWidth` 判断。
- 移除公开「投票列表」页；模式 A 靠分享链接进入，模式 B 靠邀请链接/我的邀请进入。
  > 2026-11-13 更新：本条的「不做公开投票列表」已被 `2026-11-13-vote-hall-design.md` 部分取代。大厅是创建者主动勾选的窄例外，其余规则不变。

## 数据模型

### User

新增：

- `identityVerificationRef String?`
- `identityVerifiedAt DateTime?`

保留但清空/停用：

- `idNumber String @default("")`：历史列，新代码不写。
- `idCardImages String @default("[]")`：历史列，新代码不写。

`status` 取值：`APPROVED`、`PENDING_VERIFICATION`、`REJECTED`（历史 `PENDING` 迁移为 `PENDING_VERIFICATION`）。

### Vote

新增：

- `participationMode String @default("OPEN_LINK")`：`OPEN_LINK` | `INVITE_ONLY`
- `durationMinutes Int?`：模式 B 必填，1..43200
- `resultsPublicDuringVote Boolean @default(false)`
- `startedAt DateTime?`：模式 B 点「开始」的时刻；模式 A 等于 `startAt`
- `closedAt DateTime?`：提前结束时刻

`startAt` / `endAt` 保持非空：

- 模式 A：`startAt = createdAt`，`endAt = 创建者选择的结束时间`。
- 模式 B：创建时 `startAt = now`、`endAt = now + durationMinutes` 作为临时窗口；点「开始」时重写为真实窗口。

### Option

新增：

- `isAbstain Boolean @default(false)`

### VoteInvite

```prisma
model VoteInvite {
  id             String   @id @default(cuid())
  voteId         String
  vote           Vote     @relation(fields: [voteId], references: [id])
  inviteeUserId  String?
  invitee        User?    @relation(fields: [inviteeUserId], references: [id])
  token          String?  @unique
  status         String   @default("INVITED") // INVITED | ACCEPTED | REMOVED
  acceptedAt     DateTime?
  removedAt      DateTime?
  expiresAt      DateTime?
  createdAt      DateTime @default(now())

  @@unique([voteId, inviteeUserId])
  @@index([voteId])
}
```

## 状态机

`getVotePhase(vote, now)`：

- 模式 A：`closedAt` 或 `now >= endAt` → `ENDED`；否则 `LIVE`。
- 模式 B：`startedAt == null` → `DRAFT`；`closedAt` 或 `now >= endAt` → `ENDED`；否则 `LIVE`。

## API 变更

### 认证

- `POST /api/auth/register`：JSON `{ username, password, realName, idNumber }`，不再接收 multipart。
- `POST /api/auth/login`：不变。
- `GET /api/auth/me`：返回 `id, username, status, role, realName, identityVerifiedAt`。
- `POST /api/auth/change-password`：`{ currentPassword, newPassword }`。

### 管理员

- `GET /api/admin/users`：只读列表，不返回身份证号/照片。
- `POST /api/admin/users/:id/reset-password`：返回一次性临时密码。
- 删除 `GET /api/admin/pending`、`POST /api/admin/:id/approve`、`POST /api/admin/:id/reject`。

### 投票

- `POST /api/votes`：创建投票（模式、时间、选项、实时结果开关）。
- `PATCH /api/votes/:id`：开始前/首票前编辑。
- `DELETE /api/votes/:id`：开始前/首票前删除。
- `POST /api/votes/:id/start`：模式 B 手动开始。
- `POST /api/votes/:id/end`：提前结束。
- `GET /api/votes/:id`：详情 + `phase` + 人数 + `canVote` + `hasVoted` + `isInvitee`。
- `POST /api/votes/:id/submit`：投票。
- `GET /api/votes/:id/results`：结果（按可见性）。
- `GET /api/votes/:id/roster`：名单（按可见性）。
- `GET /api/votes/my/votes`：我创建的 + 我参与过的。
- `GET /api/votes/my/invites`：我的邀请。
- `POST /api/votes/my/invites/:inviteId/accept`：按名单记录接受用户名邀请。

### 邀请

- `POST /api/votes/:id/invites/usernames`：按用户名批量邀请。
- `POST /api/votes/:id/invites/links`：生成 N 个一人一链接。
- `GET /api/votes/:id/invites`：创建者/管理员查看名单。
- `DELETE /api/votes/:id/invites/:inviteId`：移除邀请。
- `GET /api/invites/:token`：邀请落地页信息。
- `POST /api/invites/:token/accept`：接受链接邀请。

### 实名重试

- `POST /api/auth/reverify`：`PENDING_VERIFICATION` 用户重新提交 `{ realName, idNumber }` 核验；成功后 `APPROVED`，失败保持 `PENDING_VERIFICATION`，服务不可用返回 503。

### PDF

- `GET /api/votes/:voteId/audit/pdf`：按角色/阶段返回完整或隐藏选项的 PDF。

## 迁移

1. `cd apps/api && npx prisma db push`（先让新列/新表存在）。
2. 运行 `apps/api/src/scripts/cleanup-legacy-identity.ts`：
   - 删除 `apps/api/uploads/` 下被 `idCardImages` 引用的文件；
   - 所有用户 `idNumber = ""`、`idCardImages = "[]"`；
   - `identityVerificationRef = identityVerificationRef ?? "legacy"`；
   - `identityVerifiedAt = identityVerifiedAt ?? createdAt`；
   - 老的 `PENDING` 用户状态改为 `PENDING_VERIFICATION`。
3. 老投票默认 `OPEN_LINK`、`startedAt = startAt`、不补弃权选项、审计 hash 不变。

## 已知限制

- PDF 仍用 Helvetica，中文选项/标题会显示为 `?`；本版不做字体嵌入。
- 数据库层仍可通过 `UserVoteHistory.ballotSequenceNumber` 关联 `Ballot.sequenceNumber` 还原「谁投了什么」。
- 模式 B 的小名单 + 完整 PDF 仍存在时间相关推断风险；已通过「投票期间隐藏选项/名单」降低，但无法完全消除。

## 验收标准

- 模式 A：创建即开始、固定结束、登录 + 实名后可投、结束后公开脱敏名单和结果。
- 模式 B：按用户名/链接邀请、接受、手动开始、名单固定、只有名单内可投、结束后完整实名名单但不标注投票状态。
- 二要素核验通过/失败/服务不可用三条路径都能正确落状态。
- 弃权在两种模式、单选/多选下的计票和互斥都正确。
- 投票期间非创建者/管理员拿到的 PDF 不含选项和票数。
- 历史身份证号和照片被清理，新注册不再写入。
- `npm run typecheck`、`npm test`、`npm run build` 全部通过。
