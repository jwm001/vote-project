# Task 5: 投票活动创建与管理 - 完成报告

## 完成内容

### 后端
- 创建 vote 模块（vote.controller.ts、vote.service.ts、vote.routes.ts）
- 实现投票创建接口 POST /api/votes（需要认证）
- 只有 status 为 APPROVED 的用户才能创建投票
- 支持设置标题、描述、时间范围（startAt、endAt）、选项列表、单选/多选（allowMultiple）
- 创建投票时同时创建关联的 Option 记录
- 提供投票列表接口 GET /api/votes 和详情接口 GET /api/votes/:id
- 在 apps/api/src/index.ts 中注册 voteRoutes

### 前端
- 创建创建投票页面（CreateVote.tsx）- 支持填写标题、描述、时间范围、选项（可添加/删除选项，至少2个），切换单选/多选
- 创建投票列表页面（VoteList.tsx）- 显示所有投票，展示标题、描述、时间范围、类型、选项数
- 更新 App.tsx 添加路由 /votes 和 /vote/create，更新首页导航

### 数据模型
- 已有 Vote、Option、Ballot 模型，满足需求

## 测试
- API 测试通过（`npm test --workspace=apps/api` 显示 "no tests yet"）
- Web 类型检查通过（`npm run typecheck --workspace=apps/web`）

## 提交
- 已提交：feat: vote module with create and list, frontend pages for creating and listing votes
