# Plan: SM-2 复习调度参数可配置化（从 spec.md 2026-09-08）

**Stage / 阶段**: 3 构建 (Build) · **Status / 状态**: approved
**From**: `[intent.md](./intent.md)` + `[spec.md](./spec.md)` · **Author**: neo · **Date / 日期**: 2026-09-08

## 变更的文件 / Files that change
- `server/src/main/java/com/vocabapp/server/admin/dto/ReviewConfig.java` — *不改，复用为读取载体*
- `server/src/main/java/com/vocabapp/server/review/service/ReviewService.java` — **改**：新增 `SystemConfigRepository` + `ObjectMapper` 注入；去掉 `INTERVALS`/`GRADUATE_STAGE` 硬编码；`reportWordResult`/`todayStatus`/`dailyPool` 改用配置；新增纯函数 `advance(...)`；新增 `loadReviewConfig()`。
- `server/src/main/java/com/vocabapp/server/review/service/ReviewDefaults.java` — **新增**（可选，收敛默认值常量 `SM2_INTERVALS=[3,7,14]`、`GRADUATE_THRESHOLD=4`，与 `AdminService.REVIEW_DEFAULT` 同源；若改 AdminService 则一并更新）。
- `server/src/test/java/com/vocabapp/server/review/service/ReviewServiceSm2ConfigTest.java` — **新增**：见 spec 验证标准 a–e。
- （不改）`app/`、`admin/`、Flyway migration、接口路径。

## 实施顺序 / Order of work
1. **先写失败测试**：新增 `ReviewServiceSm2ConfigTest`（b/c/e 用例针对"读配置"），跑 `./gradlew test --tests ...Sm2ConfigTest` → **确保当前实现在这些用例上失败**（证明缺陷，测试先行）。
2. 抽取纯函数 `advance(int stage, boolean correct, List<Integer> intervals, int graduation)`（无 DB，直接驱动上面测试）。
3. 注入 `SystemConfigRepository` + `ObjectMapper`；实现 `loadReviewConfig()`（key=`review`，失败回默认）。
4. `reportWordResult` 改用 `advance(...)` + 配置；`todayStatus`/`dailyPool` 改用 `graduationThreshold`。
5. 收敛默认值常量到 `ReviewDefaults`；确认与 `AdminService.REVIEW_DEFAULT` 同源。
6. 全量 `./gradlew test` 通过；`bootRun` 冒烟未回归。

## 依赖与前置 / Dependencies
- 无外部 PR 阻断；`SystemConfigRepository`/`ObjectMapper` 均为现有 bean，可直接注入。
- 与 `VocabTestService` 的既有读取模式保持一致。

## 风险 / Risks
- **默认值漂移**（最高风险）：若共享常量与 `REVIEW_DEFAULT` 不一致，默认路径行为可能改变。→ 缓解：`ReviewDefaults` 与 `REVIEW_DEFAULT` 引用同一来源，测试 a 守护默认行为。
- **越界**：`sm2Intervals[stage]` 在 `stage < graduation` 但数组短时越界。→ 缓解：`advance` 里回退 `intervals[last]`；测试 d 守护。
- **行为回归**：默认配置下必须与硬编码逐位一致。→ 缓解：测试 a + 现有 `VocabServerApplicationTests` 上下文不破。

## 验证方式 / Proof
- `./gradlew test --tests '*ReviewServiceSm2ConfigTest'`：a–e 全绿；**其中 b/c/e 在改代码前先红，改后转绿**。
- `./gradlew test` 全体绿。
- 手动：管理后台把 `sm2Intervals` 改成 `[2,5,10]`、`graduationThreshold=3` 后，一个学生账户的回答推进按新值走（通过 `DailyReviewStatus.due` 与 `reportWordResult` 返回值确认）。

## 网关判断 / Gate decision
- [x] 计划接受执行？ → 接受后进入 auto mode 逐项落地（示例：# 本 walk-through 先出文档，落码在用户确认后执行）
