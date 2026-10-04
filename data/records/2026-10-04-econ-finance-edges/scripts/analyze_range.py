"""Kalshi above/below ladders vs option-implied / realized-vol lognormal.
usage: analyze_range.py SERIES ASSET(BTC|ETH) hours_before(comma, e.g. 4,1)"""
import sys, json, math, bisect, numpy as np, collections
from scipy.stats import norm
from common import *
S, A = sys.argv[1], sys.argv[2]; HB = [float(x) for x in sys.argv[3].split(',')]
SPOT = sys.argv[4] if len(sys.argv) > 4 else 'crypto'
import os
ev = json.load(open(f"data/range/{S}.json"))
if os.path.exists(f"data/range/{S}.hist.json"):
    try: ev.update(json.load(open(f"data/range/{S}.hist.json")))
    except Exception as e: print("hist partial read failed", e)
sp = json.load(open(f"data/ext/{A}_5m_long.json")); st = [c[0] for c in sp]; sc = [c[4] for c in sp]
dv = json.load(open(f"data/ext/{A}_dvol_long.json")); dt_ = [d[0]//1000 for d in dv]; dc = [d[4] for d in dv]   # [ts,open,high,low,close]
def spot(t):
    i = bisect.bisect_right(st, t-300)-1   # candle [st, st+300) is complete only at st+300 <= t
    return sc[i] if i >= 0 and t-st[i] < 1200 else None
def dvol(t):
    i = bisect.bisect_right(dt_, t)-1
    return dc[i]/100 if i >= 0 else None
def rvol(t, hrs=24):
    i = bisect.bisect_right(st, t-300)-1; j = bisect.bisect_right(st, t-300-hrs*3600)-1
    if j < 0: return None
    x = np.log(np.array(sc[j+1:i+1])); r = np.diff(x)
    return float(np.sqrt(np.mean(r**2)*288*365)) if len(r) > 50 else None
_lc = np.log(np.array(sc)); _r2 = np.concatenate([[0.0], np.diff(_lc)**2]); _cs = np.concatenate([[0.0], np.cumsum(_r2)])
def var_tod(t0, t1, days=30):
    # mean over previous `days` days of realized variance (sum of squared 5-min log returns) in the same UTC window [t0,t1] (no lookahead)
    v = []
    for k in range(1, days+1):
        a = bisect.bisect_left(st, t0-k*86400); b = bisect.bisect_right(st, t1-k*86400)
        if b-a > 0.8*((t1-t0)/300): v.append(_cs[b]-_cs[a])
    return float(np.mean(v)) if len(v) >= 10 else None
rows = []
for e, v in ev.items():
    if not v: continue
    ct = v['close']; ST = v['ST']
    for hb in HB:
        t0 = ct-int(hb*3600)
        S0 = spot(t0); sd = dvol(t0); rv = rvol(t0)
        if S0 is None or sd is None or rv is None: continue
        T = hb/(365*24)
        vt = var_tod(t0, ct)
        if vt is None: continue
        for m in v['markets']:
            if m['result'] not in ('yes', 'no') or m['floor_strike'] is None: continue
            s = (v['candles'].get(m['ticker']) or {}).get(str(int(round(hb*60))))
            if not s or s['bid'] is None or s['ask'] is None: continue
            X = m['floor_strike']
            z = (math.log(X/S0))/(sd*math.sqrt(T))
            pd_ = 1-norm.cdf((math.log(X/S0)+0.5*sd*sd*T)/(sd*math.sqrt(T)))
            pr_ = 1-norm.cdf((math.log(X/S0)+0.5*rv*rv*T)/(rv*math.sqrt(T)))
            rows.append(dict(ev=e, D=__import__('datetime').datetime.utcfromtimestamp(ct).strftime('%Y-%m-%d'), hb=hb, tk=m['ticker'], X=X, S0=S0, ST=ST, z=z, y=int(m['result'] == 'yes'), bid=s['bid'], ask=s['ask'], mid=(s['bid']+s['ask'])/2, vol=s['vol'], pn=pd_, pr=pr_, ptod=1-norm.cdf((math.log(X/S0)+0.5*vt)/math.sqrt(vt)), vtod=math.sqrt(vt/T), sd=sd, rv=rv))
print(S, "events", len(set(r['ev'] for r in rows)), "rows", len(rows))
json.dump(rows, open(f"data/rows/{S}_rows.json", "w"))
