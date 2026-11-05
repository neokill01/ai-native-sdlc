# AI-Native SDLC / Agentic DevOS

中文为主、工具无关的 AI 软件研发流程，以及让流程可执行的单机 Agentic DevOS 原型。

核心产物链：`intent → spec → plan → 代码与测试 → PR 审查 → 发布 → 事故反馈`。需求、规格与计划逐阶段审批；测试通过与业务验收分开记录。

## 从哪里开始

- [文档与知识库导航](docs/README.md)：按使用场景找资料。
- [当前实现与功能边界](docs/devos/00-文档导航与现状审计.md)：代码事实与待实现能力。
- [开发与验证](docs/knowledge/development.md)：环境、命令、CI 与验证证据。
- [运行与故障处理](docs/knowledge/operations.md)：配置、恢复、预算和排障。
- [方法论](docs/playbook.md)与[成熟度阶梯](docs/adoption.md)：如何在其他项目采用流程。

## 当前产品形态

| 入口 | 已实现 | 边界 |
|---|---|---|
| React 网页管理台 + Node API | 任务、产物编辑、阶段审批、执行/取消/恢复、事件与报告 | 仅 Mock 固定样例，不调用模型、不修改关联业务仓库 |
| 单机 CLI | OpenAI/DeepSeek Responses 接入、独立 Git Worktree、Docker 命令隔离、有限修复与累计预算 | 真实模型任务验收待完成；不自动提交、推送、创建 PR 或部署业务项目 |
| 方法论资产 | 六阶段模板、Skills、Hooks、Evals、监控控制带样例 | Hooks 不等于已自动接入 Runtime 的全部工具路径 |

当前不是完整多用户研发平台。项目登记仍为服务端固定条目，独立队列 Worker、上下文检索、自动经验记忆和 PR 自动交付尚未实现。

## 体验网页流程

要求 Node.js 24+、npm；Mock 不需要模型 Key 或 Docker。

```bash
npm ci
npm run build:console
npm run start:console
```

打开 http://127.0.0.1:3001 。任务数据默认保存在仓库根目录 `.devos/console/`。这是本机单用户会话边界，不是公网登录系统。详见[管理台运行说明](docs/devos/09-react-vite-console.md)。

不调用模型的演示：

```bash
npm run demo:loop
npm run demo:workspace
```

真实模型执行的条件、审批命令和限制见 [Agent Core](packages/agent-core/README.md)及[运行指南](docs/knowledge/operations.md)。

## 目录

| 路径 | 内容 |
|---|---|
| `apps/console/` | React 19、TypeScript、Vite 8 网页管理台 |
| `apps/api/` | Node HTTP API 与 Mock 执行适配器 |
| `packages/agent-core/` | SQLite 状态、审批、Loop、租约、Worktree、模型预算、报告、CLI |
| `packages/tool-kit/` | 受限文件/命令工具及 DockerSandbox |
| `docs/` | 方法论、当前架构、运行知识库、历史审计 |
| `artifacts/` | intent/spec/plan/review/bands/incident 模板 |
| `agents/` | Skills 与确定性 Hooks |
| `evals/`、`tests/` | 评测定义与 Python 门禁回归 |
| `examples/premarket-brief/` | 自包含 Python 示例 |
| `infra/bands.yaml` | 监控控制带样例，非已运行监控服务 |
| `.github/workflows/` | 回归、沙箱、管理台测试及私有部署流程 |

服务器私有部署由本仓库管理，见[部署说明](docs/devos-private-deployment.md)。工作流存在不代表服务器已部署；实际状态需要对应运行证据。

方法论参考：Anthropic [The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)。
