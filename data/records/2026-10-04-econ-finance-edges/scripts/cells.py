"""Taker EV by moneyness cell (z in model-sigma units, strike vs spot) and side; train/test split by date (60/40). usage: cells.py results/X_rows.json horizon [min_mid max_mid]"""
import sys, json, collections, numpy as np
from common import *
R = json.load(open(sys.argv[1])); H = float(sys.argv[2])
G = [r for r in R if abs(r['hb']-H) < 1e-9 and 0.01 <= r['mid'] <= 0.99 and r['ask']-r['bid'] <= 0.06]
days = sorted(set(r['D'] for r in G)); cut = days[int(len(days)*0.6)]
bins = [(-9, -2), (-2, -1), (-1, -.5), (-.5, 0), (0, .5), (.5, 1), (1, 2), (2, 9)]
def ev(g, side):
    d = collections.defaultdict(list)
    for r in g:
        if side == 'YES' and 0 < r['ask'] < 1: d[r['D']].append(r['y']-r['ask']-fee(r['ask']))
        if side == 'NO' and 0 < r['bid'] < 1: d[r['D']].append((1-r['y'])-(1-r['bid'])-fee(1-r['bid']))
    return d
def fmt(d):
    if not d: return "n=0"
    a = np.concatenate([np.array(v) for v in d.values()]); ci = boot_ci(d, np.mean, B=1500)
    return f"n={len(a):4d} d={len(d):3d} {a.mean()*100:+6.2f}c [{ci[0]*100:+.1f},{ci[1]*100:+.1f}]"
print(f"horizon {H}h  rows {len(G)} days {len(days)} cut {cut} (spread<=6c, 1c<=mid<=99c)")
for lo, hi in bins:
    for side in ('YES', 'NO'):
        gt = [r for r in G if lo <= r['z'] < hi and r['D'] <= cut]; ge = [r for r in G if lo <= r['z'] < hi and r['D'] > cut]
        if len(gt) < 15: continue
        print(f" z[{lo:+.1f},{hi:+.1f}) buy {side:3s}  TRAIN {fmt(ev(gt, side))}   TEST {fmt(ev(ge, side))}")
