"""CLI：`python3 -m premarket_brief` 生成开市前简报。"""

from __future__ import annotations

import argparse
import datetime

from .sources import SampleSource
from .summary import build_brief


def render(brief) -> str:
    lines = [f"# Pre-Market Brief · {brief.day}", ""]
    lines.append(f"**Market stance:** {brief.stance}")

    lines += ["", "## Notable moves"]
    if brief.big_moves:
        for s in brief.big_moves:
            lines.append(f"- {s.index} ({s.region}) {s.change_pct:+.2f}%  [{s.price:.2f} vs {s.prev_close:.2f}]")
    else:
        lines.append("- none")

    lines += ["", "## High-impact events today"]
    if brief.high_impact_events:
        for e in brief.high_impact_events:
            lines.append(f"- **{e.name}** ({e.region}) · {e.scheduled_at}")
    else:
        lines.append("- none")

    lines += ["", "## Top headlines"]
    if brief.top_headlines:
        for h in brief.top_headlines:
            tag = f"[{h.ticker}] " if h.ticker else ""
            lines.append(f"- {tag}{h.text}")
    else:
        lines.append("- none")

    lines += ["", "## Watchlist alerts"]
    if brief.watchlist_alerts:
        for s in brief.watchlist_alerts:
            lines.append(f"- {s.index} ({s.region}) {s.change_pct:+.2f}%")
    else:
        lines.append("- none")

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(prog="premarket_brief", description="开市前市场简报")
    ap.add_argument("--source", default="sample", choices=["sample"], help="数据源（示例内置样例源）")
    ap.add_argument("--watchlist-threshold", type=float, default=2.0, help="自选股异动阈值（百分比），默认 2.0")
    ap.add_argument("--big-move-threshold", type=float, default=1.0, help="显著异动阈值（百分比），默认 1.0")
    ap.add_argument("--top-news", type=int, default=5, help="重点新闻条数，默认 5")
    ap.add_argument("--day", default=None, help="指定简报日期（默认当天，便于复现可传入固定日期）")
    args = ap.parse_args(argv)

    source = SampleSource()
    day = args.day or datetime.date.today().isoformat()
    brief = build_brief(
        source,
        day,
        big_move_threshold=args.big_move_threshold,
        watchlist_threshold=args.watchlist_threshold,
        top_news=args.top_news,
    )
    print(render(brief))


if __name__ == "__main__":
    main()
