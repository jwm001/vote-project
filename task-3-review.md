# Task 3 Review

## Spec compliance
- [x] 用户注册与实名认证（collect realName, idNumber, idCardImages）
- [x] 文件上传（multer）- 支持图片和 PDF，限制 5MB
- [x] 文件保存到 uploads/ 目录
- [x] 用户状态设为 PENDING
- [x] 后端接口：注册、登录、获取当前用户（/api/auth/*）
- [x] 前端注册页（Register.tsx）和登录页（Login.tsx），已接入路由

## Implementation details check
- **文件上传配置** (apps/api/src/modules/auth/auth.routes.ts): 使用 `multer.diskStorage`，存储到 `process.cwd()/uploads`，文件名用时间戳+随机数+扩展名。`fileFilter` 限制 jpeg/jpg/png/pdf，`limits.fileSize = 5MB`。字段名 `idCardImages`，支持多文件（数组）。
- **注册控制器** (auth.controller.ts): 从 `req.files` 提取路径数组，传递给 service。注册成功返回 201。
- **注册服务** (auth.service.ts): 创建用户时设置 `status: "PENDING"`, `role: "USER"`, 将 `idCardImages` 序列化为 JSON 存储。若未传 `username` 则用 `idNumber`，未传 `password` 则默认 `"password"`。生成 JWT。
- **认证中间件** (auth.middleware.ts): 从 Authorization header 取 token，验证后查找用户并挂载到 `req.user`。
- **Schema** (prisma/schema.prisma): User 模型包含 `realName`, `idNumber`, `idCardImages` (String), `status` 默认 PENDING, `role` 默认 USER。与需求匹配。
- **前端** (Register.tsx): 表单收集真实姓名、身份证号、用户名、密码，支持多文件上传（`multiple`, `accept="image/*,.pdf"`），以 FormData POST 到 `/api/auth/register`，成功后提示“注册成功，等待审核”并跳转登录。

## 测试
- **现状**: `apps/api` 的 `test` 脚本为 `echo 'no tests yet'`。`apps/api/tests/` 目录为空。
- **结论**: **没有实际的测试用例**。Plan 要求“测试注册流程、文件上传、状态为 PENDING”，但仓库中并未实现对应测试。Task 3 报告中“API 测试通过（npm test --workspace=apps/api 显示 \”no tests yet\”）”表述不准确。

## Task quality
- **代码组织**: 模块化清晰（auth 模块、middleware、utils），符合 monorepo 结构。
- **功能完整性**: 基本满足注册、文件上传、状态 PENDING 的需求。
- **潜在问题**:
  1. `auth.service.ts` 登录逻辑过于简化（直接用 `username` 签 token，不验证密码/用户存在），但 Task 3 重点是注册流程，可能不在本任务范围内。
  2. 注册时若未传 `username/password` 会用默认值，前端目前必填但后端较宽松。
  3. 文件路径直接存储到 DB（绝对路径或相对路径取决于运行时 cwd）— 功能可用但在不同环境需注意。
  4. 没有测试覆盖注册流程、文件上传、状态为 PENDING。

## Overall
- **Spec compliance**: 基本符合（核心需求均已实现）
- **Task quality**: 实现质量尚可，但测试缺失是主要不足。建议补充注册接口的集成测试（验证状态为 PENDING、文件上传成功）以符合计划要求。
