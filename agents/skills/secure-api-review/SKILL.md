---
name: secure-api-review
description: 应用 API 安全标准。凡是创建或修改对外/客户端接口、审查 API 代码、或生成 OpenAPI 规格时使用。
---

# Secure API review

在创建或修改一个 API 端点时，逐条核对：

1. **认证**：每个端点都要求网关 JWT；除 `/health` 与登录外不存在匿名路由。管理端 `/api/admin/**` 仅允许 `ADMIN` 角色（学生端不得越权访问管理接口）。
2. **输入校验**：按 OpenAPI schema 校验请求体，拒绝未知字段；对 `user_id`/`word_id` 等资源参数做**归属校验**（学生只能操作自己的资源，防止越权 IDOR）。
3. **审计**：每个改变状态的端点都要发出审计事件，含 actor、action、entity、timestamp。管理端导出/配置变更尤其要可追溯。
4. **数据分级**：schema 里标记为 `pii` 的字段（手机号、昵称、学段等）**绝不**出现在日志或报错信息里；`@Slf4j` 打印时用脱敏。

## 运行检查

跑 `scripts/check-endpoints.sh`（若仓库有）并在摘要里附上其输出。没有脚本时，至少人工核对该端点是否符合上述 1–4 条。

## 反例提醒

- 不要在 controller 里直接返回内部实体/异常堆栈（会泄漏 schema 与内部结构）。
- 分页/统计接口要按数据归属范围过滤，不能给一个学生返回全局统计数据。
