"""数据源：统一 Source 接口 + 确定性样例源 + 多源合并。

数据源可插拔：接入真实行情/新闻/日历只需实现 `Source` 三方法。
示例 `SampleSource` 返回**确定性**（静态）数据，保证示例离线可跑、结果可复现。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from .models import CalendarEvent, Headline, MarketSnapshot


class Source(ABC):
    """市场信息源接口。"""

    @abstractmethod
    def premarket_snapshot(self) -> list[MarketSnapshot]:
        """隔夜/盘前指数量价快照。"""

    @abstractmethod
    def headlines(self) -> list[Headline]:
        """新闻/情绪标题。"""

    @abstractmethod
    def economic_calendar(self) -> list[CalendarEvent]:
        """经济日历事件。"""


# 确定性样例数据（静态常量，无随机/无外部 IO）
_SNAPSHOTS = [
    MarketSnapshot("US", "SPX", 5105.0, 5000.0),     # +2.1%
    MarketSnapshot("US", "NDX", 19480.0, 20000.0),   # -2.6%
    MarketSnapshot("HK", "HSI", 17238.0, 17000.0),   # +1.4%
    MarketSnapshot("CN", "CSI300", 3766.6, 3700.0),  # +1.8%
    MarketSnapshot("JP", "N225", 37407.0, 37000.0),  # +1.1%
]

_HEADLINES = [
    Headline("", "Fed minutes signal patience on rate cuts", "positive"),
    Headline("NVDA", "AI chip demand stays strong; analyst raises target", "positive"),
    Headline("TSLA", "Q3 deliveries miss estimates", "negative"),
    Headline("", "Oil slides on demand worries", "negative"),
    Headline("AAPL", "iPhone demand stable in China", "neutral"),
    Headline("", "China announces new stimulus measures", "positive"),
]

_CALENDAR = [
    CalendarEvent("US", "CPI YoY", "high", "08:30 ET"),
    CalendarEvent("US", "Initial Jobless Claims", "medium", "08:30 ET"),
    CalendarEvent("CN", "Loan Prime Rate", "high", "09:15 CST"),
    CalendarEvent("EU", "ECB President speech", "medium", "14:00 CET"),
]


class SampleSource(Source):
    """确定性样例源（离线示例用）。"""

    def premarket_snapshot(self) -> list[MarketSnapshot]:
        return list(_SNAPSHOTS)

    def headlines(self) -> list[Headline]:
        return list(_HEADLINES)

    def economic_calendar(self) -> list[CalendarEvent]:
        return list(_CALENDAR)


class CompositeSource(Source):
    """合并多个数据源并去重（同 region+index / ticker+text / region+name 保留首个）。"""

    def __init__(self, *sources: Source) -> None:
        self._sources: tuple[Source, ...] = sources

    def premarket_snapshot(self) -> list[MarketSnapshot]:
        seen: dict[tuple[str, str], MarketSnapshot] = {}
        for s in self._sources:
            for x in s.premarket_snapshot():
                seen.setdefault((x.region, x.index), x)
        return list(seen.values())

    def headlines(self) -> list[Headline]:
        out: list[Headline] = []
        for s in self._sources:
            for h in s.headlines():
                if all((h.ticker, h.text) != (x.ticker, x.text) for x in out):
                    out.append(h)
        return out

    def economic_calendar(self) -> list[CalendarEvent]:
        out: list[CalendarEvent] = []
        for s in self._sources:
            for e in s.economic_calendar():
                if all((e.region, e.name) != (x.region, x.name) for x in out):
                    out.append(e)
        return out
