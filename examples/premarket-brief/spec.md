# Spec: 开市前市场简报（pre-market brief）

**Stage / 阶段**: 2 设计 (Design) · **Status / 状态**: draft
**From**: `[intent.md](./intent.md)` · **Author**: 炒股专家（产品负责审查，不写） · **Date / 日期**: 2026-09-08

## 目标与范围 / Goal & scope

实现一个 CLI 工具：开市前抓取最新市场信息（指数量价、新闻情绪、经济日历、自选股），合并、分析，输出一份确定性的 Markdown 开市简报。范围限新工具模块，**复用 `Source` 接口抽象数据源**，示例带内置样例源（离线可跑），不要求真实行情/凭据。

## 用户旅程 / User journey

炒股专家在开市前运行 `python3 -m premarket_brief [--source sample]` → 工具读取各源 → 分析并生成简报（Markdown 打印到 stdout）→ 专家据此规划当日。

## 功能需求 / Functional requirements

- **FR-1 数据模型**：`MarketSnapshot(region, index, price, prev_close)`（含 `change_pct` 计算）、`Headline(ticker, text, sentiment)`、`CalendarEvent(region, name, impact, scheduled_at)`。
- **FR-2 数据源接口**：`Source`（抽象基类）暴露三方法：`premarket_snapshot()`、`headlines()`、`economic_calendar()`。
- **FR-3 内置样例源** `SampleSource`：返回**确定性**样例数据（静态、无随机/无外部 IO）。
- **FR-4 多源合并** `CompositeSource`：聚合多个 `Source`，去重、按模型字段排序。
- **FR-5 分析摘要**：`build_brief(source, day)` 产出 `Brief`：
  - `stance`：按指数平均涨跌加权判断（≥+0.5% risk-on；≤−0.5% risk-off；否则 neutral）。
  - `big_moves`：`|change_pct| >= 1.0` 的指数。
  - `high_impact_events`：`impact == "high"` 的经济日历条目。
  - `top_headlines`：按 `sentiment` 权重（positive>neutral>negative）取前 N（默认 5）。
  - `watchlist_alerts`：自选股 `|change_pct| >= 阈值` 的提示（默认 2.0%）。
- **FR-6 CLI**：`python3 -m premarket_brief`，参数 `--source`/`--watchlist-threshold`/`--top-news`；输出 Markdown 简报。
- **FR-7 可运行性**：纯标准库、无副作用、幂等；`tests/` 全绿。

## 非功能约束 / Non-functional constraints

- **性能**：毫秒级（样例数据、纯内存），不得访问网络/DB。
- **兼容性**：Python 3.9+；标准库 `dataclasses`、`abc`、`argparse`、`pathlib`。
- **可测试性**：分析逻辑不依赖 IO，可纯函数测试。

## 数据 & 接口契约 / Data & API contract

```python
class Source(ABC):
    def premarket_snapshot(self) -> list[MarketSnapshot]: ...
    def headlines(self) -> list[Headline]: ...
    def economic_calendar(self) -> list[CalendarEvent]: ...

@dataclass(frozen=True)
class Brief:
    day: str
    stance: str            # RISK_ON | RISK_OFF | NEUTRAL
    big_moves: list[MarketSnapshot]
    high_impact_events: list[CalendarEvent]
    top_headlines: list[Headline]
    watchlist_alerts: list[MarketSnapshot]
```

## 边界与例外 / Edge cases & exceptions

- 空数据：某源返回空列表时，对应区块显示"无"而非报错。
- 除零：`prev_close <= 0` 时 `change_pct` 记 0，不除零。
- 负阈值怪值：阈值 ≤0 时回退默认（`big_moves=1.0`、`watchlist=2.0`）。
- 合并去重：同 `(region, index)` 取首个；同 `ticker+text` 的 headline 去重。

## 关注点 / Areas of concern

- 样例数据必须**确定性**（否则测试 flaky）。→ 用固定常量/列表。
- `stance` 的阈值是经验值，后续可参数化（参照 `configurable-params` skill，不硬编码）。

## 端到端验证标准 / Done criteria

1. `python3 -m premarket_brief` 输出含五块内容的简报（stdout）。
2. `tests/` 覆盖：`change_pct`、`SampleSource` 契约、`CompositeSource` 合并去重、`build_brief` 的 stance/big_moves/high_impact/top_headlines/watchlist、CLI 输出。
3. 纯标准库、离线可跑、无副作用；`python3 -m pytest` 全绿。
