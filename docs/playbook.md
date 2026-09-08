# AI-Native SDLC Playbook（适配版）

> 依据 Anthropic 官方《[The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)》（Louis Claxton, Anthropic Applied AI）改编。
> 本版做了三处裁剪与转译：**① 从"企业组织"适配到个人/小团队；② 从 Claude 全家桶改为"工具无关"表述 + DeepSeek Harness（DSH）映射；③ 中文为主，关键术语保留英文对照。**
> 定位：一套可复用的**方法体系**，不是某个工具的插件。产物模板见 `../artifacts/`，成熟度阶梯见 `adoption.md`。

---

## 0. 这套方法论是什么 / What this is

传统 SDLC 的前提是"**写代码是最耗时、最费钱、最难的阶段**"，所以围绕它建了很重的审批、评审、交接。**这个前提现在不成立了。** 当 agent 把构建阶段跑得飞快时：

1. **瓶颈转移到了构建阶段的两侧**（规划、审查/测试、部署还在以人的速度跑）；
2. **逐行审查跟不上 agent 的 diff 产出量**；
3. **治理成本上升**，因为例外还是要走每周/每月的会。

AI-Native SDLC 把线性流程改成**循环**：AI 嵌入每个节点，人留在"需要判断力的门禁"上，**审查 agent 标记出的产物，而不是陪跑每次编辑**。

> 核心一句话：**代码不再稀缺，稀缺的是"准确定义意图"和"在门禁上有效把关"的人的注意力。** 这套工程把这两件事变成可执行的门禁与产物。

---

## 1. 核心机制：提交的产物（Committed artifact）

贯穿全部游戏的唯一主轴：**每个阶段结束时往版本控制提交一件产物，下一阶段从读取这件产物开始。**

```
intent.md → spec.md → plan.md → (代码 diff + 测试) → 带审查结论的 PR → 事故记录 → 回到 intent.md
```

- 早期产物是 `.md`（人和 agent 都能读、都能用）；构建阶段之后产物变成**代码及其记录**。
- 这条 commit 链**本身就是审计链**：谁提的需求、agent 产出了什么、谁批了它。
- 早期各阶段由人手动触发；最终态是"每个审核通过的产物**自动触发**下一个门禁"。

**人的注意力随需要审查的产物一起转移。** 产物模板见 `../artifacts/`。

---

## 2. 六个阶段 / The six phases

> 采用顺序是**模块化**的：可从任意"没有箭头指入的 play"开始，按需改造不同阶段。各阶段产物、门禁、治理、DSH 映射如下。

### 阶段 1 · 规划（Plan）— 用 `intent.md` 捕获意图

- **目的**：把模糊想法变成一段"人能懂、agent 也能消费"的 Markdown。
- **入口**：人的想法 / 工单 / 告警事故；从任意入口进来。
- **怎么做**：发起人用大白话描述问题 → 反复头脑风暴直到具体（agent 会追问范围/用户/约束/怎么算成功）→ 按模板写成 `intent.md`（模板可编码为 skill）→ 修正理解偏差 → 提交。
- **产物**：`intent.md`（含作者、时间戳、修订历史，随 commit 入 git）。
- **门禁（人做）**：产品负责人审批。接受=合并 PR/关闭审查；拒绝=关闭并写明理由。
- **治理**：证据就是提交的 intent.md；仓库建好后，无 git 经验的人不必直接操作 git（可用连接器代理提交）。
- **DSH 映射**：用 `docs/` 里维护意图；agent preset 里放"提问澄清清单"；可用子代理代做笔录。
- **衡量**：从想法到可执行 intent 的周期；intent 被拒绝/返工的比例。

### 阶段 2 · 设计（Design）— 生成 `spec.md`

