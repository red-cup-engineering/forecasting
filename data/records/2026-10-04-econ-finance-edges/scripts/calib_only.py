"""Kalshi-only calibration + taker-EV-by-price-bin at a point in time (evening before release). usage: calib_only.py SERIES [hours_before_close=15.4]"""
import sys, json, re, collections, numpy as np
from common import *
S = sys.argv[1]; HB = float(sys.argv[2]) if len(sys.argv) > 2 else 15.4
MAXSP = float(sys.argv[3]) if len(sys.argv) > 3 else 0.10
mk = load_markets(S); cd = json.load(open(f"data/candles/{S}.json"))
rows = []
for t, m in mk.items():
    if t not in cd or m.get('result') not in ('yes', 'no'): continue
    ct = ts(m['close_time']); s = snapshot(cd[t], ct-int(HB*3600), max_age=8*3600)
    if not s or s['bid'] is None or s['ask'] is None: continue
    if s['ask']-s['bid'] > MAXSP: continue
    rows.append(dict(ev=m['event_ticker'], D=m['close_time'][:10], y=int(m['result'] == 'yes'), bid=s['bid'], ask=s['ask'], mid=(s['bid']+s['ask'])/2, vol=s['vol']))
print(S, "markets", len(rows), "events", len(set(r['ev'] for r in rows)), f"snapshot {HB}h before close, spread<={MAXSP}")
if not rows: sys.exit()
b = np.mean([(r['mid']-r['y'])**2 for r in rows]); print(f"Brier(mid) {b:.4f}")
bins = [0, .03, .08, .15, .35, .65, .85, .92, .97, 1.0001]
print(" bin(mid)      n  ev | freq YES | mean mid | takerBuyYES EV/ct [CI] | takerBuyNO EV/ct [CI]   (10-lot fee)")
for lo, hi in zip(bins, bins[1:]):
    g = [r for r in rows if lo <= r['mid'] < hi]
    if len(g) < 8: continue
    dy = collections.defaultdict(list); dn = collections.defaultdict(list)
    for r in g:
        if 0 < r['ask'] < 1: dy[r['ev']].append(r['y']-r['ask']-fee(r['ask']))
        if 0 < r['bid'] < 1: dn[r['ev']].append((1-r['y'])-(1-r['bid'])-fee(1-r['bid']))
    ey = np.concatenate([np.array(v) for v in dy.values()]) if dy else np.array([0.]); en = np.concatenate([np.array(v) for v in dn.values()]) if dn else np.array([0.])
    cy = boot_ci(dy, np.mean) if dy else (0, 0); cn = boot_ci(dn, np.mean) if dn else (0, 0)
    print(f" [{lo:.2f},{min(hi,1):.2f}) {len(g):4d} {len(set(r['ev'] for r in g)):3d} | {np.mean([r['y'] for r in g]):.3f} | {np.mean([r['mid'] for r in g]):.3f} | {ey.mean()*100:+6.2f}c [{cy[0]*100:+.1f},{cy[1]*100:+.1f}] | {en.mean()*100:+6.2f}c [{cn[0]*100:+.1f},{cn[1]*100:+.1f}]")

# train/test: choose among a small pre-declared grid on first 60% of events, evaluate on last 40%
evs = sorted(set((r['D'], r['ev']) for r in rows)); cut = evs[int(len(evs)*0.6)][0]
tr = [r for r in rows if r['D'] <= cut]; te = [r for r in rows if r['D'] > cut]
GRID = [(0.03, 0.35), (0.65, 0.97), (0.03, 0.15), (0.85, 0.97), (0.15, 0.35), (0.65, 0.85)]
def ev_of(g, side):
    d = collections.defaultdict(list)
    for r in g:
        if side == 'yes' and 0 < r['ask'] < 1: d[r['ev']].append(r['y']-r['ask']-fee(r['ask']))
        if side == 'no' and 0 < r['bid'] < 1: d[r['ev']].append((1-r['y'])-(1-r['bid'])-fee(1-r['bid']))
    return d
cands = []
for lo, hi in GRID:
    for side in ('yes', 'no'):
        d = ev_of([r for r in tr if lo <= r['mid'] < hi], side); n = sum(len(v) for v in d.values())
        if n >= 20: cands.append((np.mean(np.concatenate([np.array(v) for v in d.values()])), lo, hi, side, n))
print(f"\nTrain (<= {cut}, {len(set(r['ev'] for r in tr))} events) best pre-declared cell and its held-out result (test {len(set(r['ev'] for r in te))} events):")
for e, lo, hi, side, n in sorted(cands, reverse=True)[:3]:
    d = ev_of([r for r in te if lo <= r['mid'] < hi], side); n2 = sum(len(v) for v in d.values())
    if not n2: continue
    a = np.concatenate([np.array(v) for v in d.values()]); ci = boot_ci(d, np.mean)
    print(f"  buy {side.upper()} mid[{lo},{hi}): train {e*100:+.2f}c (n={n})  TEST {a.mean()*100:+.2f}c CI[{ci[0]*100:+.1f},{ci[1]*100:+.1f}] n={n2} events={len(d)}")
