"""数据模型测试。"""

import unittest

from premarket_brief.models import Brief, CalendarEvent, Headline, MarketSnapshot


class ModelTests(unittest.TestCase):
    def test_change_pct_positive(self):
        s = MarketSnapshot("US", "SPX", 5105.0, 5000.0)
        self.assertAlmostEqual(s.change_pct, 2.1, places=3)

    def test_change_pct_negative(self):
        s = MarketSnapshot("US", "NDX", 19480.0, 20000.0)
        self.assertAlmostEqual(s.change_pct, -2.6, places=3)

    def test_change_pct_prev_close_zero(self):
        s = MarketSnapshot("US", "SPX", 100.0, 0.0)
        self.assertEqual(s.change_pct, 0.0)

    def test_models_are_frozen(self):
        s = MarketSnapshot("US", "SPX", 5105.0, 5000.0)
        with self.assertRaises(Exception):
            s.price = 1.0  # type: ignore[misc]  # frozen dataclass 不可变


if __name__ == "__main__":
    unittest.main()
