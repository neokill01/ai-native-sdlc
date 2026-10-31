# 本地实施进展 · 2026-10-30

分支：docs/agentic-devos-v1。main 未修改，远端未推送。

## 已实现

- 保留三个 Shell Hook 入口，以 Python 标准库统一解析、验证和扫描；解析及资源读取错误拒绝。
- 路径规范化、工作区边界及符号链接约束；修复通用凭据匹配；补充常见 prod 变更命令识别。
- 评测定义校验、执行错误传播、独立临时日志与 REVIEW/SKIP 统计。
- 新增零第三方依赖 Node workspace，agent-core 提供 SQLite 事务型状态机、版本检查、产物哈希审批、下游审批失效、事件记录、有限修复及恢复读取。

## 验证证据

- 修复前新增的六个 Python 回归测试共出现 14 个断言失败，复现原问题；修复后六个全部通过。
- 四个 Node 核心测试通过：门禁/过期版本、审批失效、修复预算/验证证据、数据库重新打开后的状态与事件保留。
- 既有 20 个 Python 示例测试通过（全量 eval 内运行）。
- 完整 eval：PASS=2 FAIL=0 REVIEW=1 SKIP=0，RESULT=REVIEW；API 安全清单仍待人工审查。
- `npm run check` 为 JavaScript 语法检查，不是 TypeScript 类型检查。

## 实施取舍与边界

架构 v1.0 的 TypeScript/PostgreSQL 为建议方案；本轮只用 Node 24 自带 SQLite 和 JavaScript 验证本地领域行为，无安装依赖。后续确定运行接口后迁移 TypeScript。

当前尚无 CLI/API/Worker、模型适配器、代码工具、Sandbox、费用/时长预算、外部操作幂等、自动恢复调度或 Web 页面。
数据库恢复验证仅代表状态可重新读取及手动续转，不代表执行进程中断后自动恢复。

TaskStore 是可信内部领域模块，actor 和验证证据由调用者提供，未鉴权、未独立核验；不能暴露为用户直接调用的 API。
事件保留任务转移和版本；审批主体/哈希保存在任务快照，完整不可变审批审计仍需扩展。
路径检查不能消除检查到使用间的竞态，不能替代 OS 级隔离。生产命令检测仍为启发式，禁止视为完整生产权限控制。

## 下一步

1. 明确任务 API 身份边界，扩展独立审批审计和验证器可信入口。
2. 引入确定性 Runtime 测试适配器，验证有限编码/验证/修复循环和取消、超时、恢复语义。
3. 接入受限工具网关、真实 Sandbox、成熟 Coding Harness；真实 Agent 任务成功后才统计 P1 完成度。
4. 写权限恢复后推送当前分支、创建草稿 PR，再核实 CI；不自动合并 main。

## 后续增量：确定性 Loop

- 新增 runTask 编排器及 `npm run demo:loop`；执行→验证→有限修复可运行。
- 支持 AbortSignal 取消、持久化 deadline、操作 pending/finished 检查点。
- 不确定操作暂停；已完成操作恢复时不重复执行；验证阶段恢复只重跑可重复验证。
- 审批历史事件新增 actor、kind、hash，修复先前仅快照保留的问题。
- Node 核心测试扩展为 11 项并通过；六项门禁回归与既有示例评测通过，完整 eval 仍为 REVIEW。
- 上一提交 c328faa 的远端 run 41000554611 两个 jobs 均 success；后续提交的 CI 需单独核验。

仍仅为确定性原型，不代表真实模型自主开发成功。并发租约、强制进程终止、不确定副作用核对入口、费用预算和真实沙箱仍待实施。详见 packages/agent-core/README.md。

## 后续增量：受限工具与真实验证样例

新增 tool-kit，提供读写路径范围、链接/敏感路径拒绝、审批回调、内容哈希和固定命令配置。命令执行限制时间与输出，取消时终止进程组，最小环境不继承宿主凭据。

`npm run demo:workspace` 已实测：临时目录内首次写入错误实现→Node 真实测试退出 1→修复→退出 0。报告含命令、退出码、耗时、输出哈希和两次文件内容哈希。无模型调用，固定测试样例不能计为真实 Agent 成功率。

本轮 Node 测试共 17 项通过；语法检查通过。前一提交 a07bbad 的远端 CI 状态另行查询。

**阻塞**：当前环境 bwrap 网络命名空间创建被权限拒绝，未提供 OS 沙箱。命令默认拒绝，仅可信样例显式启用本地模式。真实 Harness、费用预算、鉴权/API/控制台、工作树、跨进程恢复与审计持久化尚未完成；P1 不能标记完成。

## 2026-10-31：Issue #5 本地实现

- 新增严格元数据审计 schema、SQLite tool.recorded 事件、任务/修复轮次/operationKey 绑定。
- 新增 reports 表及不可变报告快照；按任务版本和事件序列去重，旧报告可按ID查询，重启保留。
- Loop 正常/失败/取消/超时退出自动捕获报告，晚到证据查询时生成新版本。
- 报告包含命令检查的 passed/failed/not_run、审批来源、内容/输出哈希；需求验收独立为 needs_human_review。
- 验证器自由文本改存哈希；持久化schema拒绝原始输出及额外字段。命令启动失败和审计写入失败有回归测试。
- 新增 `npm run report -- --db FILE --task ID` 或 `--report ID` 入口。
- 本地 Node 测试 24 项通过；后续远端 CI 以本次提交实际运行结果为准。

边界：仍为可信单Worker原型；数据库不防宿主篡改，文件/进程副作用与审计写入非跨系统事务。审批/产物文本入口和旧数据库历史文本未做通用清洗。真实模型/OS沙箱仍阻塞，P1整体未完成。

## 2026-10-31：P1 Sprint 2——独占租约、Git Worktree 与不确定操作核对

- 新增 SQLite task lease 与单调递增 fencing token；原子获取、续租、释放、过期接管均写入任务事件。runTask 自动申请租约、心跳续租并在退出时释放；状态变更、检查点、验证与工具证据支持携带租约，旧 fencing token 被拒绝。
- WorkspaceTools 增加 assertLease，在文件读取、写入和命令启动前校验当前租约；可信示例与报告测试已使用当前 lease。
- 新增 GitWorktreeManager：每个任务创建独立 worktree 和 fencing-token 分支；工作树根目录要求 0700、当前用户所有，并与源仓库互不嵌套。SQLite 持久化 worktree 状态，支持创建/删除中断后的 git worktree list --porcelain 核对。
- runTask 可接入 worktree manager，并把 workspace 路径传给 Runtime/evaluator。任务结束保留 worktree 供审查；删除默认拒绝 dirty worktree，不自动强制丢弃改动。
- 新增 resolvePending 人工核对入口：需 actor、decision 和证据；只保存证据哈希。确认已完成则恢复到验证；确认未执行才允许使用原 operationKey 重试；未知状态继续暂停。
- GitHub Actions agent-core job 在提交 8e19ae6 上实际通过：40 项 Node 测试，0 失败；npm run check 和 npm run test:guards 均通过。该 workflow 的自托管 evals job 仍排队，不能把整个 workflow 标记为通过。

边界：SQLite 租约只适用于共享同一数据库文件的单主机/单实例，不是多主机分布式锁；Git Worktree 是版本控制工作区隔离，不是 OS 沙箱。bwrap 隔离仍被当前环境权限阻止，真实模型 Harness 尚未接入。Issue #6 的功能实现已完成，待本轮完整 CI 收尾核验后关闭。