# Agent 入门

## 项目与入口

本仓库包含 AI-Native SDLC 方法论与 **Agentic DevOS 单机原型**。主线是 intent→spec→plan→代码/验证→PR→事故反馈；审批绑定产物哈希，修改上游须重新审查。

先读 [README](README.md)、[文档导航](docs/README.md)和[当前实现](docs/devos/00-文档导航与现状审计.md)。模块定位见[代码索引](docs/knowledge/code-map.md)，运行/恢复见[运维指南](docs/knowledge/operations.md)。

## 当前结构

- `apps/console/`：React + TypeScript + Vite 管理台；`apps/api/`：Node HTTP API，当前仅固定 Mock 流程。
- `packages/agent-core/`：Node 24 原生 SQLite 状态机、审批、Loop、租约、Worktree、模型预算、报告和 CLI。
- `packages/tool-kit/`：受限文件/命令工具与 DockerSandbox；CLI 接 OpenAI/DeepSeek Responses。
- `artifacts/`、`agents/`、`evals/`、`examples/`：模板、Skills/Hooks、回归与示例。
- `docs/knowledge/`：受 Git 管理的文档知识库；尚无自动检索或记忆服务。

## 常用命令

- 核心：`npm run check`、`npm test`；Python：`npm run test:guards`；评测：`npm run eval`。
- 网页：`npm ci`、`npm run build:console`、`npm run start:console`。
- API：`npm run test:console`；网页端到端：`npm run test:console:e2e`（需 Playwright 浏览器）。
- 强制沙箱：`DEVOS_REQUIRE_DOCKER=1 npm run test:sandbox`（需 daemon 和预准备镜像）。
- CLI：`npm run devos -- help`；无模型演示：`npm run demo:loop`、`npm run demo:workspace`。

## 协作约定

1. 文档中文为主，保留必要英文术语。以代码与对应提交的验证证据为准，历史日志不是当前状态。
2. 实施在开发分支；保留产物链与审批门禁。未获相应授权不自动合并或发布。
3. `completed`/命令通过不等于业务验收；`acceptance` 保持人工判断。Mock 和模拟模型协议测试不能计入真实任务成功率。
4. Skills 提供建议，确定性策略须由 Hook/网关执行；不能因文件存在就声称 Runtime 已接线。
5. 不确定副作用 pending 必须人工核对；不自动重放。不绕过租约、未知模型用量或预算策略阻塞。
6. 遵守文件/凭据与 Docker 隔离边界。API Token、私钥和秘密不得进入仓库、产物或日志。
7. 跨项目 eval 在目标项目 CI 运行；其他项目的 `system_config`、`ReviewDefaults` 等术语不表示 DevOS 有同名实现。
8. 新配置避免散落硬编码；以代码中单一默认来源为准。变更实现同步文档，按[知识维护规范](docs/knowledge/maintenance.md)沉淀经验。

## 已知易错点

- 不编辑已分发的 DSH preset 安装副本，应修改可审查的源副本。
- Hook 保持快速且限定变更范围；默认配置下的既有行为不得意外改变。
- 修改其他业务仓库时，若确有 `ReviewDefaults` / `AdminService.REVIEW_DEFAULT`，维护其默认值一致性；不要在 DevOS 虚构同名模块。
