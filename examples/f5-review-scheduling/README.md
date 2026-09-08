# 示例：F5 SM-2 复习调度参数可配置化

> 这是用《中小学记单词APP》真实代码走通 AI-Native SDLC 全链路的完整示例。
> 它演示了方法论的核心价值：**从 `intent` 出发，在真实代码里揪出"后台可调但调度不生效"的硬编码缺口**，并用"先写失败测试→修复→回归"闭环收敛。

## 产物链（committed artifact chain）

| 阶段 | 产物 | 状态 |
|---|---|---|
| 1 规划 | `intent.md` | ✅ 已提交（本目录） |
| 2 设计 | `spec.md` | ✅ 已提交（本目录） |
| 3 构建 | `plan.md` | ✅ 已提交（本目录） |
| 3 构建（实施） | `Sm2Scheduler.java` + `ReviewDefaults.java` + `ReviewService.java` 修改 | ✅ 已提交（commit `25340b1`） |
| 4 测试 | `Sm2SchedulerTest.java` + `ReviewServiceSm2ConfigTest.java`（**10 用例全绿**） | ✅ 已提交 |
| 5 重构 | `SystemConfig/SystemConfigRepository/ReviewConfig` 移入 `common.config` + 新增 `SystemConfigService`（30s 缓存） | ✅ 已提交（commit `32ebbb2`） |

## 结论 / 这次走通验证了什么

1. **方法论能揪出真实缺陷**：`ReviewService` 硬编码 `INTERVALS={0,3,7,14}`、`GRADUATE_STAGE=4`，无视 admin 已写好的 `system_config(review).sm2Intervals=[3,7,14]`/`graduationThreshold=4`。后台改参数 → 真实调度不变。
2. **测试先行是缺口的证明**：`ReviewServiceSm2ConfigTest.customConfig_drivesSchedule` 断言"自定义间隔 `[2,5,10]` → 首次答对 = 今天+2"。在未修复的代码上此断言**必失败**（用的是硬编码的 +3）。
3. **修复后闭环**：`ReviewService` 改读配置，纯算法抽成 `Sm2Scheduler`（无 DB、直接可测）。后续按评审意见做了两处优化：**② 解耦 review→admin**（配置类移入 `common.config`，统一经 `SystemConfigService` 读）+ **③ 短 TTL 缓存**（30s 进程内缓存，写入/重置即失效）。
4. **行为不变**：默认配置下仍为 3/7/14、第 4 次毕业，与修复前逐位一致（`Sm2SchedulerTest.defaultProgression_matchesHardcodedBehavior` 守护）。

## 参考（代码落在真实仓库）

- 配置读取（解耦 review→admin）：`/Users/neo/workspace/中小学记单词APP/server/src/main/java/com/vocabapp/server/common/config/`
  - `SystemConfigService.java`（新增，30s 缓存 + 读写/重置）
  - `SystemConfig.java` / `SystemConfigRepository.java` / `ReviewConfig.java`（从 admin 包移入）
- 源改造：`/Users/neo/workspace/中小学记单词APP/server/src/main/java/com/vocabapp/server/review/service/`
  - `Sm2Scheduler.java`（新增）
  - `ReviewDefaults.java`（新增）
  - `ReviewService.java`（修改，经 `SystemConfigService` 读配置）
- 测试：`/Users/neo/workspace/中小学记单词APP/server/src/test/java/com/vocabapp/server/review/service/`
  - `Sm2SchedulerTest.java`
  - `ReviewServiceSm2ConfigTest.java`

## 跑测试

```bash
cd /Users/neo/workspace/中小学记单词APP/server
./gradlew --offline test   # 离线（依赖已缓存）
```

## 遗留 / 可选后续

- 把 `AdminService.REVIEW_DEFAULT` 也改为引用 `ReviewDefaults`（当前两者数值一致，仅以注释约束，避免漂移）。
- `SystemConfigService` 的缓存 TTL=30s，若配置变更需要秒级生效可调小；若要跨实例一致则需换 Redis（当前单体足够）。
- SM-2 推进逻辑已抽为纯函数，后续如需"按账号个性化参数"，改动点集中在 `loadReviewConfig()`。
