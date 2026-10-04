#!/usr/bin/env python3
"""List settled markets per class -> data/markets-<class>.jsonl.  usage: collect_markets.py CLASS [max_markets]
Event-level sampling (seeded) caps each class so all markets of a sampled event are kept."""
import sys, json, time, random, os
from bp_common import *
from classes import *
cls = sys.argv[1]; cap = int(sys.argv[2]) if len(sys.argv) > 2 else 1800
cfg = CLASSES[cls]; now = int(time.time())
fee = {r[1]: r[3] for r in json.load(open(os.path.join(DATA, "series-all.json")))}
out = []
for s in series_for(cls, DATA):
    cur = None; n = 0
    while True:
        p = {"series_ticker": s, "status": "settled", "min_close_ts": now - cfg["days"] * 86400, "limit": 1000, "mve_filter": "exclude"}
        if cur: p["cursor"] = cur
        d = get("/markets", p)
        if not d: break
        for m in d["markets"]:
            if m.get("result") not in ("yes", "no"): continue
            if float(m.get("volume_fp") or 0) < 1: continue  # never traded: no path to study
            r = {k: m.get(k) for k in ("ticker","event_ticker","close_time","occurrence_datetime","expected_expiration_time","open_time","result","yes_sub_title","title","volume_fp")}
            r["series"] = s; r["fee_type"] = fee.get(s); r["cls"] = cls; out.append(r); n += 1
        cur = d.get("cursor")
        if not cur: break
    print(cls, s, n, flush=True)
ev = sorted({r["event_ticker"] for r in out}); random.Random(7).shuffle(ev)
keep, c = set(), 0
cnt = {}
for r in out: cnt[r["event_ticker"]] = cnt.get(r["event_ticker"], 0) + 1
for e in ev:
    if c + cnt[e] > cap: continue
    keep.add(e); c += cnt[e]
with open(os.path.join(DATA, f"markets-{cls}.jsonl"), "w") as f:
    for r in out:
        if r["event_ticker"] in keep: f.write(json.dumps(r) + "\n")
print(cls, "total", len(out), "kept", c, "events", len(keep), flush=True)
