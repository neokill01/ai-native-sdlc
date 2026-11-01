# DeepSeek + 腾讯云 + 智创码坊试点准备

日期：2026-11-01。状态：接入准备完成，未连接用户服务器、未调用真实模型。

## 已核实的试点仓库

https://github.com/neokill01/zhichuangmafang

已读取 README、AGENTS.md、部署工作流与菜单代码。该项目为纯 HTML/CSS/JavaScript，无 package.json，无构建步骤；正式站点由 GitHub Actions 部署至腾讯云 nginx，不是 GitHub Pages。修改 main 的站点文件会自动部署，所以试点在独立分支/工作树执行，最终只提交 PR，禁止自动合并或部署。

首个拟定任务：补齐移动端菜单的 aria-expanded、aria-controls，Escape 关闭并将焦点返回菜单按钮；点击链接关闭时同步状态。保留样式、统计脚本、联系入口、备案链接与 data-track。按钮已有原生 Enter/Space 行为，不重写键盘默认行为。

验收：现有 desktop/mobile Playwright 用例全部通过；新增展开状态、Escape 关闭与焦点返回测试；审查 diff；按仓库规范更新静态资源版本参数。尚未修改网站业务代码，也未标为任务通过。

依赖限制：现有 Node 基础镜像不包含 Playwright/Chromium，仓库无锁文件。先制作并固定测试镜像和依赖，保证无网络容器内可离线运行；不能把 node --check 当成完整网页验收。

## DeepSeek 配置

官方文档：https://api-docs.deepseek.com/guides/responses_api/
模型与价格：https://api-docs.deepseek.com/quick_start/pricing/

当前官方 Responses 端点为 https://api.deepseek.com/responses，支持 function calls、reasoning 回传及用量字段。新增 --provider deepseek，使用 DEEPSEEK_API_KEY 和 DEVOS_DEEPSEEK_MODEL；默认 OpenAI 配置保持兼容，禁止跨供应商自动回退。

仅在宿主安全配置密钥，不把它加入业务仓库、plan、容器或命令参数。建议模型先选 deepseek-flash，正式调用时再次核对可用性。未默认填写价格；--max-cost-usd 仍要求显式输入美元计价的模型单价，不能混入人民币价格。缓存/时段差价按保守输入价估算，不代表供应商账单硬上限。

准备完成后，在已创建并审批的任务上运行：

```bash
npm run devos -- run --provider deepseek --model deepseek-flash \
  --db /srv/devos/data/tasks.sqlite --task TASK_ID \
  --repository /srv/devos/repos/zhichuangmafang \
  --worktree-root /srv/devos/worktrees \
  --max-total-tokens 20000 --max-turns 8 --max-tool-calls 16
```

TASK_ID 必须替换为真实任务 ID；命令仅为准备示例，需先解决验证镜像、审批和凭据配置。

## 腾讯云只读检查

在目标服务器上的本项目目录执行（需要 Python 3）：

```bash
python3 scripts/server-preflight.py
```

脚本不安装软件、不更改 nginx/防火墙、不读密钥、不调用模型。返回 CPU、总/可用内存、当前磁盘剩余量、Node 24+、Git 与 Docker daemon 状态。其 readyForSandboxTest 只表示基础工具可用，不表示隔离验收或容量压测通过。

容量先以单任务并发评估：2 核、4 GiB 内存和 15 GiB 空闲盘作为初步规划值，非强制最低配置。已有 nginx 业务负载、容器内存、镜像/依赖/浏览器占用和空闲内存均须实测。模型运行在供应商侧，无须在腾讯云加载模型权重或安装 GPU。

本会话尚无服务器连接。网站仓库已有 SERVER_HOST 和 SERVER_SSH_KEY 的 Actions 引用，但不能读取 GitHub Secret 明文；不尝试从历史提交提取服务器 IP/凭据，也不启动现有部署 workflow 充当容量检查。

下一步需用户提供腾讯云配置页截图（核数、内存、系统盘/剩余空间、系统版本；可遮挡 IP），或在服务器运行只读脚本后返回结果。服务器连接和 DeepSeek Key 通过安全运行环境配置，不能写进聊天/仓库。

## 本地验证

57 项 Node 测试通过，6 项 Docker 集成测试因本开发容器没有 Docker 而跳过。包括 DeepSeek 端点/凭据选择、工具与推理上下文回传；均为模拟 HTTP，不代表真实 DeepSeek API 或腾讯云已验证。preflight 已在本开发容器运行，其资源数据不能当作用户腾讯云配置。
