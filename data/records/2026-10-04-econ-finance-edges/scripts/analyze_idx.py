"""usage: analyze_idx.py SERIES(KXINXU|KXNASDAQ100U) SPOT(SPX|NDX) VOL(VIX|VXN) offsets_min(e.g. 240,120,60)"""
import sys, json, math, bisect, numpy as np
from scipy.stats import norm
from common import *
S, SP, VX = sys.argv[1], sys.argv[2], sys.argv[3]; OFF = [int(x) for x in sys.argv[4].split(',')]
ev = json.load(open(f"data/range/{S}.json"))
sp = json.load(open(f"data/ext/{SP}.json")); st = [a for a, _ in sp]; sc = [b for _, b in sp]
vx = json.load(open(f"data/ext/{VX}.json")); vt = [a for a, _ in vx]; vc = [b for _, b in vx]
def spot(t):
    i = bisect.bisect_right(st, t)-1
    return sc[i] if i >= 0 and t-st[i] < 600 else None
def vix_prev(t):  # prior session close: last daily bar opening before 00:00Z of t's date
    j = bisect.bisect_left(vt, t-(t % 86400))-1
    return vc[j]/100 if j >= 0 else None
def rvol(t, days=5):
    i = bisect.bisect_right(st, t)-1; j = bisect.bisect_right(st, t-days*86400)-1
    if j < 0 or i-j < 100: return None
    x = np.log(np.array(sc[j+1:i+1])); r = np.diff(x)
    r = r[np.abs(np.diff(np.array(st[j+1:i+1]))) < 600]  # drop overnight gaps
    return float(np.sqrt(np.mean(r**2)*78*252)) if len(r) > 50 else None
rows = []
for e, v in ev.items():
    if not v: continue
    ct = v['close']; ST = v['ST']
    for o in OFF:
        t0 = ct-o*60; S0 = spot(t0)
        if S0 is None: continue
        sd = vix_prev(t0); rv = rvol(t0)
        if sd is None or rv is None: continue
        T = (o/60)/(6.5*252)
        for m in v['markets']:
            if m['result'] not in ('yes', 'no') or m['floor_strike'] is None: continue
            s = (v['candles'].get(m['ticker']) or {}).get(str(o))
            if not s or s['bid'] is None or s['ask'] is None: continue
            X = m['floor_strike']
            z = math.log(X/S0)/(sd*math.sqrt(T))
            pd_ = 1-norm.cdf((math.log(X/S0)+0.5*sd*sd*T)/(sd*math.sqrt(T)))
            pr_ = 1-norm.cdf((math.log(X/S0)+0.5*rv*rv*T)/(rv*math.sqrt(T)))
            rows.append(dict(ev=e, D=__import__('datetime').datetime.utcfromtimestamp(ct).strftime('%Y-%m-%d'), hb=o/60, tk=m['ticker'], X=X, S0=S0, ST=ST, z=z, y=int(m['result'] == 'yes'), bid=s['bid'], ask=s['ask'], mid=(s['bid']+s['ask'])/2, vol=s['vol'], pn=pd_, pr=pr_, sd=sd, rv=rv))
print(S, "events", len(set(r['ev'] for r in rows)), "rows", len(rows))
json.dump(rows, open(f"data/rows/{S}_rows.json", "w"))
