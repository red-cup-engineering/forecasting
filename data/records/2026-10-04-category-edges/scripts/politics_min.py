import sys; from ladder import *
from winner_cal import boot
OFF=(90,60,30,15,10,5,3,2,1)
res={}
for S in ("KXTRUMPAPPROVE","KXVHGCB"):
    M=json.load(open(f"../data/markets/{S}.json")); C=json.load(open(f"../data/candles/{S}.min.json"))
    ev=collections.defaultdict(list)
    for m in M:
        if m['ticker'] in C and m.get('result') in('yes','no'): ev[m['event_ticker']].append(m)
    for off in OFF:
        mass=[];orc=collections.defaultdict(list);favp=[]
        for e,ms in ev.items():
            Tc=ts(ms[0]['close_time']); t=Tc-off*60
            sn={}
            for m in ms:
                s=snap(C[m['ticker']],t,maxage=7200)
                if s and s['bid'] is not None and s['ask'] is not None: sn[m['ticker']]=s
            win=[m for m in ms if m['result']=='yes' and m['ticker'] in sn]
            if not win: continue
            w=win[0]; s=sn[w['ticker']]
            mass.append((s['bid']+s['ask'])/2)
            if s['ask']<1: orc[e].append(1-s['ask']-fee(s['ask']))
            else: orc[e].append(0.0)
            # market's top bin correct?
            top=max(sn,key=lambda k:(sn[k]['bid']+sn[k]['ask'])/2); favp.append(int(top==w['ticker']))
        res[f"{S}|T-{off}min"]=dict(events=len(mass),mean_mid_on_winner=round(float(np.mean(mass)),3),frac_top_is_winner=round(float(np.mean(favp)),3),
            oracle_ev_per_contract=round(float(np.mean([v for l in orc.values() for v in l])),4),oracle_ci=boot(orc))
json.dump(res,open("../results/politics_minute.json","w"),indent=1)
for k,v in res.items(): print(k,v)
