# 代码知识索引

核对日期：2026-11-05｜来源基线：`acb54b1`。用于手动定位知识，不是已接入 Runtime 的检索服务。

## 按问题找代码

| 问题 | 实现 | 主要回归 |
|---|---|---|
| 状态为何不能推进、审批为何失效 | `packages/agent-core/index.js` | `test/task-store.test.js` |
| 执行、验证、修复、取消和恢复 | `packages/agent-core/loop.js` | `test/loop.test.js` |
| 旧 Worker 为何被拒绝 | `packages/agent-core/leases.js` | `test/leases.test.js` |
| Worktree 创建、复用、清理、中断核对 | `packages/agent-core/worktrees.js` | `test/worktrees.test.js` |
| 报告、命令证据、摘要与哈希 | `packages/agent-core/evidence.js` | `test/evidence.test.js` |
| 模型上下文、四类工具与计划验证 | `packages/agent-core/openai-runtime.js` | `test/openai-runtime.test.js` |
| OpenAI/DeepSeek 选择与凭据名 | `packages/agent-core/providers.js` | `test/providers.test.js` |
| 累计费用/Token、未知用量与策略锁定 | `packages/agent-core/model-budget.js` | `test/model-budget.test.js` |
| CLI 参数、审批 actor、进程退出码 | `packages/agent-core/cli.js` | `test/cli.test.js` |
| 路径、凭据、命令输出和进程终止 | `packages/tool-kit/index.js` | `test/tools.test.js` |
| Docker 资源、挂载、网络与清理 | `packages/tool-kit/docker-sandbox.js` | `test/docker-sandbox.test.js` |
| API 会话、固定项目、Mock、恢复入口 | `apps/api/server.js` | `apps/api/test/console.test.js` |
| 页面、审批编辑、报告与轮询 | `apps/console/src/main.tsx`、`style.css` | `apps/console/test/browser.test.js` |
| 三个 Hook 的解析/扫描策略 | `agents/hooks/guard.py`、对应 `.sh` | `tests/test_guards.py` |
| Eval 定义、超时、REVIEW/SKIP | `evals/check.py`、`evals/*.json` | `tests/test_guards.py` 与 eval suite |

前九项的 `test/` 均相对 `packages/agent-core/`；工具两项相对 `packages/tool-kit/`。完整命令见[开发指南](development.md)。

## 已确认的工程知识

- **审批绑定内容**：上游产物变更后必须重新审批下游，不能只检查“曾经批准”。来源：TaskStore 与 task-store 回归。
- **不确定副作用不重放**：pending 需要人工核对；operationKey 不是跨系统 exactly-once。来源：Loop、CLI/API resolve 及恢复回归。
- **租约与文件隔离分工不同**：fencing 阻止过期 Worker 经网关写入；Worktree 隔离 Git 工作区；Docker 隔离命令。不能互相替代。
- **证据与业务验收分开**：命令退出 0 不能直接把需求验收改为 passed。来源：`evidence.js` 的 `acceptance`。
- **预算未知必须停止**：请求已发送但无有效用量时，不按零消耗自动重试。来源：model-budget 与 runtime 回归。
- **协议测试不是模型实证**：模拟 Responses 可以验证上下文/工具协议，不能证明真实供应商兼容、效果与成本。
- **控制台不是通用执行入口**：API 的 project 关联与可编辑产物不会改变固定 Mock 编码逻辑。来源：`createConsole` / `launch`。
- **知识与 Hook 不自动生效**：Markdown、Skill 或 Hook 文件存在，不代表 Runtime 已加载或强制执行。应核查调用路径。

## 原有领域知识

`agents/skills/configurable-params/` 和 `secure-api-review/` 保留业务经验。`system_config`、`ReviewDefaults`、`AdminService.REVIEW_DEFAULT` 是跨项目来源术语，不是当前 DevOS 已存在的配置服务或类。使用前确认目标仓库是否具备对应实现；跨仓库 eval 应在目标仓库运行。
