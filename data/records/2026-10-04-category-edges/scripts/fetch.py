import sys,json,os,calendar,time
def fl_(x):
    try: return float(x)
    except: return 0.0
from kfetch import *
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
# usage: fetch.py WINDOW_HOURS SERIES...  -> data/markets/S.json (settled+historical), data/candles/S.json (hourly)
W=float(sys.argv[1])
os.makedirs("../data/candles",exist_ok=True)
for s in sys.argv[2:]:
    out=f"../data/candles/{s}.json"
    res=json.load(open(out)) if os.path.exists(out) else {}
    live=settled(s,"../data/markets")
    try: h=historical(s,"../data/hmarkets")
    except Exception as e: h=[]
    allm={m['ticker']:m for m in h}; allm.update({m['ticker']:m for m in live})
    hs={m['ticker'] for m in h}-{m['ticker'] for m in live}
    todo=[m for t,m in allm.items() if t not in res and m.get('result') in('yes','no') and (fl_(m.get('volume_fp'))>=float(os.environ.get('MINVOL','0'))) and m['close_time']>=os.environ.get('MINCLOSE','0')]
    print(s,len(allm),len(todo),flush=True)
    for ii,m in enumerate(todo):
        if ii%200==199: json.dump(res,open(out,'w'))
        c=ts(m['close_time'])
        try:
            if m['ticker'] in hs: d=kget("/historical/markets/%s/candlesticks"%m['ticker'],start_ts=c-int(W*3600),end_ts=c,period_interval=60)
            else: d=kget("/series/%s/markets/%s/candlesticks"%(s,m['ticker']),start_ts=c-int(W*3600),end_ts=c,period_interval=60)
            res[m['ticker']]=d.get('candlesticks',[])
        except Exception as e: print('err',m['ticker'],str(e)[:80])
    json.dump(res,open(out,"w"))
    json.dump(list(allm.values()),open(f"../data/markets/{s}.all.json","w"))
