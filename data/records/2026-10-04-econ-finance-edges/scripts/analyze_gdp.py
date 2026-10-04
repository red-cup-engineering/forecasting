import sys, json, re, math, collections, numpy as np
from scipy.stats import norm
from common import *
S="KXGDP"; mk=load_markets(S); cd=json.load(open(f"data/candles/{S}.json"))
g=json.load(open("data/ext/gdpnow_hist.json"))
# one record per quarter: last nowcast strictly before advance pub date; error vs advance
byq=collections.defaultdict(list)
for r in g: byq[r['q']].append(r)
hist=[]
for q,rs in byq.items():
    rs.sort(key=lambda r:r['date']); adv=[r['adv'] for r in rs if r['adv'] is not None]; pub=[r['pub'] for r in rs if r['pub']]
    if not adv or not pub: continue
    pre=[r for r in rs if r['date']<pub[-1]]
    if pre: hist.append((pub[-1],pre[-1]['now'],adv[-1],q))
hist.sort(); print("GDPNow quarters:",len(hist),"RMSE",np.sqrt(np.mean([(a-n)**2 for _,n,a,_ in hist])))
def sd_for(D,K=40):
    e=np.array([a-n for p,n,a,_ in hist if p<D][-K:])
    return max(0.8,float(1.4826*np.median(np.abs(e-np.median(e))))*1.0) if len(e)>=8 else 1.3
def rmse_for(D,K=40):
    e=np.array([a-n for p,n,a,_ in hist if p<D][-K:]); return float(np.sqrt(np.mean(e**2))) if len(e)>=8 else 1.5
ev=collections.defaultdict(list)
for t,m in mk.items():
    if t in cd and m.get('result') in('yes','no') and re.search(r'-T-?[0-9.]+$',t): ev[m['event_ticker']].append(m)
rows=[]
for e,ms in ev.items():
    D=ms[0]['close_time'][:10]
    cand=[(abs((dt_:=__import__('datetime').date.fromisoformat(p)-__import__('datetime').date.fromisoformat(D)).days),p,n,a) for p,n,a,q in hist]
    pc=min(cand) if cand else None
    if not pc or pc[0]>4: print('no nowcast',e,D); continue
    n=pc[2]; entry=ts(D+"T00:00:00")-3*3600
    sd=sd_for(D); sr=rmse_for(D)
    for m in ms:
        s=snapshot(cd[m['ticker']],entry)
        if not s or s['bid'] is None or s['ask'] is None: continue
        X=m['floor_strike'] if m.get('floor_strike') is not None else float(re.search(r'-T(-?[0-9.]+)$',m['ticker']).group(1))
        pn=1-norm.cdf((X+0.05-n)/sd)  # advance value reported to 1 decimal? Kalshi: increases by more than X
        pr=1-norm.cdf((X-n)/sr)
        rows.append(dict(ev=e,D=D,tk=m['ticker'],X=X,y=int(m['result']=='yes'),bid=s['bid'],ask=s['ask'],mid=(s['bid']+s['ask'])/2,pn=pr,pr=pn,vol=s['vol'],nc=n))
print("events",len(set(r['ev'] for r in rows)),"markets",len(rows))
json.dump(rows,open("data/rows/KXGDP_rows.json","w"))
