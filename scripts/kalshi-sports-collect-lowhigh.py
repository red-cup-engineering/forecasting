#!/usr/bin/env python3
"""Re-fetch 1-min candles for [close-4h, close+5m] per market incl. trade price low/high (for realistic maker-fill tests).
usage: kalshi-sports-collect-lowhigh.py DATA_DIR  (reads markets.jsonl, writes candles-lh.jsonl)"""
import sys, json, os, time, urllib.request, urllib.parse, datetime
B = "https://api.elections.kalshi.com/trade-api/v2"
D = sys.argv[1]
def iso(s): return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
def get(params):
    for a in range(5):
        try:
            with urllib.request.urlopen(B + "/markets/candlesticks?" + urllib.parse.urlencode(params), timeout=40) as r: return json.load(r)
        except Exception: time.sleep(1.5 * (a + 1))
ms = [json.loads(l) for l in open(D + "/markets.jsonl")]
ms.sort(key=lambda m: m["close_time"])
out = open(D + "/candles-lh.jsonl", "w")
for i in range(0, len(ms), 25):
    b = ms[i:i+25]
    st = min(iso(m["close_time"]) for m in b) - 4 * 3600; en = max(iso(m["close_time"]) for m in b) + 300
    t = st
    while t < en:
        d = get({"market_tickers": ",".join(m["ticker"] for m in b), "start_ts": t, "end_ts": min(en, t + 6 * 3600), "period_interval": 1}); t += 6 * 3600
        if not d: continue
        for mm in d["markets"]:
            rows = []
            for c in mm["candlesticks"]:
                g = lambda x, k: (lambda v: float(v) if v not in (None, "") else None)((c.get(x) or {}).get(k))
                rows.append([c["end_period_ts"], g("yes_bid","close_dollars"), g("yes_ask","close_dollars"), g("price","close_dollars"), float(c.get("volume_fp") or 0), g("price","low_dollars"), g("price","high_dollars")])
            if rows: out.write(json.dumps({"ticker": mm["market_ticker"], "rows": rows}) + "\n")
    print(i, len(ms), flush=True)