- **目的**：产出工程团队可据此做方案的 spec，并**标出需要关注的地方**（不用等审查才发现冲突）。
- **怎么做**：agent 拿到通过的 `intent.md`，按组织 skills（品牌/安全/合规/UX）生成需求+设计规格；**人审查这份 spec，但不写它**。先处理标记的关注点，再提交。
- **产物**：`spec.md`（与 `intent.md` 一起提交）。
- **门禁（人做）**：产品负责人决定是否进入构建阶段；高风险内容咨询技术负责人。**这个决定始终由人做。**
- **治理**：组织 skills 作为约束在写 spec 时就应用；spec + 生成它的 prompt + 生效的 skill 版本一并入版本控制。
- **DSH 映射**：skills 目录（如 `agents/skills/secure-api-review`）；提示词作为 preset 的指令段。
- **衡量**：spec 是否在进入 plan 前就消解了冲突关注点。

### 阶段 3 · 构建（Build）— Plan mode 默认起点

- **目的**：先做扎实的计划，再让 agent 实施——**有了一份好计划，实施通常一遍就完成**。
- **怎么做**：工程师在 plan mode 下给 agent `spec.md`，反复质询（会破坏什么？哪一步风险最大？为什么没选别的方案？），迭代直到"没看过对话的工程师也能照此完成"，把计划存为 `plan.md`，然后接受执行。护栏成熟后进入 auto mode。
- **产物**：`plan.md` + 代码 diff + 测试。
- **门禁（人做）**：接受计划（plan mode 强制：接受前 agent 不能编辑文件 → 设计审查先于任何代码）。
- **治理**：
  - `AGENT.md`（≈ 原 `CLAUDE.md`）：给 agent 的"新人入职第一页"——命令、规范、架构、常见错误；**同一个错犯两次，纠正就写进去**，控制在一页内。
  - **Skills**：需一致性执行的机构知识写成 skill，随代码分发。
  - **Hooks**：确定性护栏，skill 是建议、hook 是"几乎不可能违规"。构建期 hooks：阻止编辑受保护路径、编辑后跑 formatter/linter、把凭证挡在 diff 外。**快、范围限定在改动的文件上**。
  - **并行会话 + 子 agent**：用 plan 把工作拆成改不同文件的任务，各自 worktree（`claude --worktree feature-auth` 之类）；重复性工作做成子 agent（如"跑起来验证"）。
  - **反馈回路**：始终给 agent 一种验证自己工作的方式（构建/测试/截图 diff）；修 bug 先写失败测试，提交它，再在不改测试的前提下修复；**修代码的 agent 不能同时削弱对那段代码的检查**（用 hook 阻止编辑测试）。
- **DSH 映射**：plan 阶段≈先出方案再审批；子 agent≈`subagent`/`subagent_fork`；并行≈workflow 或后台多实例；`AGENT.md`≈agent preset 的引导段；hooks≈DSH 的确定性拦截（cordis hook 拦工具调用/沙箱审批）；反馈回路≈把验证包装成 `make test`/`npm test` 目标，失败返回非零。
- **衡量**：一次通过率；计划被返工的次数；Hooks 拦截次数。

### 阶段 4 · 测试（Test）— CI 持续 Eval + AI 参与 PR 审查

- **目的**：把"质量"从一次性 QA 变成**持续回归的 stage-gate**。
- **怎么做**：
  - **持续 Eval**：从近期工作收集 **20–50 个真实任务**，每个写成"prompt + 可接受判定"的 eval；**每个生产事故都变成一个 eval**，永久回归。CRON / 触发（改动 `AGENT.md`、`agents/**` 时）在 CI 中跑。
  - **AI 参与 PR 审查**：agent 按 `REVIEW.md`（分 Bugs/Security/Compliance 三遍）审查 incoming PR，也处理自己 PR 上的评论；人/作者在评论 `@agent` 时它修复并推送。结论回写到 `AGENT.md`——**同一错误第二次被审查标出时，纠正就写进去**。
