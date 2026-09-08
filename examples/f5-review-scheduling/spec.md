# Spec: SM-2 复习调度参数可配置化

**Stage / 阶段**: 2 设计 (Design) · **Status / 状态**: draft
**From**: `[intent.md](./intent.md)` · **Author**: neo（产品负责审查，不写） · **Date / 日期**: 2026-09-08
**SPOC / 责任人**: neo（产品负责人）

## 目标与范围 / Goal & scope
让 `ReviewService` 的 SM-2 间隔推进（F5.1.3）**以 `system_config`(key=`review`) 的配置为准**，消除"后台可改但调度不生效"的缺陷。范围限 **server 端 `review` 模块**；不改 `app`/`admin` 前端，不改变默认值下的对外行为。

## 用户旅程 / User journey
教研/运营在管理后台调整复习参数 → 保存 → 学生下次复习时，`reportWordResult` 用新参数推进间隔、`todayStatus`/`dailyPool` 用新毕业阈值判断到期。

## 功能需求 / Functional requirements
- **FR-1**：`ReviewService` 注入 `SystemConfigRepository` 与 `ObjectMapper`；提供私有 `ReviewConfig loadReviewConfig()`，读取 `config_key="review"`；解析失败回退 `REVIEW_DEFAULT`。
- **FR-2**：默认值 = `sm2Intervals=[3,7,14]`、`graduationThreshold=4`，**与 `AdminService.REVIEW_DEFAULT` 保持一致**（可用一个共享常量，避免各处漂移）。
- **FR-3**：`reportWordResult` 去掉 `INTERVALS`/`GRADUATE_STAGE` 硬编码，改用 `loadReviewConfig().getSm2Intervals()` / `.getGraduationThreshold()` 推进。
- **FR-4**：防御性校验——`sm2Intervals` 为空/长度不足、`graduationThreshold <= 0` 时回退默认。
- **FR-5**：抽取纯函数 `AdvanceResult advance(int stage, boolean correct, List<Integer> intervals, int graduation)`，便于无 DB 的单元测试。其规则：
  - `correct`：`stage = min(graduation, stage + 1)`；否则 `stage = 0`。
  - `nextReviewAt`：`stage >= graduation` → 今天（毕业）；否则 → `today + intervals[stage]`；`intervals[stage]` 越界回退 `intervals[last]`。
- **FR-6**：调度的"毕业/到期"判断（`todayStatus`/`dailyPool` 用 `GRADUATE_STAGE` 之处）改用 `loadReviewConfig().getGraduationThreshold()`。

## 非功能约束 / Non-functional constraints
- **性能**：配置读取每次提交一次 DB 查询可接受（当前量级）；引入后仍是单次 `findByConfigKey`。
- **安全**：配置由 admin 权限接口写入（`/api/admin/**` 仅 ADMIN），学生侧只读调度不受影响。
- **一致性**：默认值路径的行为必须**逐位不变**（这是"修复缺陷"而非"改算法"）。现有 `answer 正确 → stage 3 → 间隔 14 天 → 再答对 → 毕业` 的矩阵必须保持。

## 数据 & 接口契约 / Data & API contract
- 读取：`SystemConfigRepository.findByConfigKey("review")` → JSON → `ReviewConfig`（字段 `sm2Intervals: List<Integer>`、`graduationThreshold: Integer`）。
- 无表结构改动、无接口路径改动。`ReportWordResult` 返回结构不变。

## 边界与例外 / Edge cases & exceptions
- 配置缺失 / JSON 解析失败 → 默认 `[3,7,14]`、`4`。
- `sm2Intervals=[2,5]` 而 `graduation=3` → stage 推进到 3 时已在毕业，不访问 `intervals[3]`；stage=2 时 `intervals[2]` 越界 → 回退 `intervals[last]=5`。
- `graduationThreshold=1` → 首次答对即毕业。

## 关注点 / Areas of concern
- **默认值漂移**：`REVIEW_DEFAULT` 目前是 `AdminService` 里的字符串常量；本改动应把 `sm2Intervals=[3,7,14]`、`graduationThreshold=4` 收敛到一处共享常量，两者同源。 → 与 admin 侧确认是否可抽 `ReviewDefaults`。

## 端到端验证标准 / Done criteria
1. 新增测试 `review/service/ReviewServiceSm2ConfigTest`：
   - a. 默认配置下，推进结果与现有硬编码行为一致（stage 0→[3,7,14]→毕业）。
   - b. 注入 `sm2Intervals=[2,5,10]`、`graduationThreshold=3` 时，使用自定义值。
   - c. 答错 → stage=0，间隔归零（今天到期）。
   - d. 越界/空 intervals 回退默认。
   - e. `todayStatus` 的毕业判断随 `graduationThreshold` 变化。
   - **（当前实现下 a 之外的测试必失败 —— 缺口证明）**
2. 修改 `ReviewService` 接上配置；`./gradlew test` 全绿。
3. `gradle bootRun` 未受影响（链路只读了 DB 配置）。
