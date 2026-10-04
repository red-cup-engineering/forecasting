import sys; from commod import *
from winner_cal import boot
KM=(0.8,1.0,1.25,1.5,2.0)
out={}
for S in sys.argv[1:]:
    R=json.load(open(f"../data/commod_rows_{S}.json"))
    R=[r for r in R if r['sb'] is not None and r['bid'] is not None and r['ask'] is not None and r['ask']>r['bid']]
    if not R: continue
    n=max(r['n'] for r in R); evs=sorted({r['e'] for r in R},key=lambda e:min(r['k'] for r in R if r['e']==e)); half=set(evs[:len(evs)//2])
    for h in HS:
        A=[r for r in R if r['h']==h and 0.03<=(r['bid']+r['ask'])/2<=0.97 and r['ask']-r['bid']<=0.10]
        if len(A)<30: continue
        def ll(rows,k):
            v=[]
            for r in rows:
                p=prob(r,k); 
                if p is None: continue
                p=min(max(p,0.01),0.99); v.append(-(r['yes']*math.log(p)+(1-r['yes'])*math.log(1-p)))
            return float(np.mean(v))
        fit=[r for r in A if r['e'] in half]; test=[r for r in A if r['e'] not in half]
        lm=lambda rows: float(np.mean([-(r['yes']*math.log(min(max((r['bid']+r['ask'])/2,.01),.99))+(1-r['yes'])*math.log(1-min(max((r['bid']+r['ask'])/2,.01),.99))) for r in rows]))
        ks={k:ll(fit,k) for k in KM} if fit else {}
        kb=min(ks,key=ks.get) if ks else 1.0
        res=dict(n_mkts=len(A),n_ev=len({r['e'] for r in A}),logloss_market_fit=round(lm(fit),4) if fit else None,logloss_market_test=round(lm(test),4) if test else None,
                 ll_model_by_k_fit={k:round(v,4) for k,v in ks.items()},k_best=kb,ll_model_test_kbest=round(ll(test,kb),4) if test else None,ll_model_test_k1=round(ll(test,1.0),4) if test else None)
        for thr in (0.03,0.06):
          for sp,rows in (("fit",fit),("test",test)):
            cl=collections.defaultdict(list)
            for r in rows:
                p=prob(r,kb)
                if p is None: continue
                ey=p-r['ask']-fee(r['ask']); en=(1-p)-(1-r['bid'])-fee(1-r['bid'])
                if ey>thr: cl[r['e']].append(r['yes']-r['ask']-fee(r['ask']))
                elif en>thr: cl[r['e']].append((1-r['yes'])-(1-r['bid'])-fee(1-r['bid']))
            v=[x for l in cl.values() for x in l]
            res[f"ev_thr{thr}_{sp}"]=dict(n=len(v),n_ev=len(cl),ev=round(float(np.mean(v)),4) if v else None,ci=boot(cl))
        out[f"{S}|h{h}"]=res
json.dump(out,open("../results/commod_eval.json","w"),indent=1)
for k,v in out.items(): print(k,json.dumps(v)[:700])
