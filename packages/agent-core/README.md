# Agent Core · 单机执行核心

核对日期：2026-11-05。当前架构见[当前实现](../../docs/devos/00-文档导航与现状审计.md)，运行与排障见[运行指南](../../docs/knowledge/operations.md)。

Node 24，无第三方依赖。仓库根目录执行：

```sh
npm test
npm run demo:loop
```

演示使用内存数据库、合成审批者和确定性适配器：第一次验证失败，第二次通过。不会调用模型、修改项目文件或产生真实测试证据。

## 适配器契约

`runTask(store, taskId, { runtime, evaluator, timeoutMs, signal })` 只接受已排队或可恢复的运行任务。

- `runtime.execute({ task, operationKey, signal, lease })`：在网关与隔离环境中执行一次工作；成功返回，失败抛出异常。必须响应 AbortSignal、停止子进程并释放资源。
- `evaluator.verify({ task, signal, lease })`：返回 `{ verdict: 'passed' | 'failed', evidence: string }`。只接受可信验证器，恢复可能重跑，须可重复且不修改业务状态。
- 写操作先持久化 pending；完成后记录 finished。pending 恢复时暂停，不自动重放；finished 恢复时进入验证，不重复执行。
- operationKey 用于外部核对，不等同于实现了跨进程 exactly-once 或外部幂等。
- 修复轮数持久化；deadline 首次执行后持久化，重启不重置。暂停等待也消耗该时间预算。
- 取消转 cancelled，异常/预算耗尽转 failed；未运行验证仍是 not_run。

## 边界

执行器通过 SQLite 原子租约串行化同一任务；租约包含递增 fencing token、过期时间和续租事件。每次状态写入/工具证据写入可携带租约，旧 fencing token 或过期租约会被拒绝。`runTask` 自动申请租约并定期续租，退出时释放；进程崩溃后等待 TTL 到期再允许接管。租约是单数据库实例内的并发控制，不是跨主机高可用分布式锁。
适配器不遵守 AbortSignal 时，循环能停止等待，但不能强杀其外部副作用；接入真实工具前必须由沙箱/进程管理层实现强制终止。

已提供 resolvePending、CLI resolve 和网页 Mock 人工核对入口，结构化命令证据、失败原因与累计模型预算也已实现。仍未实现多用户鉴权、独立审批身份、后台自动恢复调度与真实模型任务最终验收。
SQLite 审批事件已包含 actor、产物类别和哈希，但完整不可变审计服务与身份校验仍未实现。

## 持久化证据与报告

`store.recordTool(taskId, attempt, record, lease)` 接收严格元数据 schema；生产适配器必须传入当前租约；拒绝原始 output/content/环境变量及未知字段。通过 `WorkspaceTools.create({ onRecord, assertLease })` 在文件/命令操作前校验租约并同步落库，不改变任务版本。同步持久化失败时工具调用拒绝返回成功；实际副作用仍可能已发生，必须按 pending 检查点核对。

`store.report(taskId)` 原子生成当前状态快照；`store.readReport(reportId)` 读取不可变历史版本。同一任务版本和事件序列重复查询返回同一报告；迟到证据会产生新版本。Loop 退出时自动捕获报告；晚到记录在再次查询时纳入新快照。

报告区分编排器 verification 与真实命令检查结果。没有命令证据时为 not_run；同一修复轮次每个命令取最后一次结果，完整历史仍在 tools 中。需求验收目前统一为 needs_human_review，不能将测试命令通过当作所有需求已验收。

```sh
npm run report -- --db /path/tasks.db --task TASK_ID
npm run report -- --db /path/tasks.db --report REPORT_ID
```

验证器自由文本只存 SHA-256，不持久化正文。此约束针对本版本新写入的验证与工具证据，不追溯清除旧数据库中的历史自由文本。任务/产物文本仍是原有可信入口，未实现通用秘密检测或凭据保管服务。

失败原因、元数据报告、Git Worktree 生命周期、不确定操作核对和 Docker 命令隔离已实现；指定宿主的隔离有效性仍需实际运行 Docker 集成测试。租约数据库依赖 SQLite 所在主机的文件系统语义。SQLite 可被宿主管理员修改，不是防篡改存储。


## Worker 租约与 fencing

