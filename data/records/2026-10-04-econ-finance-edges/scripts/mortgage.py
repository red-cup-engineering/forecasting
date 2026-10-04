import csv, json, numpy as np, datetime as dt
rows=[]
for r in csv.DictReader(open('data/ext/pmms.csv')):
    try: d=dt.datetime.strptime(r['date'],'%m/%d/%Y').date(); rows.append((d,float(r['pmms30'])))
    except Exception: pass
rows.sort(); dates=[d for d,_ in rows]; v=np.array([x for _,x in rows])
last=v[-1]; print("last PMMS",dates[-1],last)
ytd=[x for d,x in rows if d.year==2026]; print("2026 max so far",max(ytd),"n",len(ytd))
rng=np.random.default_rng(7)
dv=np.diff(v[dates.index(dt.date(2022,1,6)):])   # 2022-2026 weekly changes (high-vol era)
dv2=np.diff(v[dates.index(dt.date(2024,1,4)):])  # calmer 2024-2026
def sim(n_weeks, d, nsim=20000, block=4):
    out=np.empty((nsim,n_weeks)); 
    for i in range(nsim):
        x=[]; 
        while len(x)<n_weeks:
            s=rng.integers(0,len(d)-block); x+=list(d[s:s+block])
        out[i]=np.cumsum(x[:n_weeks])
    return out
mk=json.load(open('data/mortgage_open.json'))
def book(m): return float(m['yes_bid_dollars']),float(m['yes_ask_dollars']),float(m['yes_bid_size_fp']),float(m['yes_ask_size_fp'])
res={}
for label,d in [('2022-26 vol',dv),('2024-26 vol',dv2)]:
    print("weekly sd",label,d.std().round(4))
    # 26DEC: 13 releases left; running max starts at max(2026 so far)
    p=sim(13,d); mx=last+p.max(axis=1)
    # 27DEC30: 52 releases in 2027 after 13 more weeks of 2026
    p2=sim(65,d); mx2=last+p2[:,13:].max(axis=1)
    print(label)
    for m in sorted(mk,key=lambda m:(m['event_ticker'],m['floor_strike'])):
        X=m['floor_strike']; b,a,bs,as_=book(m)
        if m['event_ticker'].endswith('26DEC'):
            fair=1.0 if max(ytd)>X else float((mx>X).mean())
        else: fair=float((mx2>X).mean())
        print(f"  {m['ticker']:34s} bid {b:.2f} ask {a:.2f} fair {fair:.3f}  edge buyYES {fair-a:+.3f}  edge buyNO {b-fair:+.3f}  size b/a {bs:.0f}/{as_:.0f}")
