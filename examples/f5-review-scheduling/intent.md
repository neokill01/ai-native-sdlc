# Intent: SM-2 复习调度参数可配置化（后台可调、无需改代码）

**Stage / 阶段**: 1 规划 (Plan) · **Status / 状态**: draft
**Author / 作者**: neo（产品+工程） · **Date / 日期**: 2026-09-08
**Entry point / 入口**: [x] 人的想法 · **Applies to**: 《中小学记单词APP》server · 对应 PRD **F5.1.3**

<!-- 示例目的：走通 AI-Native SDLC 全链路。这不是"从零建 SM-2"，而是一个真实缺口——后台能改参数，调度却不生效。 -->

## 问题 / Problem
产品要求（功能点清单 note）：*"算法参数已入库 system_config 表，词汇量测试/CAT/课程/复习策略可在管理后台在线调整，无需改代码。"*

但代码里 **`ReviewService.reportWordResult`**（`src/main/java/com/vocabapp/server/review/service/ReviewService.java`）把 SM-2 调度**硬编码**成：

```java
private static final int[] INTERVALS = {0, 3, 7, 14};
private static final int GRADUATE_STAGE = 4;
```

而管理后台（admin）已经能读写 `system_config` 里 key=`review` 的配置（`ReviewConfig.sm2Intervals`、`ReviewConfig.graduationThreshold`），默认值正是 `[3,7,14]` 和 `4`。

**后果**：运营/教研在后台调整复习间隔或毕业阈值后，实际的每日复习调度**完全不变**——配置是"装了但没接线"。

## 期望结果 / Proposed outcome
`ReviewService` 从 `system_config`(key=`review`) 读取 `sm2Intervals` 与 `graduationThreshold` 来驱动间隔推进；后台改动**立即**影响真实调度；不读取时回退到默认 `[3,7,14]` / `4`。**任何真实调度路径都不再依赖硬编码常量。**

## 受影响用户与系统 / Affected users & systems
- 影响面：`ReviewService.reportWordResult`（F5.1.3 间隔推进）、`todayStatus` / `dailyPool`（依赖 `GRADUATE_STAGE` 判断"毕业/到期"）。
- 受影响系统：`server`（Spring Boot），不涉及 `app`/`admin` 前端改动（它们已消费配置）。

## 约束 / Constraints
- 复用既有读取模式：`ObjectMapper` + `SystemConfigRepository`（与 `AdminService.getConfig`、`VocabTestService` 一致），不新增存储。
- 默认值必须与 `AdminService.REVIEW_DEFAULT` 一致（`sm2Intervals=[3,7,14]`、`graduationThreshold=4`）。
- 保持现有对外行为不变（默认值下与硬编码结果一致），这是"修复缺口"而非"改算法"。
- 需要**防御越界**：`sm2Intervals` 为空或长度不足时回退默认；`graduationThreshold` 非法时回退默认。

## 成功标准 / Success
1. 一个单元测试：给定 `ReviewConfig.sm2Intervals=[2,5,10]`、`graduationThreshold=3` 时，`reportWordResult` 推进用的是这些值（默认数组下不变）。
2. 后台改 `graduationThreshold` 后，`todayStatus`/`dailyPool` 的"毕业/到期"判断随之变化。
3. 说明：当前实现此测试**必失败**（config 未接线），这正是缺陷的证明。

## 待定问题 / Open questions
- 是否要把 SM-2 推进逻辑抽成纯函数（`(stage, correct, intervals, graduation) -> (stage, nextReviewAt)`）以便更易测？—— 建议：是，作为本次最小重构，测试即可直接驱动它。
- 是否需要缓存配置（避免每次提交都查库）？—— 暂不需要，规模小；后续若成热点再缓存。