`runTask(store, taskId, { runtime, evaluator, workerId, timeoutMs, leaseTtlMs, signal })` 自动获取任务租约。Runtime 和 evaluator 会收到 `lease`；工具网关应在每次读/写/命令前调用 `store.assertLease(taskId, lease)`，并在写入工具证据时传入 `store.recordTool(taskId, attempt, record, lease)`。状态、检查点和验证写入也支持携带 lease。旧 worker 的 fencing token 不能覆盖新 worker 的任务状态。进程崩溃后租约自然过期；pending 外部副作用仍需核对，绝不自动重放。

租约只在同一 SQLite 数据库上提供原子互斥；它不替代 OS 沙箱，也不能阻止绕过工具网关的进程直接写文件。Worktree 生命周期已实现，见下节；不自动丢弃未提交修改。


## Git Worktree 隔离与恢复


`GitWorktreeManager` 为任务创建独立 Git Worktree 和 fencing-token 专属分支；工作树根目录必须与主仓库互不嵌套。`runTask` 可通过 `worktreeManager` 与 `repository` 参数把工作区路径传给 Runtime 和 evaluator。租约失效的旧 Worker 在 WorkspaceTools 的每次文件/命令操作前会被拒绝。恢复时优先复用任务已登记的 ready worktree；pending 外部副作用仍暂停，不自动重放。

工作树会保留供审查，不会在任务结束时自动强制删除。`remove()` 默认只删除 clean worktree；有未提交改动时 Git 会拒绝删除，只有明确传入 `force: true` 才会丢弃。`reconcile()` 根据 `git worktree list --porcelain` 核对创建/删除中断；无法确认的路径标记 orphaned/missing，留待人工处理。该功能是 Git 工作区隔离，不等于 OS 级安全沙箱。


## 不确定操作人工核对


`runTask` 遇到 `checkpoint.operation=pending` 时会暂停，不会自动重放。可信审批入口可调用 `store.resolvePending(taskId, version, { actor, decision, evidence })`：`completed` 表示人工确认外部副作用已完成，恢复后直接进入验证；`not_executed` 表示人工确认未执行，恢复后允许使用原任务/修复轮次的稳定 operationKey 重新执行。系统只保存核对证据的 SHA-256，不保存自由文本。CLI 以 OS 用户/UID 记录操作者；当前网页入口只覆盖单用户 Mock 会话。将来对外提供真实任务 API 时仍须增加身份认证与授权，不能直接暴露内部方法。


## 真实模型 Runtime（Responses API）

OpenAIResponsesRuntime 使用官方 Responses API function calling。CLI 通过 providerConfig 选择宿主进程中的 OPENAI_API_KEY 或 DEEPSEEK_API_KEY，经 HTTPS Bearer 认证；不会写入任务库、工具输出或 Docker 容器环境。模型通过 list_files/read_file/write_file/run_command 四个严格 schema 工具工作；文件工具受工作区路径与当前 lease 约束，命令只在 DockerSandbox 内运行。每轮请求设置 store=false，并把前一响应的全部 output items（包括 reasoning/tool-call items）与 function_call_output 回传，避免丢失上下文。

OpenAI 配置提供 DEVOS_OPENAI_MODEL，DeepSeek 配置提供 DEVOS_DEEPSEEK_MODEL，也可用 --model 指定；可配置 maxTurns、maxToolCalls、maxTotalTokens、maxOutputTokens。若设置 maxCostUsd，必须同时提供当前模型的 input/output 每百万 token 价格，系统不会猜测价格。model.usage 事件仅保存模型名、token 数和估算费用，不保存 API Key 或原始响应正文。

ApprovedPlanEvaluator 只执行已批准 plan JSON 中 verification.commands 列表，独立在 DockerSandbox 运行；未配置验证命令不能通过验收。真实 API 调用需要宿主提供所选供应商 Key 与模型访问权限；ChatGPT 订阅不自动等于 API 额度。此版本通过 mock Responses API 做协议/工具流测试，尚未使用真实 API Key 完成端到端模型任务。


## CLI

### 使用方式与交付边界

真实模型执行入口是单机命令行；网页/API 已有独立的 Mock MVP，尚不能运行真实业务任务。CLI 运行环境为 Linux、Node 24、Git 和可用的 Docker；模型执行还需宿主提供所选供应商的有效 API Key 与模型名称。可以先运行 demo:loop 熟悉状态流，该演示不调用真实模型。

