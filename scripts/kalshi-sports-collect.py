#!/usr/bin/env python3
"""Collect settled Kalshi game-winner markets + 1-min candles for the last N days.
Streams to JSONL in OUT dir (default scratch). No credentials; public API only.
usage: kalshi-sports-collect.py OUT_DIR [days=24]"""
import sys, json, time, urllib.request, urllib.parse, os, datetime
B = "https://api.elections.kalshi.com/trade-api/v2"
SERIES = ["KXNFLGAME","KXNCAAFGAME","KXMLBGAME","KXWNBAGAME","KXNHLGAME","KXNBAGAME","KXEPLGAME","KXUCLGAME",
          "KXLALIGAGAME","KXBUNDESLIGAGAME","KXSERIEAGAME","KXLIGUE1GAME","KXMLSGAME","KXATPMATCH","KXWTAMATCH"]
_last = [0.0]
def get(path, params):
    for attempt in range(5):
        dt = time.time() - _last[0]
        if dt < 0.1: time.sleep(0.1 - dt)
        _last[0] = time.time()
        url = B + path + "?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=40) as r: return json.load(r)
        except Exception as e:
            time.sleep(1.5 * (attempt + 1))
    return None
def iso(s): return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
def main():
    out = sys.argv[1]; days = int(sys.argv[2]) if len(sys.argv) > 2 else 24
    os.makedirs(out, exist_ok=True)
    now = int(time.time()); mn = now - days * 86400
    mk = open(os.path.join(out, "markets.jsonl"), "w")
    allm = []
    for s in SERIES:
        cur = None; n = 0
        while True:
            p = {"series_ticker": s, "status": "settled", "min_close_ts": mn, "limit": 1000, "mve_filter": "exclude"}
            if cur: p["cursor"] = cur
            d = get("/markets", p)
            if not d: break
            for m in d["markets"]:
                if m.get("result") not in ("yes", "no"): continue
                r = {k: m.get(k) for k in ("ticker","event_ticker","close_time","occurrence_datetime","expected_expiration_time","open_time","result","yes_sub_title","title","volume_fp")}
                r["series"] = s; mk.write(json.dumps(r) + "\n"); allm.append(r); n += 1
            cur = d.get("cursor")
            if not cur: break
        print(s, n, flush=True)
    mk.close()
    cf = open(os.path.join(out, "candles.jsonl"), "w")
    # group by event window; fetch per-ticker with window = [occurrence-3h, close+10m]
    allm.sort(key=lambda r: r["close_time"])
    i = 0
    while i < len(allm):
        batch = allm[i:i+20]; i += 20
        st = min(iso(r["occurrence_datetime"] or r["open_time"]) for r in batch) - 3 * 3600
        en = max(iso(r["close_time"]) for r in batch) + 600
        # 1-min candles; cap 10000 per call: 20 tickers * window must be < 10000 mins-> split window if long
        span = en - st
        chunks = []
        t = st
        while t < en:
            chunks.append((t, min(en, t + 6 * 3600 * 1))); t += 6 * 3600
        for a, b in chunks:
            d = get("/markets/candlesticks", {"market_tickers": ",".join(r["ticker"] for r in batch), "start_ts": a, "end_ts": b, "period_interval": 1})
            if not d: continue
            for mm in d["markets"]:
                rows = []
                for c in mm["candlesticks"]:
                    def f(x, k): 
                        v = (c.get(x) or {}).get(k); return float(v) if v not in (None, "") else None
                    rows.append([c["end_period_ts"], f("yes_bid","close_dollars"), f("yes_ask","close_dollars"), f("price","close_dollars"), float(c.get("volume_fp") or 0)])
                if rows: cf.write(json.dumps({"ticker": mm["market_ticker"], "rows": rows}) + "\n")
        print("candles", i, "/", len(allm), flush=True)
    cf.close()
main()
