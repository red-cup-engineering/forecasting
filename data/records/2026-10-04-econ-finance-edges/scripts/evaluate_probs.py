"""Generic evaluator. rows: ev, D, y, bid, ask, mid, pn (reference prob). Compares Kalshi mid vs reference vs blend; EV of trading toward blend.
usage: evaluate_probs.py results/X_rows.json [split_date] [pcol]"""
import sys, json, math, numpy as np, collections
from common import *
f = sys.argv[1]; split = sys.argv[2] if len(sys.argv) > 2 else None; pc = sys.argv[3] if len(sys.argv) > 3 else 'pn'
R = json.load(open(f))
for r in R: r['p'] = r[pc]
clip = lambda p: min(max(p, 0.01), 0.99)
logit = lambda p: math.log(clip(p)/(1-clip(p))); sig = lambda x: 1/(1+math.exp(-x))
def brier(p, y): return (p-y)**2
def ll(p, y): p = clip(p); return -(y*math.log(p)+(1-y)*math.log(1-p))
def cluster(rows, fn):
    d = collections.defaultdict(list)
    for r in rows: d[r['ev']].append(fn(r))
    return d
def rep(name, rows):
    if not rows: return
    print(f"-- {name}: {len(rows)} markets, {len(set(r['ev'] for r in rows))} events")
    for lab, g in [('kalshi mid', lambda r: r['mid']), ('reference', lambda r: r['p']), ('blend0.5', lambda r: sig(0.5*logit(r['mid'])+0.5*logit(r['p'])))]:
        b = np.mean([brier(g(r), r['y']) for r in rows]); l = np.mean([ll(g(r), r['y']) for r in rows])
        print(f"   {lab:11s} Brier {b:.4f}  logloss {l:.4f}")
    for a, bb, lab in [('mid', 'p', 'Brier(kalshi)-Brier(ref)')]:
        d = cluster(rows, lambda r: brier(r['mid'], r['y'])-brier(r['p'], r['y']))
        m = np.mean(np.concatenate([np.array(v) for v in d.values()])); lo, hi = boot_ci(d, np.mean)
        d2 = cluster(rows, lambda r: ll(r['mid'], r['y'])-ll(r['p'], r['y']))
        m2 = np.mean(np.concatenate([np.array(v) for v in d2.values()])); lo2, hi2 = boot_ci(d2, np.mean)
        print(f"   {lab}: {m:+.4f} [{lo:+.4f},{hi:+.4f}]  logloss diff {m2:+.4f} [{lo2:+.3f},{hi2:+.3f}] (negative = Kalshi better)")
def caltable(rows):
    bins = [0, .05, .15, .35, .65, .85, .95, 1.0001]
    print("   calibration (bin by Kalshi mid): n | mean mid | mean ref | freq YES")
    for lo, hi in zip(bins, bins[1:]):
        g = [r for r in rows if lo <= r['mid'] < hi]
        if g: print(f"   [{lo:.2f},{min(hi,1):.2f}) {len(g):4d} | {np.mean([r['mid'] for r in g]):.3f} | {np.mean([r['p'] for r in g]):.3f} | {np.mean([r['y'] for r in g]):.3f}")
def fitw(rows):
    best = None
    for w in np.arange(0, 1.01, 0.1):
        l = np.mean([ll(sig((1-w)*logit(r['mid'])+w*logit(r['p'])), r['y']) for r in rows])
        if best is None or l < best[1]: best = (w, l)
    return best[0]
def trade(rows, w, theta, n=10, fee_rate=0.07):
    out = []
    for r in rows:
        pb = sig((1-w)*logit(r['mid'])+w*logit(r['p']))
        if r['ask'] <= 0.99 and r['ask'] > 0 and pb-r['ask']-fee(r['ask'], n, fee_rate) > theta and r['vol'] is not None:
            out.append((r['ev'], r['y']-r['ask']-fee(r['ask'], n, fee_rate)))
        elif r['bid'] >= 0.01 and r['bid'] < 1 and r['bid']-pb-fee(1-r['bid'], n, fee_rate) > theta:
            out.append((r['ev'], (1-r['y'])-(1-r['bid'])-fee(1-r['bid'], n, fee_rate)))
    return out
def summarize_trades(tr, label):
    if not tr: print(f"   {label}: no trades"); return
    d = collections.defaultdict(list)
    for e, p in tr: d[e].append(p)
    allp = np.array([p for _, p in tr]); lo, hi = boot_ci(d, np.mean)
    print(f"   {label}: n={len(tr)} events={len(d)} mean EV/contract {allp.mean()*100:+.2f}c  CI[{lo*100:+.2f},{hi*100:+.2f}]c  total(10-lots) ${allp.sum()*10:+.1f}")
rows = sorted(R, key=lambda r: r['D'])
rep("ALL", rows); caltable(rows)
if split:
    tr_ = [r for r in rows if r['D'] <= split]; te = [r for r in rows if r['D'] > split]
    rep(f"TRAIN <= {split}", tr_); rep(f"TEST > {split}", te)
    w = fitw(tr_); print(f"   fitted blend weight on reference (train): {w:.1f}")
    for theta in (0.0, 0.02, 0.05, 0.10):
        summarize_trades(trade(tr_, w, theta), f"train theta={theta:.2f}")
        summarize_trades(trade(te, w, theta), f"TEST  theta={theta:.2f}")
    print("   -- using w=1.0 (pure reference), TEST only")
    for theta in (0.02, 0.05, 0.10): summarize_trades(trade(te, 1.0, theta), f"TEST w=1 theta={theta:.2f}")
    print("   -- fee sensitivity none (frictionless) at TEST w fitted theta .05")
    summarize_trades(trade(te, w, 0.05, fee_rate=0.0), "TEST nofee")
