#!/usr/bin/env python3
"""Forward collector: AAA national average gas price + Kalshi gas-market books, every INTERVAL seconds.
Sources: gasprices.aaa.com front page (robots.txt: Crawl-delay 10, no disallow of /; we make 1 request per tick, default
15 min, conditional GET) and Kalshi public API (3 list calls per tick).  Honest User-Agent.  Nothing is traded.
Output: <out>/aaa-gas-YYYY-MM-DD.jsonl  (UTC day files, append-only, resumable: just start it again).
Bounded: exits after --hours (default 168) or --max-ticks.  Memory: <40 MB.
  python3 obs_gas_collect.py --out ../collector --interval 900 --hours 168
Keep running: `nohup python3 obs_gas_collect.py ... &` or a systemd user timer calling it with --once every 15 min."""
import argparse, json, os, re, sys, time, datetime as dt, urllib.request, urllib.error, random
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import kget, UA
ap = argparse.ArgumentParser()
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "collector"))
ap.add_argument("--interval", type=int, default=900)
ap.add_argument("--hours", type=float, default=168)
ap.add_argument("--max-ticks", type=int, default=0)
ap.add_argument("--once", action="store_true")
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
URL = "https://gasprices.aaa.com/"
state = {"etag": None, "lm": None}
def num(s): return float(s.replace("$", "").replace(",", ""))
def fetch_aaa():
    h = {"User-Agent": UA}
    if state["etag"]: h["If-None-Match"] = state["etag"]
    if state["lm"]: h["If-Modified-Since"] = state["lm"]
    try:
        with urllib.request.urlopen(urllib.request.Request(URL, headers=h), timeout=30) as r:
            html = r.read().decode("utf8", "replace")
            state["etag"] = r.headers.get("ETag"); state["lm"] = r.headers.get("Last-Modified")
            hdr_lm = r.headers.get("Last-Modified")
    except urllib.error.HTTPError as e:
        if e.code == 304: return {"unchanged": True}
        return {"error": e.code}
    except Exception as e:
        return {"error": str(e)[:80]}
    out = {"page_last_modified": hdr_lm}
    m = re.search(r"National Average\s*\$([0-9.]+)", html); out["national_avg"] = float(m[1]) if m else None
    m = re.search(r"Price as of\s*([0-9/]+)", html); out["as_of"] = m[1] if m else None
    for key, lab in (("yesterday", "Yesterday Avg."), ("week_ago", "Week Ago Avg."), ("month_ago", "Month Ago Avg."), ("year_ago", "Year Ago Avg.")):
        m = re.search(re.escape(lab) + r"</td>\s*<td>\$([0-9.]+)", html); out[key] = float(m[1]) if m else None
    return out
def fetch_kalshi(cur):
    rows = []
    for ser, band in (("KXAAAGASD", 0.06), ("KXAAAGASW", 0.12), ("KXAAAGASM", 0.35)):
        d = kget("/markets", series_ticker=ser, status="open", limit=200, mve_filter="exclude")
        for m in (d or {}).get("markets", []):
            K = m.get("floor_strike")
            if cur and K is not None and abs(K - cur) > band: continue
            rows.append([m["ticker"], K, m.get("yes_bid_dollars"), m.get("yes_ask_dollars"), m.get("last_price_dollars"),
                         m.get("volume_fp"), m.get("open_interest_fp"), m.get("close_time")])
    return rows
def tick():
    now = dt.datetime.now(dt.timezone.utc)
    aaa = fetch_aaa()
    cur = aaa.get("national_avg") or getattr(tick, "last", None)
    if aaa.get("national_avg"): tick.last = aaa["national_avg"]
    rec = {"ts": now.isoformat(timespec="seconds"), "aaa": aaa, "markets": fetch_kalshi(cur)}
    fp = os.path.join(a.out, f"aaa-gas-{now:%Y-%m-%d}.jsonl")
    with open(fp, "a") as f: f.write(json.dumps(rec, separators=(",", ":")) + "\n")
    return rec
t0 = time.time(); n = 0
while True:
    r = tick(); n += 1
    print(r["ts"], r["aaa"].get("national_avg"), r["aaa"].get("as_of"), len(r["markets"]), flush=True)
    if a.once or (a.max_ticks and n >= a.max_ticks) or time.time() - t0 > a.hours * 3600: break
    time.sleep(a.interval + random.uniform(-30, 30))
