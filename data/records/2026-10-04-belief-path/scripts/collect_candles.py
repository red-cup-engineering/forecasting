#!/usr/bin/env python3
"""1-minute candles (bid close, ask close, trade close/low/high, volume, open interest) per class -> data/candles-<class>.jsonl.
usage: collect_candles.py CLASS. Resumable (skips tickers already written). Rows: [end_ts,bid,ask,price,vol,plow,phigh,oi] in dollars (None when absent)."""
import sys, json, os, datetime
from bp_common import *
from classes import *
cls = sys.argv[1]; cfg = CLASSES[cls]
def iso(s): return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
ms = [json.loads(l) for l in open(os.path.join(DATA, f"markets-{cls}.jsonl"))]
outp = os.path.join(DATA, f"candles-{cls}.jsonl")
done = set()
if os.path.exists(outp):
    for l in open(outp):
        try: done.add(json.loads(l)["ticker"])
        except Exception: pass
def window(m):
    close = iso(m["close_time"]); op = iso(m["open_time"])
    if cls.startswith("sports"):
        st = iso(m["occurrence_datetime"] or m["open_time"]) - 3 * 3600
        return max(st, op), close + 300
    return max(op, close - cfg["win_h"] * 3600), close + 60
todo = [m for m in ms if m["ticker"] not in done]
todo.sort(key=lambda m: (window(m)[0], m["ticker"]))
out = open(outp, "a")
def g(c, x, k):
    v = (c.get(x) or {}).get(k); return float(v) if v not in (None, "") else None
i = 0
while i < len(todo):
    batch = todo[i:i + 20]; i += 20
    ws = [window(m) for m in batch]
    st = min(w[0] for w in ws); en = max(w[1] for w in ws)
    rows = {m["ticker"]: [] for m in batch}
    t = st
    while t < en:
        d = get("/markets/candlesticks", {"market_tickers": ",".join(rows), "start_ts": t, "end_ts": min(en, t + 6 * 3600), "period_interval": 1})
        t += 6 * 3600
        if not d: continue
        for mm in d["markets"]:
            for c in mm["candlesticks"]:
                rows[mm["market_ticker"]].append([c["end_period_ts"], g(c, "yes_bid", "close_dollars"), g(c, "yes_ask", "close_dollars"), g(c, "price", "close_dollars"), float(c.get("volume_fp") or 0), g(c, "price", "low_dollars"), g(c, "price", "high_dollars"), float(c.get("open_interest_fp") or 0)])
    for m, w in zip(batch, ws):
        r = [x for x in rows[m["ticker"]] if w[0] <= x[0] <= w[1]]
        out.write(json.dumps({"ticker": m["ticker"], "rows": r}) + "\n")
    out.flush()
    print(cls, i, "/", len(todo), flush=True)
