#!/usr/bin/env python3
"""Aggregate raw market dumps into the family/series survey. Usage: obs_survey_report.py RAWDIR"""
import sys, os, json, glob, collections, statistics
sys.path.insert(0, os.path.dirname(__file__))
from obs_families import family
raw = sys.argv[1]
series = {s["ticker"]: s for s in json.load(open(raw + "/series_all.json"))["series"]}
inc = json.load(open(raw + "/incentives.json")) if os.path.exists(raw + "/incentives.json") else []
lip = collections.defaultdict(lambda: [0, 0.0, set()])
for p in inc:
    st = p["market_ticker"].split("-")[0]
    lip[st][0] += 1; lip[st][1] += p.get("period_reward", 0) / 1e4 / 100  # reward units: centi-cents? keep raw/1e6
    lip[st][2].add(p["market_ticker"])
def f(x):
    try: return float(x)
    except: return 0.0
fam = collections.defaultdict(lambda: dict(series=0, settled=0, events=set(), vol=0.0, openm=0, openvol=0.0, lip=0))
rows = []
def load(st):
    d = {}
    for sub in ("markets_hist", "markets"):
        fp = f"{raw}/{sub}/{st}.jsonl"
        if os.path.exists(fp):
            for l in open(fp):
                m = json.loads(l); d[m["ticker"]] = m
    return list(d.values())
for fp in sorted(glob.glob(raw + "/markets/*.jsonl")):
    st = os.path.basename(fp)[:-6]; s = series[st]; fm = family(s)
    ms = load(st)
    settled = [m for m in ms if m["status"] in ("finalized", "settled")]
    opn = [m for m in ms if m["status"] in ("active", "open")]
    vol = sum(f(m["volume_fp"]) for m in settled)
    ev = {m["event_ticker"] for m in settled}
    d = fam[fm]; d["series"] += 1; d["settled"] += len(settled); d["events"] |= ev; d["vol"] += vol
    d["openm"] += len(opn); d["openvol"] += sum(f(m["volume_fp"]) for m in opn); d["lip"] += lip[st][0]
    rows.append((fm, st, s["title"][:50], s["frequency"], s["fee_type"], len(settled), len(ev), vol, len(opn), lip[st][0],
                 (s.get("settlement_sources") or [{}])[0].get("name")))
print("family | series | settled mkts | settled events | settled vol (contracts) | open mkts | LIP programs")
for fm, d in sorted(fam.items(), key=lambda kv: -kv[1]["vol"]):
    print(f"{fm} | {d['series']} | {d['settled']} | {len(d['events'])} | {d['vol']:.0f} | {d['openm']} | {d['lip']}")
print("\nTop series by settled volume per family (top 6)")
by = collections.defaultdict(list)
for r in rows: by[r[0]].append(r)
for fm, rs in by.items():
    print("\n##", fm)
    for r in sorted(rs, key=lambda r: -r[7])[:6]:
        print(f"{r[1]} | {r[2]} | {r[3]} | {r[4]} | settled {r[5]} mkts/{r[6]} ev | vol {r[7]:.0f} | open {r[8]} | LIP {r[9]} | src {r[10]}")
