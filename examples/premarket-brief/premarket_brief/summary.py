"""分析摘要：把多源数据收敛成一份 `Brief`（纯函数，可测）。"""

from __future__ import annotations

from .models import Brief, CalendarEvent, Headline, MarketSnapshot
from .sources import Source

# 默认阈值（经验值）。阈值若传入 <=0 则回退默认，避免怪值导致空结果。
DEFAULT_BIG_MOVE_THRESHOLD = 1.0   # |change_pct| >= 1.0% 视为显著异动
DEFAULT_WATCHLIST_THRESHOLD = 2.0  # 自选股 |change_pct| >= 2.0% 触发提示
DEFAULT_TOP_NEWS = 5
STANCE_EDGE = 0.5                   # 平均涨跌 >= +0.5% → risk-on；<= -0.5% → risk-off

# News 情绪权重（用于重点新闻排序：positive > neutral > negative）
_SENTIMENT_WEIGHT = {"positive": 2, "neutral": 1, "negative": 0}


def _stance(snapshots: list[MarketSnapshot]) -> str:
    if not snapshots:
        return "NEUTRAL"
    avg = sum(s.change_pct for s in snapshots) / len(snapshots)
    if avg >= STANCE_EDGE:
        return "RISK_ON"
    if avg <= -STANCE_EDGE:
        return "RISK_OFF"
    return "NEUTRAL"


def build_brief(
    source: Source,
    day,
    big_move_threshold: float = DEFAULT_BIG_MOVE_THRESHOLD,
    watchlist_threshold: float = DEFAULT_WATCHLIST_THRESHOLD,
    top_news: int = DEFAULT_TOP_NEWS,
) -> Brief:
    """从数据源构建开市简报。"""
    if big_move_threshold <= 0:
        big_move_threshold = DEFAULT_BIG_MOVE_THRESHOLD
    if watchlist_threshold <= 0:
        watchlist_threshold = DEFAULT_WATCHLIST_THRESHOLD

    snapshots = source.premarket_snapshot()
    headlines = source.headlines()
    events = source.economic_calendar()

    big_moves = sorted(
        (s for s in snapshots if abs(s.change_pct) >= big_move_threshold),
        key=lambda s: s.change_pct,
        reverse=True,
    )
    high_impact = sorted(
        (e for e in events if e.impact == "high"),
        key=lambda e: e.scheduled_at,
    )
    top = sorted(
        headlines,
        key=lambda h: _SENTIMENT_WEIGHT.get(h.sentiment, 1),
        reverse=True,
    )[: max(top_news, 0)]
    watch = sorted(
        (s for s in snapshots if abs(s.change_pct) >= watchlist_threshold),
        key=lambda s: s.change_pct,
        reverse=True,
    )

    return Brief(
        day=str(day),
        stance=_stance(snapshots),
        big_moves=big_moves,
        high_impact_events=high_impact,
        top_headlines=top,
        watchlist_alerts=watch,
    )