- **产物**：eval 套件、带审查结论的 PR。
- **门禁（人做）**：approval（分支保护）；审查结论是依据，代码所有者最终批准。
- **治理**：职责分离——写代码的 agent **没有途径批准自己的代码**。
- **DSH 映射**：`evals/` 目录 + CI 工作流（`.github/workflows/agent-evals.yml`）；`REVIEW.md` 作为审查提示词/预设；用 `cordis` 注册一条"审查 agent"工具或 preset。
- **衡量**：eval 通过率、回归数、PR 从提交到批准周期。

### 阶段 5 · 部署（Deploy）— Hooks 作为审批门禁
- **目的**：让发布速度跟上 agent，但**保留必须人工把关的发布门禁**。
- **怎么做**：
  - 列出"必须保留的人工审批门禁"，把每个门禁表达成 **hook**；团队 hook 放 git（`settings.json`），不可协商的放管理员 managed settings（工程师关不掉）。
  - CI/CD 里非交互式运行 agent：先做**只读判断**（分类失败构建、总结 flaky、起草 changelog）；在现有门禁后加**写入步骤**；agent 写的任何东西都**经分支保护成为 PR，没有直推 main 的路径**。
  - 通过 MCP 暴露**部署能力**（部署/状态/回滚变成工具），按环境分级自主权：dev 自由部署、prod 发布经理授权、preprod 居中。
  - **回滚是演练最多的路径**：一条命令，agent 能跑，定期在 preprod 演练。
- **产物**：部署流水线、发布记录、回滚演练记录。
- **门禁（人做）**：生产部署需发布授权（hook 拦截）；批准决定带时间戳记录。
- **治理**：agent 可以做到生产门禁为止，不能越过；非交互运行以 agent 自己的身份执行，日志把"agent 做的"和"触发它的工程师做的"分开。
- **DSH 映射**：发布授权↔DSH 的审批/沙箱（approval 门禁）；部署能力↔注册为 `model Tools` 或 host 服务方法；回滚↔预授权 runbook。
- **衡量**：发布周期、因发布引入的故障率、回滚演练通过率。

### 阶段 6 · 运维与闭环（Ops & close the loop）— 无人值守运行
- **目的**：让 agent **自主运行来闭合整个循环**。
- **怎么做**：
  - 选一个有稳定滚动基线的指标（CI 测试失败率、发版后 5xx 率、PR 周期时间），写**确定性**检测脚本（滚动均值+标准差，Western Electric 规则）。检测层完全不涉及模型。
  - 用 `bands.yaml` 定义响应分级：**1σ 只记日志；2σ 调用 agent 只读诊断；3σ agent 可行动但只能走受控路由（开 PR 进审查门禁 / 触发预批准 runbook）**。
  - agent 把诊断按 **intent.md 格式**写成"异常+证据+预期结果+受影响系统+待答问题"，从这里回到第一阶段，循环自我喂养。
  - 事故也可经工作通讯（Slack/Teams，≈原 Claude Tag）进入：agent 作为频道成员第一响应，对话与机构知识留在频道，复盘写回版本控制。
- **产物**：`bands.yaml`、事故记录、回环后的新 `intent.md`。
- **门禁（人做）**：3σ 提案走 PR/runbook 需人审；升级点由人判断。
- **治理**：检测层确定性；agent 的行动出口只有"PR 或预批准 runbook"。
- **DSH 映射**：监控脚本 ↔ 确定性脚本/定时 job（或 `cordis` 宿主服务监听 Host Events）；`bands.yaml` 驱动分级；事故 ↔ `incident.md` → 回写 intent.md。
- **衡量**：检测→定位→恢复时长（MTTR），从事故到生产 eval 的转化率。

---

## 3. 角色与职责映射 / Role mapping（个人/小团队）

原文有 PM / 架构师 / 策略负责人 / QA / 发布经理 / 运维，你一个人兼任全部。**这不改变要守的门禁，只让"人"这一环都落在你：**

