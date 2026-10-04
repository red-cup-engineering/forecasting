"""Queue-aware resting-sell replay for the BTC upside-tail cell. Rest a SELL of YES at the 4h-before-close ask (join the touch), cancel at T-10min.
Fill iff (a) a taker buys YES above our price (sweep) or (b) cumulative taker-buy-YES volume AT our price exceeds Q0 (queue ahead). Maker fee 0.
Q0 not in the compact snapshots -> sensitivity over Q0 in {0,50,200,1000}. usage: maker_tail.py zlo zhi"""
import sys, json, os, collections, numpy as np
sys.path.insert(0, 'scripts')
from kfetch import kget
from common import *
zlo, zhi = float(sys.argv[1]), float(sys.argv[2])
R = json.load(open('data/rows/KXBTCD_rows.json'))
cell = [r for r in R if abs(r['hb']-4) < 1e-9 and zlo <= r['z'] < zhi and r['ask']-r['bid'] <= 0.06 and r['D'] >= '2026-08-06' and 0.02 <= r['ask'] <= 0.5]
print("cell markets", len(cell))
cache = 'data/trades_btcd.json'; T = json.load(open(cache)) if os.path.exists(cache) else {}
for r in cell:
    if r['tk'] in T: continue
    ct = None
    # close time from event: recover via ticker date; use kalshi market lookup (cached in rows? no) -> fetch trades in [t0, close]
    try:
        m = kget(f"/markets/{r['tk']}")['market']; ct = ts(m['close_time'])
        tr = []; cur = ""
        while True:
            q = dict(ticker=r['tk'], min_ts=ct-4*3600-60, max_ts=ct, limit=1000)
            if cur: q['cursor'] = cur
            d = kget("/markets/trades", **q); tr += d.get('trades', []); cur = d.get('cursor')
            if not cur: break
        T[r['tk']] = dict(ct=ct, tr=[(ts(t['created_time']), round(float(t['yes_price_dollars'])*100), float(t['count_fp']), t['taker_side']) for t in tr])
    except Exception as e: print('err', r['tk'], e)
json.dump(T, open(cache, 'w'))
def replay(r, Q0):
    t = T.get(r['tk'])
    if not t: return None
    t0 = t['ct']-4*3600; t1 = t['ct']-10*60; p = round(r['ask']*100); cum = 0.0
    for (tt, pr, n, side) in sorted(t['tr']):
        if tt <= t0 or tt > t1 or side != 'yes': continue
        if pr > p: return ('sweep', r['ask']-r['y'])
        if pr == p:
            cum += n
            if cum > Q0: return ('clean', r['ask']-r['y'])
    return None
print("cell:", f"z[{zlo},{zhi}) rest SELL YES at ask, 4h->10min before close; EV/contract in cents (maker fee 0)")
for Q0 in (0, 50, 200, 1000):
    res = [(replay(r, Q0), r) for r in cell if r['tk'] in T]
    filled = [(x, r) for x, r in res if x]
    ev = collections.defaultdict(list)
    for x, r in filled: ev[r['D']].append(x[1])
    a = np.concatenate([np.array(v) for v in ev.values()]) if ev else np.array([0.])
    ci = boot_ci(ev, np.mean, B=1500) if ev else (0, 0)
    n_clean = sum(1 for x, _ in filled if x[0] == 'clean'); n_sw = len(filled)-n_clean
    ec = np.mean([x[1] for x, _ in filled if x[0] == 'clean']) if n_clean else float('nan'); es = np.mean([x[1] for x, _ in filled if x[0] == 'sweep']) if n_sw else float('nan')
    print(f" Q0={Q0:5d}: placed {len(res)} filled {len(filled)} ({100*len(filled)/max(len(res),1):.0f}%) clean {n_clean} sweep {n_sw}; EV per filled {a.mean()*100:+.2f}c CI[{ci[0]*100:+.1f},{ci[1]*100:+.1f}]; clean {ec*100:+.2f}c sweep {es*100:+.2f}c; EV per placement {a.sum()*100/max(len(res),1):+.2f}c")
