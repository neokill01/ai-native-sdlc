# DSH 工作台（台阶 4）

把本仓库的方法论转译成 **DeepSeek Harness（DSH）agent preset**，让这套"提交产物链 + 门禁"成为你日常编码 Agent 的一部分，换项目也复用。

## 已创建的 preset

- **id**：`ai-native-sdlc`
- **位置**：`${HOME}/.dsh/.agent-presets/ai-native-sdlc/`（作者 preset，用户根，随会话叠加）
- **来源**：从自带 `standard` preset **复制**而来（功能与 standard 完全一致），仅改 `persona` 文本，未增删/改动任何 row。

## 它改变了什么（很小）

| 文件 | 改动 |
|---|---|
| `preset.yml` | `name: AI-Native SDLC`，`description` 换了，去掉 `order` |
| `agent.cordis.yml` | 仅 `persona` 文本块改写为 AI-Native SDLC 工作流；其余 row 与 standard 逐行一致 |

工具集、plan-mode、skills、subagent、workflow、goal、jobs 等全都来自 standard（未动），所以**能力不缩水**，只是把"按产物链 + 门禁工作"写进了 Agent 的默认身份。

## Persona 落进去的工作流（提交产物链）

```
intent.md → spec.md → plan.md → (code + tests) → PR with review → incident.md → 回环
```
- Intent：想法模糊时先追问范围/用户/约束/成功，再写 `intent.md`。
- Design：由已批准 intent 产出 `spec.md`，标注冲突点；人审查、不代写。
- Plan：由已批准 spec 产出 `plan.md`（文件名/顺序/证明测试/风险）；**接受计划前不编辑文件**。
- Build：按 plan 实现，给自己验证手段；修 bug 先写失败测试再修代码。
- Test：跑 eval 套件 + 测试；按 `review.md` 三遍自审（bugs/security/compliance）。
- Deploy：不直推受保护分支（一律走 PR）；生产发布需发布授权（production-gate hook）。
- Ops：异常写成 `incident.md` 再回写 `intent.md`。
- 规则：**Skill 建议、Hook 强制**；可配置参数读 `system_config`，不硬编码；默认路径行为不变。

## 怎么用

1. 重新加载 preset 列表，在会话 picker 里选 **AI-Native SDLC**（或 `ai-native-sdlc`）开新会话。
2. 确认 persona 出现、工具列表与 standard 一致。
3. 用它编码时，它会按上面的门禁逐步产出 `intent/spec/plan` 等产物。

> 真正的验收是**在该 preset 上开一个真实会话**，确认 persona 与工具列表符合预期（DSH preset 只有在真实会话里才能看到它产生的 Agent 组成）。

## 复用/还原

- 这是用户根下的**复制品**，可自由修改/删除，不受升级影响（自带 `standard` 不动）。
- 若要恢复原样：删掉 `${HOME}/.dsh/.agent-presets/ai-native-sdlc` 后，用自带标准 preset 重新复制即可。
