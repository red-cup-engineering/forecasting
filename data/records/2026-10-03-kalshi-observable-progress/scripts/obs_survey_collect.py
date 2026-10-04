#!/usr/bin/env python3
"""Pull all markets (mve_filter=exclude) for observable-progress candidate series; resumable.
Raw output: <outdir>/markets/<SERIES>.jsonl (slim fields). Usage: obs_survey_collect.py OUTDIR [FAMILY ...]"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import *
from obs_families import family
out = sys.argv[1]; fams = set(sys.argv[2:])
HIST = bool(os.environ.get("HIST"))  # HIST=1: archived markets via /historical/markets
SUB = "markets_hist" if HIST else "markets"
os.makedirs(out + "/" + SUB, exist_ok=True)
sp = out + "/series_all.json"
if not os.path.exists(sp):
    json.dump(kget("/series"), open(sp, "w"))
series = json.load(open(sp))["series"]
KEEP = ["ticker","event_ticker","status","result","open_time","close_time","expiration_time","expected_expiration_time","settlement_ts","expiration_value","strike_type","floor_strike","cap_strike","volume_fp","open_interest_fp","last_price_dollars","yes_bid_dollars","yes_ask_dollars","title","yes_sub_title","can_close_early","settlement_value_dollars"]
todo = [s for s in series if family(s) and (not fams or family(s) in fams)]
if os.environ.get("REVERSE"): todo.reverse()
print(len(todo), "series", flush=True)
for i, s in enumerate(todo):
    fp = f"{out}/{SUB}/{s['ticker']}.jsonl"
    if os.path.exists(fp): continue
    rows = []
    for m in paged("/historical/markets" if HIST else "/markets", "markets", series_ticker=s["ticker"], limit=1000, **({} if HIST else {"mve_filter": "exclude"})):
        rows.append({k: m.get(k) for k in KEEP})
    with open(fp + ".tmp", "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    os.rename(fp + ".tmp", fp)
    if i % 50 == 0: print(i, s["ticker"], len(rows), flush=True)
print("done")