| 角色 | 你负责的"人"的动作 | 用到的产物 |
|---|---|---|
| 产品负责人 | 审批 intent、审查 spec、决定是否进构建 | intent.md / spec.md |
| 架构师 | 质询计划、判断高风险、做设计决策 | plan.md / ADR |
| 工程师 | 接受/拒绝 plan 执行、auto mode 授权 | plan.md |
| 质量/审查 | 依据 REVIEW.md 在门禁把关、批准 PR | review.md / PR |
| 发布经理 | 生产发布授权、决定回滚 | hooks / 发布门禁 |
| 运维/负责人 | 判断 3σ 升级、确认闭环 | bands.yaml / incident.md |

> 注意：**不要为了"快"而跳过门禁**——门禁恰恰是这套方法在你这种量级下依然把关注意力的地方。

---

## 4. 工具无关表述 + 工具映射总表

方法论本体**不绑定任何 agent**；映射只影响落地文件放在哪个目录。常用对照：

| 原 Claude 概念 | 工具无关表述 | 写进哪个文件/机制 |
|---|---|---|
| `CLAUDE.md` | `AGENT.md`（给 agent 的入职第一页） | 仓库根 / agent preset 引导段 |
| Skills | 建议性机构知识 | `agents/skills/<name>/SKILL.md` |
| Hooks | 确定性护栏 / 门禁 | `agents/hooks/<name>.sh` + 工具拦截 |
| MCP | 暴露为工具的部署/能力 | host Services / 注册为 model Tools |
| Claude Code | agentic 编码 agent | DSH 或任意 agentic 工具 |
| plan mode | 方案先行、审批后执行 | preset 的"先方案后动手"模式 |
| subagent / 并行 | 子代理 / 并发做改不同文件的任务 | `subagent` / `workflow` / 多实例 |
| Claude Tag | 事故入口（IM/告警通道） | 事件/告警接入 |
| evals / bands | 持续回归 / 控制带 | `evals/` + `infra/bands.yaml` |

---

## 5. 工具无关的通用提示词（各阶段入口）

> 对应每个"play"的触发 prompt。改为你 tool 的动作模板。

- **阶段 1（意图）**：`把下面这段描述，按 intent 模板写成 intent.md：<你的话>。先追问我范围/用户/约束/怎样算成功，直到你足够确定再动笔。`
- **阶段 2（规格）**：`读取已通过的 intent.md，产出需求+设计规格 spec.md。应用仓库 skills，使方案符合我们的规范。清楚标注任何关注点，尤其是你无法同时满足的冲突策略。`
- **阶段 3（计划）**：`读取 intent.md 与 spec.md，给出一份实施计划：要改的文件、工作顺序、能证明它work的测试。并回答：这改动可能破坏什么？哪一步风险最大？为何没选其他方案？`
- **阶段 4（审查）**：`按 REVIEW.md 三遍扫描这个 PR（Bugs/Security/Compliance），每处结论标 pass。只把会破坏行为/漏数据/违背策略的标成 Important，风格命名算 Nit，最多报 5 条 Nit。`
- **阶段 5（部署）**：`这是发布流程：先做只读判断（分类失败/总结 flaky/起草 changelog），产出作为 PR 进入门禁；任何写入都以 PR 形式到达，不直推 main。`
- **阶段 6（闭环）**：`监控指标突破 2σ。请只读诊断：定位最可能原因、判断是否 flaky、给三行摘要写到 PR 线程。` / `突破 3σ：按事故模板写成 incident.md 并转成 intent.md，走受控路由（PR 或预批准 runbook）。`

---

## 6. 采纳策略 / Adoption

按 `adoption.md` 的成熟度阶梯走：台阶 0→4。**从任意阶段切入**（原文：从任何"没有箭头指入的 play"开始），不必一次到位。

**一句话原则**：`intent.md → spec.md → plan.md（→ 代码+测试 → PR）→ 事故 → 回环`。保住这条产物链，人只在门禁上把关。
