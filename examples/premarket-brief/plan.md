# Plan: 开市前市场简报（from spec.md 2026-09-08）

**Stage / 阶段**: 3 构建 (Build) · **Status / 状态**: approved
**From**: `[intent.md](./intent.md)` + `[spec.md](./spec.md)` · **Author**: 炒股专家 · **Date / 日期**: 2026-09-08

## 变更的文件 / Files that change

```
examples/premarket-brief/
├── premarket_brief/
│   ├── __init__.py
│   ├── models.py        # MarketSnapshot / Headline / CalendarEvent / Brief
│   ├── sources.py       # Source(ABC) / SampleSource / CompositeSource
│   ├── summary.py       # build_brief(...)
│   └── __main__.py      # CLI
├── tests/
│   ├── test_models.py
│   ├── test_sources.py
│   └── test_summary.py
└── README.md            # 走通说明 + 如何跑
```

## 实施顺序 / Order of work

1. **先写失败测试**：`tests/` 先定义契约（`change_pct`、`SampleSource` 返回确定性、`build_brief` 的风向/异动/高影响/头条/自选股判定）→ 跑 `python3 -m pytest`，先红（尚无实现）。
2. **实现数据模型** `models.py`（frozen dataclass + `change_pct`）。
3. **实现数据源** `sources.py`：`Source` 接口 + `SampleSource`（确定性样例）+ `CompositeSource`（合并去重）。
4. **实现摘要** `summary.py`：`build_brief`（风向、显著异动、高影响事件、重点新闻、自选股提示）。
5. **实现 CLI** `__main__.py`：`argparse` + Markdown 渲染。
6. 补 `__init__.py`；全量 `pytest` 转绿；`python3 -m premarket_brief` 输出完整简报。

## 依赖与前置 / Dependencies

- 无外部包；Python 3.9+ 标准库。无真实行情/网络。

## 风险 / Risks

- **确定性**（最高）：样例数据若含随机/时间函数会导致 `build_brief` 不稳定。→ 缓解：全静态常量；测试固定断言。
- **阈值经验值**：`stance`/`big_moves`/watchlist 阈值是推测。→ 缓解：默认集中成常量，随 A/B 校准；沿用 `configurable-params` 思路不硬编码进逻辑分支。

## 验证方式 / Proof

- `python3 -m pytest tests/ -v` 全绿。
- `python3 -m premarket_brief` stdout 包含：大盘风向、显著异动、今日高影响事件、重点新闻、自选股提示五块。
- 示例输出写入 `README.md` 或 `sample_brief.md` 供审阅。

## 网关判断 / Gate decision

- [x] 计划接受执行？ → 接受后进入 auto mode 逐项落地（本 walk-through 即按此执行，最终以 `pytest` 与 CLI 输出验收）。
