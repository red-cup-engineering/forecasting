import sys; from ladder import *
from math import erf,sqrt
def Phi(x): return .5*(1+erf(x/sqrt(2)))
SYM={"KXGOLDD":"GC=F","KXBRENTD":"BZ=F","KXNATGASD":"NG=F","KXSILVERD":"SI=F","KXWTI":"CL=F","KXWTIW":"CL=F"}
HS=(24,12,6,3,1)
def yahoo(sym):
    d=json.load(open(f"../data/ext/yahoo_{sym}.json"))['chart']['result'][0]
    t=d['timestamp']; c=d['indicators']['quote'][0]['close']
    P=[(a,b) for a,b in zip(t,c) if b is not None]
    return np.array([a for a,_ in P]),np.array([b for _,b in P])
def px(T,P,t):  # last bar whose start+300<=t
    i=np.searchsorted(T,t-300,side='right')-1
    return (P[i],T[i]) if i>=0 and t-T[i]<86400*3 else (None,None)
def sig_bar(T,P,t,days=5):
    m=(T<=t-300)&(T>t-days*86400); p=P[m]
    if len(p)<100: return None
    r=np.diff(np.log(p)); return float(np.sqrt(np.mean(r**2)))  # per 5m bar (includes jumps)
def nbars(T,t0,t1): return int(((T>=t0)&(T<t1)).sum())
def build(S):
    M,C=load(S); sym=SYM[S]; T,P=yahoo(sym)
    ev=collections.defaultdict(list)
    for m in M:
        if m['ticker'] in C and m.get('result') in('yes','no'): ev[m['event_ticker']].append(m)
    E=sorted(ev,key=lambda e:ts(ev[e][0]['close_time']))
    val={e:num(ev[e][0]['expiration_value']) for e in E}
    basis={}; 
    for e in E:
        Tc=ts(ev[e][0]['close_time']); p,_=px(T,P,Tc)
        if p is not None and val[e] is not None: basis[e]=val[e]-p
    rows=[]; keys=[e for e in E if e in basis]
    # calendar-only bar counts need future bars: use bar counts per weekday pattern from the past 7 days instead
    for k,e in enumerate(keys):
        if k==0: continue
        Tc=ts(ev[e][0]['close_time']); b=basis[keys[k-1]]
        bd=np.array([basis[keys[j]]-basis[keys[j-1]] for j in range(1,k)])
        sb=float(np.std(bd)) if len(bd)>=5 else None
        for h in HS:
            t=Tc-h*3600; p0,_=px(T,P,t)
            if p0 is None: continue
            s5=sig_bar(T,P,t)
            if s5 is None: continue
            # expected number of trading bars in (t,Tc): use same window 7 days earlier (schedule proxy)
            nb=nbars(T,t-7*86400,Tc-7*86400) 
            if nb==0: nb=max(1,int(h*12*0.7))
            for m in ev[e]:
                c=C[m['ticker']]; s=snap(c,t,maxage=30*3600)
                if not s or s['bid'] is None or s['ask'] is None: continue
                rows.append(dict(S=S,e=e,k=k,n=len(keys),h=h,st=m['strike_type'],fl=m.get('floor_strike'),cp=m.get('cap_strike'),bid=s['bid'],ask=s['ask'],vol=s['vol'],
                    yes=int(m['result']=='yes'),F=float(p0)+b,sig=s5*nb**.5*float(p0),sb=sb,val=val[e],tk=m['ticker']))
    return rows
def prob(r,kmult=1.0):
    sd=np.sqrt((r['sig']*kmult)**2+(r['sb'] or 0)**2)
    if sd<=0: return None
    c=lambda x: Phi((x-r['F'])/sd)
    if r['st']=='greater': return 1-c(r['fl'])
    if r['st']=='less': return c(r['cp'])
    return c(r['cp']+ (0.005 if r['cp']==round(r['cp'],2) else 0))-c(r['fl']) if r['fl'] is not None and r['cp'] is not None else None
if __name__=="__main__":
    for S in sys.argv[1:]:
        rows=build(S); json.dump(rows,open(f"../data/commod_rows_{S}.json","w")); print(S,len(rows),len({r['e'] for r in rows}))
