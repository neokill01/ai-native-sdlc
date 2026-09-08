---
name: configurable-params
description: 凡"管理后台/系统配置可在线调整"的参数，必须读取 system_config，而非硬编码常量。修改涉及算法参数、业务阈值、开关时使用。
---

# 可配置参数必须读配置，不要硬编码

产品约定：**算法/业务参数已入库 `system_config`，可在管理后台在线调整，无需改代码。** 因此：

## 规则

1. **发现疑问先查**：某参数是否已在管理后台暴露（`admin` 侧有对应 config 读取/更新端点或 `SystemConfigService` 可读）？在动手改成"写死"前先查 `system_config` 的 key。
2. **凡后台可调的，读配置**：用 `SystemConfigService.get(key, Clazz, default)` 读取，缺失/解析失败回退默认；**禁止**在业务代码里再放一份硬编码的 `INTERVALS`/`THRESHOLD` 之类的数组或常量。
3. **默认值唯一来源**：回退用的默认值要收敛到一处（如 `ReviewDefaults`），与 admin 的 `REVIEW_DEFAULT`/种子默认保持一致，避免默认路径漂移。
4. **改参数不改算法**：读配置是"接上线"，不是"重写算法"。默认值下行为必须与旧逻辑逐位一致。

## 反面教材（真实踩过）

`ReviewService` 曾把 SM-2 间隔/毕业阈值硬编码为 `INTERVALS={0,3,7,14}`、`GRADUATE_STAGE=4`，而管理后台早已能写 `system_config(review).sm2Intervals=[3,7,14]`/`graduationThreshold=4`。结果：**后台改了参数，真实调度却纹丝不动**。修复方式正是"读配置 + 默认值收敛 + 纯函数可测"。

## 自检

- [ ] 我改的常量/阈值是否已经在 admin 里有配置项？
- [ ] 若是，是否改为 `SystemConfigService.get(key, Clazz, default)`？
- [ ] 默认值是否与 admin 默认**同源**？
- [ ] 是否补了"自定义配置生效"的测试，而不是只测默认值？
