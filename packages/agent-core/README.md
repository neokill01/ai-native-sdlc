# Agent Core 原型

Node 24，无第三方依赖。仓库根目录执行：

```sh
npm test
npm run demo:loop
```

演示使用内存数据库、合成审批者和确定性适配器：第一次验证失败，第二次通过。不会调用模型、修改项目文件或产生真实测试证据。

## 适配器契约

`runTask(store, taskId, { runtime, evaluator, timeoutMs, signal })` 只接受已排队或可恢复的运行任务。

- `runtime.execute({ task, operationKey, signal })`：在网关与隔离环境中执行一次工作；成功返回，失败抛出异常。必须响应 AbortSignal、停止子进程并释放资源。
- `evaluator.verify({ task, signal })`：返回 `{ verdict: 'passed' | 'failed', evidence: string }`。只接受可信验证器，恢复可能重跑，须可重复且不修改业务状态。
- 写操作先持久化 pending；完成后记录 finished。pending 恢复时暂停，不自动重放；finished 恢复时进入验证，不重复执行。
- operationKey 用于外部核对，不等同于实现了跨进程 exactly-once 或外部幂等。
- 修复轮数持久化；deadline 首次执行后持久化，重启不重置。暂停等待也消耗该时间预算。
- 取消转 cancelled，异常/预算耗尽转 failed；未运行验证仍是 not_run。

## 边界

单 Worker 原型，没有分布式租约。不得同时启动同一任务的多个执行器。
适配器不遵守 AbortSignal 时，循环能停止等待，但不能强杀其外部副作用；接入真实工具前必须由沙箱/进程管理层实现强制终止。

不确定操作暂停后仍需人工核对和恢复入口，当前未提供 reconciliation API。失败原因分类、费用预算、结构化命令证据、鉴权、审查和真实 Harness 接入尚未实现。
SQLite 审批事件已包含 actor、产物类别和哈希，但完整不可变审计服务与身份校验仍未实现。
