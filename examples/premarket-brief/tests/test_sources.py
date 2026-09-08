"""数据源测试：契约 + 确定性 + 多源合并去重。"""

import unittest

from premarket_brief.models import CalendarEvent, Headline, MarketSnapshot
from premarket_brief.sources import CompositeSource, SampleSource


class SampleSourceTests(unittest.TestCase):
    def setUp(self):
        self.s = SampleSource()

    def test_snapshot_contract(self):
        snaps = self.s.premarket_snapshot()
        self.assertGreater(len(snaps), 0)
        for x in snaps:
            self.assertIsInstance(x, MarketSnapshot)
            self.assertTrue(x.region and x.index and x.price > 0)

    def test_headline_contract(self):
        hs = self.s.headlines()
        self.assertGreater(len(hs), 0)
        for h in hs:
            self.assertIsInstance(h, Headline)
            self.assertIn(h.sentiment, ("positive", "negative", "neutral"))

    def test_calendar_contract(self):
        evs = self.s.economic_calendar()
        self.assertGreater(len(evs), 0)
        for e in evs:
            self.assertIsInstance(e, CalendarEvent)
            self.assertIn(e.impact, ("high", "medium", "low"))

    def test_deterministic(self):
        # 同一输入 → 同一输出（静态样例，无随机/时间依赖）
        self.assertEqual(self.s.premarket_snapshot(), self.s.premarket_snapshot())
        self.assertEqual(self.s.headlines(), self.s.headlines())


class CompositeSourceTests(unittest.TestCase):
    def test_merge_and_dedupe(self):
        a = SampleSource()
        b = SampleSource()  # 完全重叠，合并后应去重
        c = CompositeSource(a, b)
        self.assertEqual(len(c.premarket_snapshot()), len(a.premarket_snapshot()))
        self.assertEqual(len(c.headlines()), len(a.headlines()))
        self.assertEqual(len(c.economic_calendar()), len(a.economic_calendar()))

    def test_union_keeps_distinct(self):
        class Extra(CompositeSource):
            pass

        # 一个仅含一条额外快照的源
        class Small(CompositeSource):
            def premarket_snapshot(self):
                return [MarketSnapshot("US", "RUT", 2100.0, 2080.0)]

        c = CompositeSource(SampleSource(), Small())
        regions = {(x.region, x.index) for x in c.premarket_snapshot()}
        self.assertIn(("US", "RUT"), regions)
        self.assertIn(("US", "SPX"), regions)  # 样例数据仍在


if __name__ == "__main__":
    unittest.main()
