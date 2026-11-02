# Task 8: 权限控制和安全加固 - 完成报告

## 完成内容

### 1. 实名认证状态检查中间件（verifiedMiddleware）
- **创建** `apps/api/src/middleware/verified.middleware.ts`：检查用户状态是否为 `APPROVED`，只有已认证用户才能执行受限操作
- **应用**：将 `verifiedMiddleware` 应用于投票创建和投票提交路由（`apps/api/src/modules/vote/vote.routes.ts`）

### 2. 加密实名信息
- **创建** `apps/api/src/utils/encryption.ts`：使用 AES-256-CBC 加密算法加密/解密敏感信息
- **修改** `apps/api/src/modules/auth/auth.service.ts`：注册时对 `realName` 和 `idNumber` 进行加密存储
- **修改** `apps/api/src/modules/admin/admin.service.ts`：管理员查看待审核用户时解密显示实名信息

### 3. 实名材料文件访问控制
- **修改** `apps/api/src/index.ts`：添加受保护的 `/uploads/:filename` 路由，仅管理员（role === "ADMIN"）可访问上传的身份证材料文件
- 普通用户无法直接访问上传文件，必须通过管理员权限验证

### 4. 检查 API 响应不泄露身份关联
- **修改** `apps/api/src/modules/auth/auth.controller.ts`：`/api/auth/me` 返回用户信息时过滤敏感字段
- **审查** 各模块 API 响应：
  - 投票（Vote）相关接口不返回用户实名信息，仅返回投票数据
  - 投票记录（Ballot）只包含假名（pseudonym）和序号，不关联用户身份
  - PDF 审计日志只包含假名、序号、选项等匿名信息，不包含实名信息
  - 管理员接口在需要时才解密显示实名信息

### 其他改动
- **创建** `apps/api/src/middleware/role.middleware.ts`：通用角色权限检查中间件
- **修改** `apps/api/src/middleware/auth.middleware.ts`：添加默认导出
- **清理** `apps/api/src/index.ts`：移除不存在的 ballot 路由引用

## 安全措施
1. **身份隔离**：投票过程使用假名（pseudonym）系统，Ballot 与 User 完全分离（通过 UserVoteHistory 间接记录防重复投票）
2. **权限控制**：只有 APPROVED 状态用户才能创建投票和提交投票
3. **数据加密**：实名信息（realName、idNumber）加密存储
4. **文件保护**：身份证材料文件需管理员权限才能访问
5. **最小化暴露**：API 响应不泄露用户与投票记录的关联关系
