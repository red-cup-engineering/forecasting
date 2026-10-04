import json, math, calendar, time, datetime as dt
import numpy as np
from math import erf, sqrt
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
def Phi(x): return 0.5*(1+erf(x/sqrt(2)))
def fee(p, n=10, rate=0.07):
    """Kalshi taker fee per contract for an n-lot at price p (dollars): ceil(rate*n*p*(1-p)*100)/100/n"""
    return math.ceil(rate*n*p*(1-p)*100-1e-9)/100/n
def load_markets(s):
    import os
    a={}
    for f in [f"data/hmarkets/{s}.json",f"data/markets/{s}.json"]:
        if os.path.exists(f):
            for m in json.load(open(f)): a[m['ticker']]=m
    return a
def snapshot(candles, t_ts, max_age=6*3600):
    """last hourly candle with end_period_ts<=t_ts. returns (bid, ask, last, vol) dollars or None"""
    best=None
    for c in candles:
        if c['end_period_ts']<=t_ts and c['end_period_ts']>=t_ts-max_age: best=c
    if best is None: return None
    f=lambda x: float(x) if x not in (None,'') else None
    g=lambda k,j: (best.get(k) or {}).get(j) if (best.get(k) or {}).get(j) is not None else (best.get(k) or {}).get(j+'_dollars')
    b=f(g('yes_bid','close')); a=f(g('yes_ask','close')); l=f(g('price','close')) or f(g('price','previous'))
    return dict(bid=b,ask=a,last=l,vol=f(best.get('volume') or best.get('volume_fp')) or 0.0,t=best['end_period_ts'])
def boot_ci(vals_by_cluster, fn=np.sum, B=4000, seed=1):
    rng=np.random.default_rng(seed)
    keys=list(vals_by_cluster); arr=[np.asarray(vals_by_cluster[k]) for k in keys]
    n=len(keys); out=[]
    for _ in range(B):
        idx=rng.integers(0,n,n)
        out.append(fn(np.concatenate([arr[i] for i in idx])))
    return np.percentile(out,[2.5,97.5])
