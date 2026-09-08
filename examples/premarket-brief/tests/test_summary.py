"""分析摘要测试：风向 / 显著异动 / 高影响事件 / 重点新闻 / 自选股提示。"""

import unittest

from premarket_brief.models import CalendarEvent, Headline, MarketSnapshot
from premarket_brief.sources import SampleSource
from premarket_brief.summary import build_brief


def _snap(region, index, chg):
    # 用一张固定昨收反推价格，得到精确涨跌幅
    prev = 1000.0
    price = prev * (1 + chg / 100.0)
    return MarketSnapshot(region, index, price, prev)


class _FakeSource:
    """覆盖样例数据用于边界/定向测试。"""

    def __init__(self, snapshots=None, headlines=None, events=None):
        self._s = snapshots or []
        self._h = headlines or []
        self._e = events or []

    def premarket_snapshot(self):
        return list(self._s)

    def headlines(self):
        return list(self._h)

    def economic_calendar(self):
        return list(self._e)


class StanceTests(unittest.TestCase):
    def test_risk_on(self):
        src = _FakeSource(snapshots=[_snap("US", "SPX", 1.0)])
        self.assertEqual(build_brief(src, "2026-09-08").stance, "RISK_ON")

    def test_risk_off(self):
        src = _FakeSource(snapshots=[_snap("US", "NDX", -1.0)])
        self.assertEqual(build_brief(src, "2026-09-08").stance, "RISK_OFF")

    def test_neutral(self):
        src = _FakeSource(snapshots=[_snap("US", "SPX", 0.1)])
        self.assertEqual(build_brief(src, "2026-09-08").stance, "NEUTRAL")

    def test_empty_neutral(self):
        self.assertEqual(build_brief(_FakeSource(), "2026-09-08").stance, "NEUTRAL")


class AnalysisTests(unittest.TestCase):
    def test_big_moves_threshold(self):
        snaps = [_snap("US", "SPX", 2.0), _snap("US", "NDX", -0.5), _snap("JP", "N225", 0.3)]
        b = build_brief(_FakeSource(snapshots=snaps), "2026-09-08", big_move_threshold=1.0)
        self.assertEqual([s.index for s in b.big_moves], ["SPX"])

    def test_high_impact_filtered(self):
        events = [
            CalendarEvent("US", "CPI YoY", "high", "08:30 ET"),
            CalendarEvent("US", "Jobless Claims", "medium", "08:30 ET"),
        ]
        b = build_brief(_FakeSource(events=events), "2026-09-08")
        self.assertEqual([e.name for e in b.high_impact_events], ["CPI YoY"])

    def test_top_headlines_sentiment_ordered(self):
        hs = [
            Headline("", "neutral one", "neutral"),
            Headline("", "negative one", "negative"),
            Headline("", "positive one", "positive"),
        ]
        b = build_brief(_FakeSource(headlines=hs), "2026-09-08", top_news=3)
        self.assertEqual([h.text for h in b.top_headlines], ["positive one", "neutral one", "negative one"])

    def test_watchlist_alerts_threshold(self):
        snaps = [_snap("US", "SPX", 2.5), _snap("US", "NDX", -1.0)]
        b = build_brief(_FakeSource(snapshots=snaps), "2026-09-08", watchlist_threshold=2.0)
        self.assertEqual([s.index for s in b.watchlist_alerts], ["SPX"])

    def test_threshold_le_zero_falls_back(self):
        snaps = [_snap("US", "SPX", 1.5)]
        b = build_brief(_FakeSource(snapshots=snaps), "2026-09-08", watchlist_threshold=0)
        # 0 触发回退到默认 2.0，1.5 < 2.0 → 无自选股提示
        self.assertEqual(b.watchlist_alerts, [])


class SampleIntegrationTests(unittest.TestCase):
    def test_build_brief_from_sample(self):
        b = build_brief(SampleSource(), "2026-09-08")
        self.assertEqual(b.stance, "RISK_ON")                       # 样例平均 +0.76%
        self.assertIn("SPX", [s.index for s in b.big_moves])        # +2.1% 显著异动
        self.assertIn("NDX", [s.index for s in b.big_moves])        # -2.6% 显著异动
        self.assertEqual(b.high_impact_events[0].name, "CPI YoY")   # 按时间排序的第一个高影响
        self.assertEqual(b.top_headlines[0].sentiment, "positive")  # 重点新闻正面优先
        self.assertEqual([s.index for s in b.watchlist_alerts], ["SPX", "NDX"])  # >=2% 触发


if __name__ == "__main__":
    unittest.main()
