"""数据模型（frozen dataclass，纯标准库）。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class MarketSnapshot:
    """某指数/标的的盘前快照。"""

    region: str
    index: str
    price: float
    prev_close: float

    @property
    def change_pct(self) -> float:
        """相对昨收的涨跌幅（%）。prev_close<=0 时按 0 处理，避免除零。"""
        if self.prev_close <= 0:
            return 0.0
        return (self.price - self.prev_close) / self.prev_close * 100.0


@dataclass(frozen=True)
class Headline:
    """一条新闻/情绪标题。"""

    ticker: str
    text: str
    sentiment: str  # positive | negative | neutral


@dataclass(frozen=True)
class CalendarEvent:
    """经济日历事件。"""

    region: str
    name: str
    impact: str  # high | medium | low
    scheduled_at: str


@dataclass(frozen=True)
class Brief:
    """开市简报（分析摘要输出）。"""

    day: str
    stance: str  # RISK_ON | RISK_OFF | NEUTRAL
    big_moves: list[MarketSnapshot] = field(default_factory=list)
    high_impact_events: list[CalendarEvent] = field(default_factory=list)
    top_headlines: list[Headline] = field(default_factory=list)
    watchlist_alerts: list[MarketSnapshot] = field(default_factory=list)
