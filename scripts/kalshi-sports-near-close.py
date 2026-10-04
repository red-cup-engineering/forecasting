#!/usr/bin/env python3
"""(a) Point-in-time favorites: buy YES at first minute whose ask is in [lo,hi]; fill = ask of the NEXT minute (1-min latency).
usage: kalshi-sports-near-close.py DATA_DIR"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_sports_lib import *
D = sys.argv[1]
M = load_markets(D + "/markets.jsonl")
BANDS = [(0.90, 0.93), (0.93, 0.96), (0.96, 0.98), (0.90, 0.98)]
entries = {b: [] for b in BANDS}
for t, rows in load_candles(D + "/candles.jsonl"):
    m = M[t]; close = ts(m["close_time"])
    rows = [r for r in rows if r[0] <= close + 60 and r[2] is not None and r[1] is not None]
    for b in BANDS:
        for i in range(len(rows) - 1):
            ask = rows[i][2]
            if b[0] <= ask < b[1] and rows[i][4] > 0:
                fill = rows[i + 1][2]
                if fill is None or fill > 0.98 or fill < 0.90: continue
                win = 1 if m["result"] == "yes" else 0
                fee = fee_per_contract(fill, m["series"])
                entries[b].append(dict(event=m["event_ticker"], date=m["close_time"][:10], series=m["series"], sport=sport(m["series"]),
                    p=fill, win=win, pnl=win - fill - fee, mins_to_close=(close - rows[i][0]) / 60, ts=rows[i][0]))
                break
out = []
for b in BANDS:
    seen = {}
    for e in sorted(entries[b], key=lambda e: e['ts']): seen.setdefault(e['event'], e)
    E = list(seen.values())
    out.append("== band %.2f-%.2f  (distinct games, first crossing, fee 100-lot taker) ==" % b)
    out.append(report("ALL", E))
    dates = sorted(set(e["date"] for e in E)); mid = dates[len(dates) // 2] if dates else ""
    out.append(report("  fit (<%s)" % mid, [e for e in E if e["date"] < mid]))
    out.append(report("  test (>=%s)" % mid, [e for e in E if e["date"] >= mid]))
    for sp in sorted(set(e["sport"] for e in E)):
        out.append(report("  " + sp, [e for e in E if e["sport"] == sp]))
    for lo, hi in [(0, 30), (30, 120), (120, 1e9)]:
        out.append(report("  mins_to_close %d-%s" % (lo, "inf" if hi > 1e8 else hi), [e for e in E if lo <= e["mins_to_close"] < hi]))
print("\n".join(out))
