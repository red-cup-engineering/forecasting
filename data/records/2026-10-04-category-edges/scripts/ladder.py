"""Shared: ladder events from Kalshi range-ladder series. Snapshot = last hourly candle with end<=t (forward-fill), bid/ask close."""
import json,collections,calendar,time,re,math
import numpy as np
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
def fee(p,n=1,rate=0.07): return math.ceil(rate*n*p*(1-p)*100-1e-9)/100/n
def fl(x):
    try: return float(x)
    except: return None
def snap(cs,t,maxage=36*3600):
    best=None
    for c in cs:
        if c['end_period_ts']<=t and c['end_period_ts']>=t-maxage: best=c
        elif c['end_period_ts']>t: break
    if not best: return None
    g=lambda k: fl((best.get(k) or {}).get('close_dollars', (best.get(k) or {}).get('close')))
    b,a,l=g('yes_bid'),g('yes_ask'),g('price')
    return dict(bid=b,ask=a,last=l,vol=fl(best.get('volume_fp') or best.get('volume')) or 0)
def num(v):
    m=re.search(r'-?\d+(\.\d+)?',str(v)); return float(m.group()) if m else None
def load(series):
    import os
    p=f"../data/markets/{series}.all.json"
    M=json.load(open(p if os.path.exists(p) else f"../data/markets/{series}.json")); C=json.load(open(f"../data/candles/{series}.json"))
    return M,C
