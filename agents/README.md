# Agents：护栏（Guards）

> 方法论里，agent 的执行需要两种护栏，合起来实现"**Skill 让违规变少见，Hook 让违规几乎不可能**"：
>
> - **Skills**（`agents/skills/`）—— **建议性**机构知识：告诉 agent 该怎么做、用什么规范、跑什么检查。版本控制、随代码分发、可被注意但也可被忽略。
> - **Hooks**（`agents/hooks/`）—— **确定性**护栏：在 agent 的每个工具操作上**强制**执行，违反即拦截。Skill 之后必须无条件执行的策略，就要用 Hook 兜底。

## 目录契约

```
agents/
├── skills/
│   └── <skill-name>/
│       └── SKILL.md          # 一份可被 agent 读取并执行的指令（frontmatter: name/description/适用场景）
└── hooks/
    └── <hook-name>.sh        # 一个确定性脚本；exit 0 = 放行，exit 2 = 拦截
```

## Registering / 注册方式

方法论**工具无关**，注册方式取决于你的 agent 工具。`SKILL.md` 的 `name/description` 已按通用约定写，方便各工具识别。

| 工具 | Skill 放哪 | Hook 怎么注册 |
|---|---|---|
| Claude Code | `<repo>/.claude/skills/<name>/SKILL.md` | `.claude/settings.json` 的 `hooks.PreToolUse/PostToolUse/Stop`，命令指向 `agents/hooks/*.sh` |
| DeepSeek Harness (DSH) | agent preset / 可由 skill 系统加载（见 `docs/playbook.md` 第 4 节映射） | Cordis 插件在宿主侧拦截工具调用/审批（等价物），或沙箱/审批层做写前门禁 |
| Codex (OpenAI) | `AGENTS.md` / 仓库规则 + skill | 其审批/沙箱机制，对照本 hook 的判定逻辑 |

> 通用约定：hook 脚本从 stdin 读一段描述操作的 JSON（至少含 `tool_input`），据判定返回 `0`（放行）或 `2`（拦截并写 stderr）。工具-无关的**判定逻辑**是这一层要固化的东西；工具-相关的**触发点**在注册表里配置。

## 使用规则

- 把"需要一致性执行的机构知识"写成 skill（如 API 安全标准、可配置参数规则）。
- 把"必须无条件执行的策略"用 hook 兜底（如生产部署授权、冻结路径保护、凭证挡在 diff 外）。
- Hook 要在**每个匹配操作上运行**，所以要**快**、范围限定在改动的文件上；更重的检查（如全量测试）放 commit/PR 阶段。
- 同一个错误 agent 犯第二次，就把它写进 `AGENT.md`（≈ `CLAUDE.md`）和对应 skill；若需"几乎不可能违规"，再加 hook。
