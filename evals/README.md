# Evals · 持续回归评估（测试阶段的 stage-gate）

> 在 AI-Native SDLC 里，**eval 就是永久回归的 QA**：把一组"真实任务 + 可接受判定"写成套件，在 agent 配置（模型/prompt/skill/hook/AGENT.md）变化时运行，判断 agent 是否还能保持工作标准。

## 一个 eval 是什么

每个 `evals/*.json` 描述一个任务：

```json
{
  "id": "<唯一 id>",
  "description": "这个任务在测什么",
  "prompt": "给 agent 的任务描述（模型可执行）",
  "checks": ["可接受判定的逐条标准", "…"],
  "verify": "可选：一条确定性的校验命令（exit 0=通过）。用于有代码/命令可跑的任务"
}
```

- `prompt` + `checks`：定义"可接受"（测试通过、lint 干净、行为不变、策略被遵守）。
- `verify`：把检查**确定性化**（跑真实命令/测试），这样 eval 可无人值守地在 CI 里跑。
- **每个生产事故都变成一个 eval**，作为永久回归留在套件里。

## 怎么跑

```bash
# 跑全部 eval（有 verify 的跑命令判定；无 verify 的列出 checks 供人工审）
./evals/check.sh           # 默认扫 evals/*.json
./evals/check.sh evals/sm2-configurable.json   # 跑单个
```

`check.sh` 返回非零即视为有 eval 失败（可供 CI 判定）。

## 何时触发

- **PR 门禁**：改动 `AGENT.md`、`agents/**`、`evals/**`、`docs/playbook.md` 时在 CI 跑（见 `.github/workflows/agent-evals.yml`）。
- **定时**：cron 例行回归，agent 配置一变就能发现问题。
- **事故后**：新生产事故 → 新增对应 eval，永久回归。
