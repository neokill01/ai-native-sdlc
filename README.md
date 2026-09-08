# AI-Native 全流程工程

一套基于 Anthropic《[The AI-Native SDLC Playbook](https://claude.com/blog/the-ai-native-sdlc-playbook)》改编的**可复用软件开发生命周期方法体系**。把一个想法从模糊变成线上产品，全程让 AI 在每个节点干活、人只在需要判断力的门禁上把关。

> **核心一句话**：`intent.md → spec.md → plan.md →（代码 + 测试）→ 带审查结论的 PR → 事故记录 → 回到 intent.md`。
> 守住这条**提交产物链**，人审查 agent 标记出来的内容，而不是陪跑每次编辑。

## 它解决什么？

- 代码不再稀缺——瓶颈转移到**规划 / 审查测试 / 部署**这些人速运行的环节。
- 逐行审查跟不上 agent 的产出量——改为**在门禁上审查产物**。
- 方法工具无关——Claude Code / Codex / DeepSeek Harness（DSH）都能用。

## 目录结构

```
AINative/
├── docs/
│   ├── playbook.md        # 适配版方法论（六阶段 + 门禁 + DSH 映射）※ 从这里读起
│   └── adoption.md        # 成熟度阶梯：落地顺序与切入建议
├── artifacts/             # committed-artifact 产物模板（方法论的脊柱）
│   ├── intent.md.template     # 阶段1 规划 — 捕获意图
│   ├── spec.md.template       # 阶段2 设计 — 需求+设计规格
│   ├── plan.md.template       # 阶段3 构建 — 实施计划
│   ├── review.md.template     # 阶段4 测试 — 审查指令（REVIEW.md）
│   ├── bands.yaml.template    # 阶段6 运维 — 监控控制带
│   └── incident.md.template   # 阶段6 运维 — 事故记录（回环起点）
├── examples/             # 用真实项目走通全流程的完整示例
├── agents/
│   ├── skills/           # 建议性机构知识（需一致性执行）→ SKILL.md
│   └── hooks/            # 确定性护栏/门禁（几乎不可能违规）→ *.sh
├── evals/                # 持续回归评估套件（20–50 个真实任务）
├── infra/                # 监控控制带 bands.yaml
├── .github/workflows/    # CI 门禁（agent-evals.yml 等）
└── bin/                  # 便捷脚本（new-intent / promote / gate-check）
```

## 怎么用（快速开始）

1. **读方法论**：`docs/playbook.md`。
2. **定落地点**：`docs/adoption.md` 选切入台阶（从 0 或 1 开始）。
3. **复制模板**：从 `artifacts/` 复制对应模板，按提示填写。
4. **守门禁**：人只在 `intent 审批 → spec 审查 → plan 接受 → PR 批准 → 发布授权 → 3σ 升级` 这些门禁上把关。

## 状态

- [x] 台阶 0：骨架 + 方法论文档 + 六份产物模板
- [x] 台阶 1：用真实项目（记单词 App）走通 规划→设计→构建→测试 （`examples/f5-review-scheduling/`）
- [x] 台阶 2：agents/skills（建议性管控）+ agents/hooks（确定性护栏）+ 注册映射
- [ ] 台阶 3：evals + CI 门禁 + infra/bands.yaml
- [ ] 台阶 4：转译为 DSH agent preset / Cordis 插件工作台

> 基于 Anthropic Applied AI 团队的真实最佳实践改编；本仓库聚焦"方法论 + 门禁 + 产物"，具体工具映射见 `docs/playbook.md` 第 4 节。
