# DevOS 私有服务部署

管理端源码、构建、服务器预检及部署由 `neokill01/ai-native-sdlc` 统一管理。智创码坊官网仓库仅负责官网，不再承载 DevOS 运维流程。

## 首次配置与运行

1. 在本仓库 Settings → Secrets and variables → Actions 配置 `SERVER_HOST` 与 `SERVER_SSH_KEY` 两个 Repository secrets。使用有服务器 SSH 和免密 sudo 权限的 `ubuntu` 用户对应凭据；不要把实际值写进代码、Issue、PR 或聊天。GitHub 仓库级 Secrets 不会随工作流迁移自动共享。
2. 在 Actions 手动运行 **DevOS server preflight**，确认资源、专用端口 4317、systemd 与免密 sudo 可用。预检只读取服务器状态。
3. 在 Actions 的 **Deploy DevOS private console** 选择 `main` 运行。该工作流自身合入 main 时也会尝试部署；缺少凭据时在连接服务器前明确失败。配置 Secrets 后需手动重跑。

部署只允许 main，构建当前运行的提交（写入 `RELEASE_COMMIT`），不跨仓库检出或固定旧版源码。CI 构建 React 并测试 API，打包零第三方运行依赖的 API；服务器下载独立 Node 24.22.2，校验固定官方 SHA-256 后缓存复用。CI 只上传应用包，按 SHA-256 核验。部署串行执行，不取消正在切换服务的部署。

## 服务与验证

服务名 `agentic-devos`；代码 `/opt/agentic-devos/current` 指向版本目录，数据 `/var/lib/agentic-devos` 持久保存。专用无登录用户、384 MiB 内存上限、半核 CPU 配额，仅监听 `127.0.0.1:4317`。启动使用 `--preserve-symlinks-main` 保证版本软链接入口运行。预检要求当前可用内存至少 512 MiB、空闲磁盘至少 1 GiB；无关服务占用端口则停止。

启动后运行固定 Mock 样例，验证真实命令退出码 1→0、一次修复、报告保留和未认证访问被拒绝。样例仅为部署自检，业务验收仍为 `needs_human_review`。切换失败时恢复原私有服务版本。代码回滚不回退数据库；以后涉及数据格式变更时须另行制定数据备份和迁移方案。

不替换系统 Node，不修改官网目录、nginx 或安全组。迁移工作流不会停止既有服务或删除数据；凭据尚未配置时，已部署服务仍独立运行。

## 访问

本阶段通过服务器 SSH 权限访问，在自己的电脑建立隧道：

```bash
ssh -N -L 4317:127.0.0.1:4317 ubuntu@YOUR_SERVER
```

随后在同一电脑浏览器打开 http://127.0.0.1:4317 。两端端口需一致以满足 Host 校验。手机公网访问需要后续增加登录认证与受保护 HTTPS 入口。
