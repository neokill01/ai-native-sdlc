# 开发与验证

核对日期：2026-11-05｜来源：根 `package.json`、各 workspace、`.github/workflows/`。

## 环境与启动

- Node.js 24+、npm；Python 3 用于 Hooks/Evals；Git 用于 Worktree。
- 核心与 API 使用 Node 内置模块；前端依赖使用根 `package-lock.json`，安装用 `npm ci`。
- Mock 不需要 Docker/API Key。真实模型任务需要 Linux、可用 Docker daemon、预拉取测试镜像和供应商凭据。

```bash
npm ci
npm run build:console
npm run start:console
```

本地地址 `http://127.0.0.1:3001`。开发时分别运行 `npm run dev:api` 与 `npm run dev:console`；前端 5174 代理 `/api` 到 3001。数据默认在仓库根 `.devos/console/`，不随 workspace 工作目录变化。

## 检查命令与含义

| 命令 | 验证内容 |
|---|---|
| `npm run check` | 核心 JS 文件语法，不是 TS 检查或完整 lint |
| `npm test` | 核心、CLI、工具和 Docker 测试；Docker 不可用时可跳过集成项 |
| `npm run test:guards` | Python Hook 与 Eval runner 回归 |
| `npm run eval` | repo eval；REVIEW/SKIP 不等于通过 |
| `npm run test:console` | 本地 HTTP API 与 Mock 集成 |
| `npm run build:console` | TypeScript 检查与 Vite 构建 |
| `npm run test:console:e2e` | Playwright 网页流程，需浏览器及系统依赖 |
| `DEVOS_REQUIRE_DOCKER=1 npm run test:sandbox` | 强制要求 Docker 隔离测试；缺 daemon/镜像应失败 |
| `npm run demo:loop` | 无模型、确定性内存演示 |
| `npm run demo:workspace` | 无模型、临时文件与真实命令的失败→修复演示 |
| `npm run preflight` | 当前主机只读基础检查，不代表沙箱或远程服务器验收 |

浏览器准备：`npx playwright install --with-deps chromium --only-shell`；Linux 系统依赖安装可能需要管理员权限。若只缺浏览器包，可按现有系统依赖选择不带 `--with-deps` 的安装方式。

修改范围决定所需检查；文档改动检查链接、命令与代码一致性即可，不为同义文案新增镜像实现的测试。API/核心变更须跑对应回归，前端变更须构建并验证相关流程。

## CI

`agent-evals.yml` 提供 evals、agent-core、sandbox、console 四个 job，使用 GitHub 托管 Ubuntu；sandbox 强制 Docker，console 安装锁定依赖并执行构建/API/浏览器。PR 路径过滤见 YAML，并非所有文档修改都会触发全部回归。定时与手动触发也已配置；不要依据“有 YAML”判断某次提交已通过。

`devos-preflight.yml` 与 `devos-private-deploy.yml` 是独立私有服务器工作流，需要本仓库 Actions Secrets；不要为验证文档而触发部署。

## 本轮实测记录

日期：2026-11-05。代码基线 `acb54b1`；Debian 13、Node 24.22.1、Python 3.12.14。

| 命令 | 结果 |
|---|---|
| `npm test` | 57 passed、0 failed、6 skipped（Docker 集成未运行） |
| `npm run test:console` | 5 passed、0 failed |
| `npm run test:guards` | 6 passed |
| `npm run check` | 核心 JS 语法检查通过 |
| `npm run eval` | PASS=2、FAIL=0、REVIEW=1、SKIP=0；RESULT=REVIEW，安全清单仍待人工审查 |

初次受限沙箱执行出现 Node 原生断言/子测试失败；为测试进程开放命令级网络权限后，上表三个命令通过。未修改代码以规避限制，不将初次环境失败当成已定位的业务缺陷。精确根因未进一步诊断。

本表不覆盖真实模型调用、前端构建/浏览器、Docker 隔离或服务器上线状态。后续验证应记录当次提交与结果，不把历史测试数量作为永久标准。
