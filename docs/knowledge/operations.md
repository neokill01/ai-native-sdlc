# 运行与故障处理

核对日期：2026-11-05｜依据：`cli.js`、`providers.js`、`loop.js`、`apps/api/server.js`、部署工作流。

## 两种入口

- **网页 Mock**：固定项目和 add 函数样例，用真实文件与 Node 断言演练失败/修复。数据库默认 `.devos/console/tasks.sqlite`；不调用供应商、不操作业务仓库。
- **CLI 模型任务**：操作者提供并审批 intent/spec/JSON plan，创建业务 Worktree，使用供应商模型与 Docker 命令沙箱。CLI 不自动推送、创建 PR、合并或部署。

完整审批/执行命令见 [Agent Core](../../packages/agent-core/README.md)；网页流程见[管理台指南](../devos/09-react-vite-console.md)。

## 配置索引

| 配置 | 作用 |
|---|---|
| `DEVOS_DATA_DIR` | 网页管理台数据根目录，建议绝对路径；默认仓库 `.devos/console/` |
| `DEVOS_PORT` | 单服务 loopback 端口，1024–65535；默认 3001，私有部署 4317 |
| `DEVOS_PROVIDER` / `--provider` | CLI 供应商；选项优先，默认 openai |
| `OPENAI_API_KEY`、`DEVOS_OPENAI_MODEL` | OpenAI 宿主凭据与模型 |
| `DEEPSEEK_API_KEY`、`DEVOS_DEEPSEEK_MODEL` | DeepSeek 宿主凭据与模型 |
| `--model` | 覆盖所选供应商的模型环境变量 |
| `--db`、`--repository`、`--worktree-root` | CLI 数据库、业务 Git 仓库、仓库外的 Worktree 根目录 |
| `--max-total-tokens`、`--max-turns`、`--max-tool-calls` | 累计模型预算；同任务不能提高既定策略 |
| `--max-cost-usd` | 可选费用预算，必须显式同时提供输入/输出每百万 Token 美元单价 |
| `--image` | 预准备的 Docker 镜像；默认 `node:24-bookworm-slim` |

完整选项以 `npm run devos -- help` 及 `cli.js` 的 `allowedOptions` 为准。供应商端点取自 `providers.js`；不自动跨供应商回退，不假定第三方端点或模型已通过实测。

密钥只在宿主安全环境配置，不写入仓库、产物、聊天、命令参数或容器。无需把云端会话的 GitHub 登录信息写进项目文档。

## 运行前检查

1. 固定业务仓库提交、审批范围及验收命令；Worktree 根目录与仓库互不嵌套。
2. 验证 Docker daemon 和镜像。当前默认镜像不会自动包含浏览器、前端依赖或项目原生工具；无网络容器无法临时下载安装。
3. 确认模型名称、供应商访问权限和预算；真实调用会产生 API 费用。
4. 使用 approved plan 的 `verification.commands`；测试命令应验证实际业务行为，不能仅以语法检查替代。
5. 执行后审查报告、Worktree diff 与业务需求；completed 不自动完成业务验收。

## 中断与恢复

关闭网页不取消任务；Node 服务退出后计算停止，SQLite 保留已写入的状态/证据。重启没有自动调度；先查看任务与旧租约状态。

- `checkpoint.operation=finished`：恢复可进入验证，不重做已完成操作。
- `pending`：Loop 暂停，必须先核对工作区和外部副作用。确认完成才选择 completed，确认未执行才选择 not_executed，不确定则继续暂停。
- 等旧租约失效或正常释放后，由可信操作者使用 CLI resolve 或网页人工核对入口，随后手动 run。证据只保存哈希；请在授权的记录系统保留需要复查的原始依据。

```bash
npm run devos -- status --db /path/tasks.sqlite --task TASK_ID
npm run devos -- report --db /path/tasks.sqlite --task TASK_ID
npm run devos -- resolve --db /path/tasks.sqlite --task TASK_ID   --decision completed --evidence-file /path/reconciliation.md
```

上例仅在“已确认外部操作完成”时使用。CLI run 的仓库/模型/预算必须与原任务兼容。不要删除事件、手改 SQLite 或提高额度绕过未知模型用量阻塞。

## 常见问题

| 现象 | 先检查 | 处理边界 |
|---|---|---|
| 页面 404 提示先构建 | `apps/console/dist/` | 运行 `npm ci`、`npm run build:console` |
| 会话 403 | 页面是否跨服务重启、Host/Origin/Token | 刷新同源页面；不要通过取消校验公开服务 |
| 任务更新 409 | UI 版本与当前任务版本 | 刷新后重新审查当前产物 |
| Mock 完成却无业务改动 | mode/workspaceKind、报告说明 | 属于当前设计，不能宣称业务功能完成 |
| 无 Docker/测试跳过 | daemon、预拉取镜像、执行权限 | 用强制 Docker 检查判断，不把 skipped 当 passed |
| 凭据扫描拒绝工作区 | 敏感路径或内容、链接、扫描预算 | 移除不应在工作区的秘密；不放宽扫描器来跑任务 |
| 未知模型用量、预算策略冲突 | model.request/model.usage 相关事件与供应商账单 | 人工核对；没有自动清账/重置接口 |
| 验证为 not_run | 是否真正执行批准的命令 | 模型总结或 Mock 动画不能代替命令证据 |
| Worktree 无法删除 | 是否 dirty、登记状态是否中断 | 审查/保留变更，reconcile 后处理；不默认 force |
| 端口被占用 | 当前监听服务与 DEVOS_PORT | 换专用端口，不停止无关服务 |

## 数据与部署

备份 SQLite 时应使用一致性快照/SQLite 备份机制，或先正常停止服务再复制数据库及需要保留的工作区；不要假设运行中任意文件复制可保证一致性。当前没有自动备份/迁移工具。

私有服务器说明见[部署文档](../devos-private-deployment.md)。代码回滚不回退数据库；当前没有公网多用户认证。文档存在部署方案不表示本次会话已连接或部署服务器。
