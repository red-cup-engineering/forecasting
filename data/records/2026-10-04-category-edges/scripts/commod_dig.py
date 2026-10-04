import sys; from commod import *
from winner_cal import boot
S=sys.argv[1]; thr=float(sys.argv[2]) if len(sys.argv)>2 else 0.03
R=json.load(open(f"../data/commod_rows_{S}.json"))
R=[r for r in R if r['sb'] is not None and r['ask']>r['bid']]
evs=sorted({r['e'] for r in R},key=lambda e:min(r['k'] for r in R if r['e']==e)); half=set(evs[:len(evs)//2])
def trades(rows,k=1.0):
    out=[]
    for r in rows:
        p=prob(r,k)
        if p is None: continue
        ey=p-r['ask']-fee(r['ask']); en=(1-p)-(1-r['bid'])-fee(1-r['bid'])
        if ey>thr: out.append((r['e'],'YES',r['ask'],r['yes']-r['ask']-fee(r['ask']),r['h'],r['st'],r['vol']))
        elif en>thr: out.append((r['e'],'NO',1-r['bid'],(1-r['yes'])-(1-r['bid'])-fee(1-r['bid']),r['h'],r['st'],r['vol']))
    return out
def summ(t,label):
    cl=collections.defaultdict(list)
    for e,*_ ,v,h,st,vol in [(x[0],x[1],x[2],x[3],x[4],x[5],x[6]) for x in t]: pass
    for x in t: cl[x[0]].append(x[3])
    v=[x[3] for x in t]
    print(f"{label:34s} n={len(v):4d} ev={np.mean(v) if v else float('nan'):+.4f} events={len(cl):3d} ci={boot(cl)}")
for sp,cond in (("all",lambda e:True),("fit",lambda e:e in half),("test",lambda e:e not in half)):
    for hs in ((24,12,6),(3,1),(24,12,6,3,1)):
        t=trades([r for r in R if r['h'] in hs and cond(r['e'])]); summ(t,f"{S} {sp} h{hs}")
t=trades([r for r in R if r['h'] in (24,12,6)])
for side in ("YES","NO"):
    summ([x for x in t if x[1]==side],f"side {side} h24/12/6")
for lo,hi in ((0,.1),(.1,.3),(.3,.6),(.6,1.01)):
    summ([x for x in t if lo<=x[2]<hi],f"cost {lo}-{hi}")
for st in ("greater","less","between"):
    summ([x for x in t if x[5]==st],f"strike {st}")
for vm in (0,500,5000):
    summ([x for x in t if (x[6] or 0)>=vm],f"hour vol>={vm}")
