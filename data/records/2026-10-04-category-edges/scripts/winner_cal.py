"""Winner-take-all event markets: calibration at horizons before close, event-clustered CIs, date-ordered held-out half."""
import sys; from ladder import *
HS=(72,24,6,1)
def rows_for(S):
    M,C=load(S); ev=collections.defaultdict(list)
    for m in M:
        if m['ticker'] in C and m.get('result') in('yes','no'): ev[m['event_ticker']].append(m)
    E=sorted(ev,key=lambda e:ts(ev[e][0]['close_time'])); out=[]
    for k,e in enumerate(E):
        Tc=ts(ev[e][0]['close_time'])
        for h in HS:
            t=Tc-h*3600; snaps=[]
            for m in ev[e]:
                s=snap(C[m['ticker']],t,maxage=120*3600)
                if s and s['bid'] is not None and s['ask'] is not None: snaps.append((m,s))
            if not snaps: continue
            mids=[(s['bid']+s['ask'])/2 for _,s in snaps]
            top=max(range(len(snaps)),key=lambda i:mids[i])
            for i,(m,s) in enumerate(snaps):
                out.append(dict(S=S,e=e,k=k,n=len(E),h=h,bid=s['bid'],ask=s['ask'],mid=mids[i],fav=int(i==top),yes=int(m['result']=='yes'),vol=s['vol'],sum_mid=sum(mids),name=m.get('yes_sub_title')))
    return out
def boot(cl,B=3000,seed=1):
    ks=list(cl); arr=[np.array(cl[k]) for k in ks]
    if not ks: return None
    rng=np.random.default_rng(seed)
    b=[np.concatenate([arr[i] for i in rng.integers(0,len(ks),len(ks))]).mean() for _ in range(B)]
    return [round(float(x),4) for x in np.percentile(b,[2.5,97.5])]
if __name__=="__main__":
    res={}
    for S in sys.argv[1:]:
        R=rows_for(S); json.dump(R,open(f"../data/winner_rows_{S}.json","w"))
        for h in HS:
            A=[r for r in R if r['h']==h]
            if not A: continue
            ne=len({r['e'] for r in A})
            # favorite: buy at ask
            cl=collections.defaultdict(list); cl2=collections.defaultdict(list)
            fav=[r for r in A if r['fav'] and r['ask']<1 and r['bid']>0]
            for r in fav: cl[r['e']].append(r['yes']-r['ask']-fee(r['ask']))
            # all markets with mid in [.05,.95]: calibration gap
            mm=[r for r in A if 0.05<=r['mid']<=0.95]
            for r in mm: cl2[r['e']].append(r['yes']-r['mid'])
            half={}
            for sp,cond in (("fit",lambda r:r['k']<r['n']/2),("test",lambda r:r['k']>=r['n']/2)):
                c3=collections.defaultdict(list)
                for r in fav:
                    if cond(r): c3[r['e']].append(r['yes']-r['ask']-fee(r['ask']))
                c4=collections.defaultdict(list)
                for r in fav:
                    if cond(r) and r['bid']>0.02: c4[r['e']].append((1-r['yes'])-(1-r['bid'])-fee(1-r['bid']))
                half[sp]=dict(ev=round(float(np.mean([v for l in c3.values() for v in l])),4) if c3 else None,n_ev=len(c3),ci=boot(c3),
                    fade_ev=round(float(np.mean([v for l in c4.values() for v in l])),4) if c4 else None,fade_ci=boot(c4))
            c5=collections.defaultdict(list)
            for r in fav:
                if r['bid']>0.02: c5[r['e']].append((1-r['yes'])-(1-r['bid'])-fee(1-r['bid']))
            res[f"{S}|h{h}"]=dict(split=half,fade_ev=round(float(np.mean([v for l in c5.values() for v in l])),4) if c5 else None,fade_ci=boot(c5),events=ne,fav_n=len(fav),fav_mean_price=round(float(np.mean([r['ask'] for r in fav])),3) if fav else None,
                fav_hit=round(float(np.mean([r['yes'] for r in fav])),3) if fav else None,
                fav_ev_ask=round(float(np.mean([v for l in cl.values() for v in l])),4) if cl else None,fav_ev_ci=boot(cl),
                mid_gap_n=len(mm),mid_gap=round(float(np.mean([v for l in cl2.values() for v in l])),4) if cl2 else None,mid_gap_ci=boot(cl2),
                mean_sum_mid=round(float(np.mean([r['sum_mid'] for r in A])),3))
    json.dump(res,open("../results/winner_cal_%s.json"%("_".join(sys.argv[1:])[:60]),"w"),indent=1)
    for k,v in res.items(): print(k,v)
