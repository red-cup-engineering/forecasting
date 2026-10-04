import sys,json,os,calendar,time
from kfetch import *
ts=lambda s: calendar.timegm(time.strptime(s[:19],"%Y-%m-%dT%H:%M:%S"))
S=sys.argv[1]; W=int(sys.argv[2])
M=json.load(open(f"../data/markets/{S}.json")); out={}
for m in M:
    if m.get('result') not in('yes','no'): continue
    c=ts(m['close_time'])
    try: out[m['ticker']]=kget("/series/%s/markets/%s/candlesticks"%(S,m['ticker']),start_ts=c-W*60,end_ts=c+60,period_interval=1).get('candlesticks',[])
    except Exception as e: print('err',m['ticker'],str(e)[:60])
json.dump(out,open(f"../data/candles/{S}.min.json","w")); print(S,len(out))
