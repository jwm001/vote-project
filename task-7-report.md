# Task 7: 全量记录 PDF 生成与强制下载 - 完成报告

## 完成内容

### 后端 API
- **VoteService.generateAuditPdf**：
  - 获取投票场信息（名称、创建者、开始/结束时间、选项列表）
  - 获取所有投票记录（Ballot），按 `sequenceNumber` 升序排序
  - 生成 PDF，包含：投票场名称、创建者、开始/结束时间、选项列表、假名、投票时间、提交序号
  - 每条记录显示序号、假名、投票时间、所选选项文本
- **VoteController.downloadAuditPdf**：
  - 需要认证（authMiddleware），任何登录用户都可下载
  - 返回 PDF 文件，设置 `Content-Type: application/pdf` 和 `Content-Disposition: attachment`
- **VoteRoutes**：
  - 添加 `GET /api/votes/:voteId/audit/pdf` 路由（需认证）

### 前端
- **VoteDetail.tsx（新增）**：
  - 投票详情页面，支持单选/多选
  - 提交投票后，自动调用 PDF 下载接口并强制触发下载
  - 使用 Blob + 创建临时 a 标签实现强制下载
- **App.tsx**：添加 `/vote/:id` 路由

### 依赖
- 添加 `pdfkit` 和 `@types/pdfkit` 到 API 依赖

## 实现要点
- PDF 包含所有要求字段：投票场名称、创建者、开始/结束时间、选项、假名、投票时间、提交序号
- 按提交序号（sequenceNumber）排序
- 任何登录用户都可下载（需认证）
- 投票成功后强制触发下载（通过前端自动下载逻辑实现）
- 使用 pdfkit 生成 PDF