一次任务依次提交 intent（需求目标）、spec（范围与验收标准）、plan（执行计划及验证命令），每阶段由操作者审批。计划批准后，run 创建业务仓库的独立工作树，模型读写文件并在沙箱内执行命令，验证失败时在预算内修复。运行后通过 status 与 report 查看状态、测试证据和累计模型用量，再审查工作树中的 diff。

任务完成不等于业务验收完成，也不会自动提交、推送、创建 PR、合并或部署。上述交付动作仍由操作者审查后执行。命令沙箱默认无网络，真实项目所需依赖与工具必须提前准备；当前默认 Node 镜像不代表已经兼容所有前端项目。至少十项真实模型任务的最终验收仍待完成。

下列 TASK_ID 是 create 输出的任务 ID；intent.md、spec.md、plan.json 是操作者准备的输入文件。将 repository 指向要修改的业务 Git 仓库，worktree-root 指向仓库外的专用目录。


在 Linux 主机安装 Node 24 与 Docker，预先拉取 sandbox image。设置 OPENAI_API_KEY 和 DEVOS_OPENAI_MODEL 后：

```bash
npm run devos -- create --db .devos/tasks.sqlite --title "Add a feature"
npm run devos -- artifact --db .devos/tasks.sqlite --task TASK_ID --kind intent --file ./intent.md
npm run devos -- approve --db .devos/tasks.sqlite --task TASK_ID
npm run devos -- artifact --db .devos/tasks.sqlite --task TASK_ID --kind spec --file ./spec.md
npm run devos -- approve --db .devos/tasks.sqlite --task TASK_ID
npm run devos -- artifact --db .devos/tasks.sqlite --task TASK_ID --kind plan --file ./plan.json
npm run devos -- approve --db .devos/tasks.sqlite --task TASK_ID
npm run devos -- run --db .devos/tasks.sqlite --task TASK_ID --repository "$PWD" --worktree-root "$HOME/.devos/worktrees" --max-total-tokens 50000
npm run devos -- status --db .devos/tasks.sqlite --task TASK_ID
npm run devos -- report --db .devos/tasks.sqlite --task TASK_ID
```

Plan artifact 必须是 JSON，并提供已审批的 verification.commands，例如：
```json
{"verification":{"commands":[{"name":"unit","command":["npm","test"],"timeout_ms":120000},{"name":"lint","command":["npm","run","lint"],"timeout_ms":120000}]}}
```
可选传入 max-cost-usd 时，必须同时提供该模型当前的 input/output 每百万 token 价格；没有价格时仍按 token、轮数和命令超时预算停止。CLI 的审批 actor 自动取自本机 OS 用户名与 UID，模型工具没有 approve/resolve 能力；这是单机 OS 身份边界，不是远程多用户认证。数据库默认单主机 SQLite，不支持多主机并发部署。

## 任务累计模型预算

模型用量、请求意图和预算策略写入任务事件。Token、估算费用、请求轮数、工具次数跨修复轮次和 Runtime/数据库重启累计；同一任务不能通过更换配置提高额度或更换模型/价格来重新计算已发生的消耗。报告的 `modelUsage` 返回累计用量、预算策略和用量不明的请求数。未配置价格时估算费用为 null。

模型响应缺失用量、用量字段无效，或请求中断且未获得用量时，拒绝执行响应中的工具，也拒绝自动重新请求。该状态需要运维核对供应商计费后处理，目前没有自动清账或重置入口。可信内部事件记录仍不等于防篡改账单。

费用与 Token 上限是在获取本次 API 响应用量后停止后续请求/工具，**不是供应商账单的硬上限**：输入 Token 和中断请求的实际计费可能超出剩余额度。需要硬性支出上限时还需供应商账户限额或保守的请求前额度预留；未将此项标记为最终验收完成。

## DeepSeek 与网页入口

CLI 可指定 `--provider deepseek`，使用 `DEEPSEEK_API_KEY` 和 `DEVOS_DEEPSEEK_MODEL`；默认 provider 取 `DEVOS_PROVIDER` 或 openai，不自动回退。端点定义见 `providers.js`，真实供应商兼容性仍需实际任务验证。

网页通过 `npm run build:console`、`npm run start:console` 启动，默认 `http://127.0.0.1:3001`。它使用 `.devos/console/tasks.sqlite` 与固定样例目录，不导入 CLI 历史任务、不创建业务 Worktree、不调用模型。完整 API 见[接口说明](../../docs/devos/03-核心流程与接口契约.md)。
