import sys; from ladder import *
rows=[]
res={}
for S in ["KXTRUMPAPPROVE","KXVHGCB"]:
    M,C=load(S)
    ev=collections.defaultdict(list)
    for m in M:
        if m.get('result') in('yes','no') and m['ticker'] in C: ev[m['event_ticker']].append(m)
    E=sorted(ev,key=lambda e:ts(ev[e][0]['close_time']))
    # realised value from settlement: expiration_value
    val={}
    for e in E:
        vs=[num(m['expiration_value']) for m in ev[e] if m['expiration_value']!='']
        val[e]=vs[0] if vs else None
    # daily change series
    d=[(val[E[i]]-val[E[i-1]]) for i in range(1,len(E)) if val[E[i]] is not None and val[E[i-1]] is not None]
    d=np.array(d); res[S+"_n_events"]=len(E)
    res[S+"_delta"]=dict(n=len(d),mean=float(d.mean()),sd=float(d.std()),mad=float(np.abs(d).mean()),frac_zero=float((d==0).mean()),pcts={k:float(np.percentile(d,k)) for k in(5,25,50,75,95)})
    half=len(E)//2
    for i,e in enumerate(E):
        if i==0 or val[E[i-1]] is None or val[e] is None: continue
        close=ts(ev[e][0]['close_time'])
        prev=val[E[i-1]]
        for h in (24,12,6,3,1):
            t=close-h*3600
            # market implied dist over bins
            xs=[]
            for m in ev[e]:
                s=snap(C[m['ticker']],t)
                if s and s['bid'] is not None and s['ask'] is not None:
                    xs.append((m,s))
            if len(xs)<len(ev[e])-1: continue
            # implied mean from bin mids (between markets): use mid
            mids=[(m,(s['bid']+s['ask'])/2) for m,s in xs if m['strike_type']=='between']
            tot=sum(p for _,p in mids)
            imp_mean=sum(num(m['ticker'].split('-')[-1][1:])*p for m,p in mids)/tot if tot>0 else None
            for m,s in xs:
                rows.append(dict(S=S,e=e,i=i,h=h,tk=m['ticker'],st=m['strike_type'],fl=m.get('floor_strike'),cp=m.get('cap_strike'),
                    bid=s['bid'],ask=s['ask'],vol=s['vol'],yes=int(m['result']=='yes'),prev=prev,val=val[e],imp_mean=imp_mean,half=int(i>=half)))
json.dump(rows,open("../data/politics_rows.json","w"))
json.dump(res,open("../results/politics_delta.json","w"),indent=1)
print(json.dumps(res,indent=1)); print(len(rows))
