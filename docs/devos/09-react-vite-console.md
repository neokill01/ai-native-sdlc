# React + Vite 工程管理端 · Mock MVP

2026-11-05 已按当前 API 与前端核对。完整接口见[流程与契约](03-核心流程与接口契约.md)，本次验证与历史证据区分见[开发指南](../knowledge/development.md)。

## 当前交付

- React 19 + TypeScript 严格检查 + Vite 8；Node 24 HTTP API；SQLite 复用原 TaskStore。
- npm workspaces 管理 apps/console、apps/api 和 packages；依赖版本与根 lockfile 固定，CI 用 npm ci。
- 工作概览、项目关联视图、任务列表、状态筛选/搜索、新建任务与详情抽屉。
- 需求/规格/计划逐阶段审批；当前产物可编辑、保存，审批绑定产物哈希；过期任务版本拒绝写入。
- 执行器运行在后端，关闭页面不会取消任务。取消使用 AbortSignal；报告、工具证据和事件均持久化。
- 手动恢复入口复用核心 pending 核对能力；没有证据的中断操作不能自动重放。重启后的恢复必须等待旧租约失效，人工点击恢复，不提供自动后台调度。
- 下载 JSON 报告，显示真实命令退出码、有限修复轮次和待人工验收状态。

## 模式边界

当前只有 Mock 模式，网页不能启动真实模型或任意命令。关联项目是服务端固定目录条目，不接受客户端提交本地路径或命令。

Mock 在 `.devos/console/workspaces/<task-id>/` 的独立目录写固定 add 函数；执行固定 Node 断言，第一次失败、修复一次后通过。它复用了真实状态机、审批、租约、文件网关、命令和报告，并非纯前端假数据；但没有实现业务需求，也没有修改所选项目的 Git 仓库，没有创建该项目的 Git Worktree 或 PR，更没有部署业务网站。

任务只显示从此管理端创建的记录；本版不会导入旧 CLI 数据库。项目登记/删除、自定义仓库路径、Git Diff/PR 操作、真实模型与沙箱接入、多用户登录和独立队列 Worker 均待后续实现。

## 运行

要求 Node 24+、npm、Python 3（已有门禁测试）；Mock 不需要 Docker 或模型 Key。

在仓库根目录：

```bash
npm ci
npm run build:console
npm run start:console
```

打开 http://127.0.0.1:3001 。单个 Node 服务同时提供构建后的 React 页面和 API。

开发时使用两个终端：

```bash
# 终端 1
npm run dev:api
# 终端 2
npm run dev:console
```

前端地址 http://127.0.0.1:5174 ，Vite 代理 /api 到 3001。数据库路径不会因 npm workspace 的工作目录变化而改变，默认始终为仓库根目录 `.devos/console/tasks.sqlite`；可通过服务端环境变量 DEVOS_DATA_DIR 指定独立目录。

首次打开没有预置业务结果。点击“创建示例任务”或“新建任务”，逐阶段查看/编辑并批准产物，启动 Mock 后观察执行。报告中的业务需求验收始终为待人工审查，命令通过不等于业务已实现。

## 访问与数据

服务仅监听 127.0.0.1；每次服务启动生成内存会话 Token，网页通过同源 session 入口获取，写入请求绑定服务器会话。API 检查 Host/Origin，拒绝未知字段、客户端命令/路径及过期版本；页面使用同源 CSP。SQLite 文件以 0600 创建，运行数据忽略提交。

这些约束是本机单用户开发边界，不是完整身份认证。不要把端口直接绑定 0.0.0.0，不要在未增加登录认证、反向代理策略、TLS 与持久服务管理前公开部署到腾讯云。本轮未改官网 nginx、部署密钥或公网安全组。

浏览器关闭时后端任务继续；Node 进程退出后任务不会继续计算，状态/证据保留，恢复时按核心租约和检查点规则核对。

## 验证

```bash
npm test                    # 原核心回归
npm run test:console         # API 集成
npm run build:console        # TS 检查 + Vite 构建
npx playwright install chromium --only-shell
npm run test:console:e2e     # 完整网页流程（需 Chromium 运行依赖）
```

历史交付验证记录（非本次重跑）：核心测试 57 通过、6 Docker 跳过；5 项 API 集成通过；1 项完整浏览器场景通过，覆盖编辑/审批、关闭页面后继续执行、重开报告、真实失败/修复证据和手机布局。6 项 Python 门禁通过；既有 Evals 为 PASS=2 FAIL=0 REVIEW=1。报告中的 API 安全清单仍待审查，不标为通过。

后续范围：先让用户体验并校准此管理流程，再评估工作区 Diff、真实模型执行、身份隔离与腾讯云独立部署；当前不标记整个 Agentic DevOS 项目结项。

## 私有服务器部署准备

服务可用 DEVOS_PORT 指定 1024–65535 的 loopback 端口，默认 3001；端口冲突时不停止其他服务。服务器的系统 Node 22 保留；部署包携带独立 Node 24 运行时，React 在 CI 预先构建，服务器不安装前端依赖。

部署使用独立目录 /opt/agentic-devos、持久目录 /var/lib/agentic-devos、无登录权限服务用户与 systemd；先进行容量/端口检查，启动失败回滚代码和原服务文件。初期只通过 SSH 本地转发访问，不修改官网 nginx 或开放公网管理接口。该阶段不等于已完成公网登录认证。
