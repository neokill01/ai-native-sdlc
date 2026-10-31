# Tool Kit · 受限工具原型

`WorkspaceTools.create` 固定 root、writable、commands 和 authorizeWrite。
路径必须相对工作区；拒绝 .git/.env、越界、符号链接和已有硬链接文件；读写检查常见凭据，记录内容哈希而不记录正文。
写入前由可信回调确认当前任务仍在已审批的 running 状态。

命令只接受配置中的名字，调用者不能追加参数、Shell 或环境变量。使用固定参数、最小环境和进程组；支持超时、取消、输出限额。报告仅记录退出码、信号、耗时和输出哈希，原始输出不保存。

命令默认关闭。`trustedLocal: true` 只用于可信程序/测试样例。命令仍可读写宿主、联网、生成脱离进程组的子进程；路径策略无法约束进程行为。操作存在路径检查与使用间竞态；文件工具也不是针对并发恶意进程的安全隔离。

真实模型/不可信代码接入前必须实现 OS 沙箱。当前环境 bwrap 启动实测报 `Failed to create NETLINK_ROUTE socket: Operation not permitted`；未通过沙箱验收，不能对外宣称安全执行。

## 真实文件与测试演示

仓库根目录运行 `npm run demo:workspace`：在临时目录生成固定测试，首次写入错误加法，真实 Node 验证退出 1；确定性修复后退出 0，输出 JSON 报告，最后清理临时目录。

该演示是真实文件/进程执行，但编码决策与审批身份为合成样例，不代表模型自主编码成功。工具记录在内存中；完整跨重启工具审计、报告持久化与错误输出脱敏检索尚待实现。

### 证据落库回调

可配置同步 `onRecord(record)`，由应用绑定到当前任务的 `store.recordTool(id, attempt, record)`。回调返回成功后才向调用者确认工具成功。内存 records 仅是辅助；已接线的真实工作区样例使用 SQLite 保存证据。命令启动失败也生成 spawn_failed 记录；原始输出不保存。

文件写入/进程结果与数据库不构成一个跨系统事务；崩溃窗口仍依赖 pending 操作核对，不能声称 exactly-once 或完整安全审计。未接线 onRecord 的普通工具实例仍只保留内存记录。

## Docker OS sandbox

DockerSandbox runs allowlisted argument arrays in a pre-pulled image with network disabled, a read-only container root, all Linux capabilities dropped, no-new-privileges, bounded memory/CPU/PIDs, a noexec tmpfs, and only the task worktree mounted read-write. It passes only a minimal environment and requires a live task lease guard before and after execution. Raw command output is returned in memory to the trusted adapter, while the audit callback receives only bounded metadata and hashes.

The Docker daemon and image are part of the trusted computing base. The host must protect access to the Docker socket; never mount the Docker socket, host home, credentials, or arbitrary host paths into the container. This is Linux container isolation, not a VM boundary; use a hardened daemon/VM for hostile multi-tenant workloads.
