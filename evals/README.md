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
./evals/check.sh evals/premarket-brief.json   # 跑单个
```

`check.sh` 返回非零即视为有 eval 失败（可供 CI 判定）。

## 何时触发

- **PR 门禁**：改动 `AGENT.md`、`agents/**`、`evals/**`、`docs/playbook.md` 时在 CI 跑（见 `.github/workflows/agent-evals.yml`）。
- **定时**：cron 例行回归，agent 配置一变就能发现问题。
- **事故后**：新生产事故 → 新增对应 eval，永久回归。

## 运行器修订

需要 Bash 与 Python 3.9+，不再依赖 jq。CI 使用一次性 ubuntu-latest runner 与只读仓库权限，不依赖长期在线的自托管 runner。定义损坏、文件缺失、无匹配定义返回非零。
verify 使用 `bash -e -o pipefail`，每条命令默认 120 秒超时，可通过 timeout_seconds 配置 1–600 秒；超时按 FAIL 处理。请把预期非零命令放在 if 等显式条件中。
含 project 的定义一律 SKIP，在目标仓库自己的 CI 运行；无 verify 的清单为 REVIEW。
汇总包含 PASS/FAIL/REVIEW/SKIP；存在待审或跳过时 RESULT 为 REVIEW（退出 0），不等于全量通过。
命令仍具备当前宿主权限，只允许运行可信 eval 定义。
