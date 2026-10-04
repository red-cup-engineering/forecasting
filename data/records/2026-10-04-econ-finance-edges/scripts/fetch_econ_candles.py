import sys,json,time,calendar,os; sys.path.insert(0,'scripts')
from kfetch import *
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
SER=sys.argv[1:]
os.makedirs("data/candles",exist_ok=True)
for s in SER:
    out=f"data/candles/{s}.json"
    res=json.load(open(out)) if os.path.exists(out) else {}
    h=historical(s); live=settled(s)
    hs={m['ticker'] for m in h}
    allm={m['ticker']:m for m in h}; allm.update({m['ticker']:m for m in live})
    todo=[m for t,m in allm.items() if t not in res]
    print(s,len(allm),len(todo),flush=True)
    lt=[m for m in todo if m['ticker'] not in hs]
    byev={}
    for m in lt: byev.setdefault(m['event_ticker'],[]).append(m)
    for ev,ms in byev.items():
        ct=max(ts(m["close_time"]) for m in ms)
        for i in range(0,len(ms),20):
            ch=ms[i:i+20]
            try:
                d=kget("/markets/candlesticks",market_tickers=",".join(m['ticker'] for m in ch),start_ts=ct-5*86400,end_ts=ct,period_interval=60)
                for mk in d.get('markets',[]): res[mk['market_ticker']]=mk['candlesticks']
            except Exception as e: print('err',ev,e,flush=True)
        print(s,ev,len(ms),flush=True)
    for m in [m for m in todo if m['ticker'] in hs]:
        try:
            d=kget("/historical/markets/%s/candlesticks"%m['ticker'],start_ts=ts(m["close_time"])-5*86400,end_ts=ts(m["close_time"]),period_interval=60)
            res[m['ticker']]=d.get('candlesticks',[])
        except Exception as e: print('err',m['ticker'],e)
    json.dump(res,open(out,"w"))
    json.dump(list(allm.values()),open(f"data/markets/{s}.all.json","w")) if os.path.isdir("data/markets") else None
