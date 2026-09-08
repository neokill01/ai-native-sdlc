# 示例：开市前市场简报（自包含，可运行）

> 用【炒股专家每日开市前获取最新市场信息】这个真实场景，走通 **AI-Native SDLC 全链路**（intent → spec → plan → code+test → PR → 回环）。
> 本案例**自包含、纯标准库、离线可跑、可复现**，适合提交到 git 展示——不依赖外部仓库路径，也不要求任何行情 API/密钥。

## 产物链（committed artifact chain）

| 阶段 | 产物 | 说明 |
|---|---|---|
| 1 规划 | `intent.md` | 炒股专家视角：开市前痛点、期望、成功标准 |
| 2 设计 | `spec.md` | 数据模型 / `Source` 接口 / 分析规则（FR-1~7） |
| 3 构建 | `plan.md` | 变更文件 + 实施顺序 + 风险（先写测试→纯函数→CLI） |
| 4 测试 | `tests/`（20 用例全绿） | `unittest`，纯标准库可跑 |
| 5 交付 | `premarket_brief/` 包 + CLI | `python3 -m premarket_brief` |

## 为什么这个案例适合展示

- **单人、边界清晰**：炒股专家 + 一个 CLI 工具，无鉴权/多租户。
- **自包含**：数据源用 `Source` 接口抽象，内置**确定性样例源**（静态常量），无网络/无密钥。
- **可复现**：同一输入 → 同一输出（样例源无随机/时间依赖），测试稳定。
- **能跑、可验证**：`python3 -m unittest discover -s tests` 全绿；CLI 输出完整简报。
- **抽象出真正的扩展点**：接真实行情/新闻/日历只需实现 `Source` 三个方法，示例逻辑与真实源解耦。

## 怎么跑

```bash
cd examples/premarket-brief

# 跑测试（纯标准库，无需 pytest）
python3 -m unittest discover -s tests -v

# 生成开市简报（默认当天；--day 固定日期便于复现）
python3 -m premarket_brief --day 2026-09-08
```

## 示例输出（`python3 -m premarket_brief --day 2026-09-08`）

```
# Pre-Market Brief · 2026-09-08

**Market stance:** RISK_ON

## Notable moves
- SPX (US) +2.10%  [5105.00 vs 5000.00]
- CSI300 (CN) +1.80%  [3766.60 vs 3700.00]
- HSI (HK) +1.40%  [17238.00 vs 17000.00]
- N225 (JP) +1.10%  [37407.00 vs 37000.00]
- NDX (US) -2.60%  [19480.00 vs 20000.00]

## High-impact events today
- **CPI YoY** (US) · 08:30 ET
- **Loan Prime Rate** (CN) · 09:15 CST

## Top headlines
- Fed minutes signal patience on rate cuts
- [NVDA] AI chip demand stays strong; analyst raises target
- China announces new stimulus measures
- [AAPL] iPhone demand stable in China
- [TSLA] Q3 deliveries miss estimates

## Watchlist alerts
- SPX (US) +2.10%
- NDX (US) -2.60%
```

## 完整流程实录（本次如何跑通）

下面是本案例按 AI-Native SDLC 门禁实际走过的路径与真实命令/输出：

```
① 规划   → intent.md   （炒股专家视角：痛点/期望/成功标准）✅
   门禁：人审 → 接受
② 设计   → spec.md     （数据模型 / Source 接口 / FR-1~7，标注冲突点）✅
   门禁：人审 → 决定进入构建
③ 构建   → plan.md     （变更文件 / 实施顺序=测试先行 / 风险）✅
   门禁：人审 → 接受执行
④ 构建   → 先写 tests  定义契约（change_pct / Source / build_brief 判定）
⑤ 测试   → 实现后跑测试 → 20 用例全绿   ▼ 真实输出
⑥ 交付   → python3 -m premarket_brief 输出完整简报 → git commit
```

**门禁流转的核心**：`intent`/`spec`/`plan` 三份产物**先于任何代码**提交并经过人审；拿到接受后才进入"构建→测试"（agent 自闭环），最后以真实命令 + 全绿测试 + CLI 输出回到人的视野。

**测试真实输出（`python3 -m unittest discover -s tests`）**：

```
Ran 20 tests in 0.001s   →  OK
```

（各用例：`test_change_pct_*`、`test_*_contract`、`test_deterministic`、`test_merge_and_dedupe`、`test_union_keeps_distinct`、`test_stance_*`、`test_big_moves_threshold`、`test_high_impact_filtered`、`test_top_headlines_sentiment_ordered`、`test_watchlist_alerts_threshold`、`test_threshold_le_zero_falls_back`、`test_build_brief_from_sample`）

**交付命令与提交**：

```bash
python3 -m premarket_brief --day 2026-09-08   # 输出见上方"示例输出"
git add examples/premarket-brief && git commit -m "示例: 炒股专家·开市前简报（intent/spec/plan + 实现 + 20 用例全绿）"
```

## 这个流程跑通了什么

1. **intent → spec → plan 先于代码**（需求/设计评审在编码前，改方向只改文档）。
2. **测试先行**：`tests/` 先定义契约（`change_pct`、`Source` 契约、`build_brief` 判定），实现后逐条转绿。
3. **护栏/可配置参数**：`stance` 阈值、显著异动阈值、自选股阈值都走默认常量，逻辑分支不硬编码（参照 `agents/skills/configurable-params`）。
4. **纯函数可测**：`build_brief` 无 IO，可直接单测；数据源抽象使接真实行情成为纯增量。

## 扩展点（接真实行情）

实现 `Source` 三方法（`premarket_snapshot` / `headlines` / `economic_calendar`），替换 `SampleSource` 即可；`--source` 参数已预留。
