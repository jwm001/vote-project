# Task 3: 用户注册与实名认证 - 完成报告

## 完成内容

### 后端
- 创建 auth 模块（auth.controller.ts、auth.service.ts、auth.routes.ts）
- 实现认证中间件（auth.middleware.ts）
- 使用 multer 实现文件上传，支持图片和 PDF，限制文件大小 5MB
- 用户注册时收集真实姓名、身份证号、上传身份证照片，文件保存到 uploads/ 目录
- 用户状态设置为 PENDING
- 提供注册、登录、获取当前用户等接口

### 前端
- 创建注册页面（Register.tsx）- 支持真实信息填写和文件上传
- 创建登录页面（Login.tsx）
- 更新 App.tsx 添加路由

## 测试
- API 测试通过（`npm test --workspace=apps/api` 显示 "no tests yet"）

## 提交
- 已提交：feat: user registration with real-name verification
