from ladder import *
from math import erf,sqrt
rows=json.load(open("../data/politics_rows.json"))
def Phi(x): return .5*(1+erf(x/sqrt(2)))
out={}
def modelp(r,pmf):
    # pmf: dict step(int, tenths)->p for delta; value = prev+delta/10
    prev=r['prev']; st=r['st']
    def P(f):
        return sum(p for k,p in pmf.items() if f(round(prev+k/10,1)))
    if st=='between': x=r['fl'] if r['fl'] is not None else r['cp']; return P(lambda v:abs(v-x)<0.05)
    if st=='less': return P(lambda v:v<r['cp']-1e-9)
    if st=='greater': return P(lambda v:v>r['fl']+1e-9)
def mk_pmf(deltas):
    sd=max(np.std(deltas),0.15); ks=range(-20,21)
    emp=collections.Counter(int(round(d*10)) for d in deltas); n=len(deltas)
    nor={k:Phi((k+.5)/10/sd)-Phi((k-.5)/10/sd) for k in ks}; z=sum(nor.values())
    return {k:0.5*(emp[k]+0.3)/(n+0.3*len(ks))+0.5*nor[k]/z for k in ks}
for S in ["KXTRUMPAPPROVE","KXVHGCB"]:
    R=[r for r in rows if r['S']==S]
    evs=sorted({r['e'] for r in R},key=lambda e:min(r['i'] for r in R if r['e']==e))
    # persistence deltas across all events pre-test: fit = events with half==0
    fitd=sorted({(r['e'],round(r['val']-r['prev'],1)) for r in R if r['half']==0})
    pmf=mk_pmf([d for _,d in fitd])
    for h in (24,12,6,3,1):
        A=[r for r in R if r['h']==h]
        for sp in ("fit","test"):
            B=[r for r in A if r['half']==(0 if sp=="fit" else 1)]
            if not B: continue
            # log loss comparison
            ll_m=[];ll_p=[];ev_cl=collections.defaultdict(list)
            for r in B:
                pm=min(max((r['bid']+r['ask'])/2,0.005),0.995); pp=min(max(modelp(r,pmf),0.005),0.995)
                y=r['yes']
                ll_m.append(-(y*math.log(pm)+(1-y)*math.log(1-pm))); ll_p.append(-(y*math.log(pp)+(1-y)*math.log(1-pp)))
                for thr in (0.03,):
                    # buy YES at ask
                    if r['ask']>=1 or r['bid']<=0: continue
                    ey=pp-r['ask']-fee(r['ask']); en=(1-pp)-(1-r['bid'])-fee(1-r['bid'])
                    if ey>thr: ev_cl[r['e']].append(y-r['ask']-fee(r['ask']))
                    elif en>thr: ev_cl[r['e']].append((1-y)-(1-r['bid'])-fee(1-r['bid']))
            allv=[v for l in ev_cl.values() for v in l]
            ci=None
            if ev_cl:
                rng=np.random.default_rng(1); ks=list(ev_cl); arr=[np.array(ev_cl[k]) for k in ks]
                bs=[np.concatenate([arr[i] for i in rng.integers(0,len(ks),len(ks))]).mean() for _ in range(2000)]
                ci=np.percentile(bs,[2.5,97.5]).round(4).tolist()
            ime=[abs(r['imp_mean']-r['val']) for r in B if r['st']=='between' and r['imp_mean']]  # repeated per market; dedupe per event below
            evmae={}
            for r in B:
                if r['imp_mean']: evmae[r['e']]=(abs(r['imp_mean']-r['val']),abs(r['prev']-r['val']))
            out[f"{S}|h{h}|{sp}"]=dict(n_ev=len({r['e'] for r in B}),logloss_mkt=round(float(np.mean(ll_m)),4),logloss_persist_model=round(float(np.mean(ll_p)),4),
               mae_implied_mean=round(float(np.mean([a for a,b in evmae.values()])),3),mae_prev_day=round(float(np.mean([b for a,b in evmae.values()])),3),
               trades=len(allv),n_trade_events=len(ev_cl),ev_per_contract=round(float(np.mean(allv)),4) if allv else None,ci95=ci)
json.dump(out,open("../results/politics_eval.json","w"),indent=1)
for k,v in out.items(): print(k,v)
