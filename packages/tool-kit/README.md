# Tool Kit · 受限工具与 DockerSandbox

核对日期：2026-11-05。源码入口为 `index.js` 与 `docker-sandbox.js`，验证步骤见[开发指南](../../docs/knowledge/development.md)。

`WorkspaceTools.create` 固定 root、writable、commands 和 authorizeWrite。
路径必须相对工作区；拒绝 .git/.env、越界、符号链接和已有硬链接文件；读写检查常见凭据，记录内容哈希而不记录正文。
写入前由可信回调确认当前任务仍在已审批的 running 状态。

命令只接受配置中的名字，调用者不能追加参数、Shell 或环境变量。使用固定参数、最小环境和进程组；支持超时、取消、输出限额。报告仅记录退出码、信号、耗时和输出哈希，原始输出不保存。

命令默认关闭。`trustedLocal: true` 只用于可信程序/测试样例。命令仍可读写宿主、联网、生成脱离进程组的子进程；路径策略无法约束进程行为。操作存在路径检查与使用间竞态；文件工具也不是针对并发恶意进程的安全隔离。

真实模型命令使用已实现的 DockerSandbox。早期 bwrap 受限是历史环境结果，不代表 DockerSandbox 未实现；当前宿主仍须验证 daemon、镜像与集成测试，不能以 Worktree 或路径检查替代命令隔离。

## 真实文件与测试演示

仓库根目录运行 `npm run demo:workspace`：在临时目录生成固定测试，首次写入错误加法，真实 Node 验证退出 1；确定性修复后退出 0，输出 JSON 报告，最后清理临时目录。

该演示是真实文件/进程执行，但编码决策与审批身份为合成样例，不代表模型自主编码成功。已接线的工作区样例通过 onRecord 将工具元数据保存到 SQLite，报告可跨重启读取；普通工具实例若未接线仍仅有内存记录。原始错误输出不落库，尚无脱敏正文检索服务。

### 证据落库回调

可配置同步 `onRecord(record)`，由应用绑定到当前任务的 `store.recordTool(id, attempt, record)`。回调返回成功后才向调用者确认工具成功。内存 records 仅是辅助；已接线的真实工作区样例使用 SQLite 保存证据。命令启动失败也生成 spawn_failed 记录；原始输出不保存。

文件写入/进程结果与数据库不构成一个跨系统事务；崩溃窗口仍依赖 pending 操作核对，不能声称 exactly-once 或完整安全审计。未接线 onRecord 的普通工具实例仍只保留内存记录。

## Docker OS sandbox

`DockerSandbox` 执行有界参数数组，使用预拉取镜像、禁用网络、只读容器根、移除全部 Linux capabilities、Docker 默认 seccomp、no-new-privileges、内存/CPU/PID 限额及 noexec tmpfs；只将任务 Worktree 挂载为可写目录。运行前后校验当前租约，超时/取消时尝试终止并清理容器。

这里需要区分三类命令：`WorkspaceTools.command` 使用固定名字与参数配置；模型的 `run_command` 提供有界参数数组并由容器隔离，并不是逐命令白名单；`ApprovedPlanEvaluator` 执行批准计划中的固定验证命令。不要将这三种约束混为一谈。

原始命令输出只在可信适配器内存中返回，审计回调仅接收有界元数据和哈希。Docker daemon 与镜像属于可信基础，禁止挂载 Docker socket、宿主 home、凭据或任意宿主路径。Linux 容器隔离不是虚拟机边界，不能直接作为恶意多租户安全承诺。
