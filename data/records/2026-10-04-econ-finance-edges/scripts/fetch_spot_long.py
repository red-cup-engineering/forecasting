import json, time, urllib.request, urllib.parse, sys, os, datetime as dt
def get(u):
    for i in range(6):
        try:
            time.sleep(0.15)
            return json.loads(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"research-561"}),timeout=40).read())
        except Exception as e: time.sleep(2**i)
    raise RuntimeError(u)
end=int(time.time()); start=end-270*86400
for prod,name in [("BTC-USD","BTC"),("ETH-USD","ETH")]:
    out=f"data/ext/{name}_5m_long.json"
    if os.path.exists(out): continue
    rows={}
    t=start
    while t<end:
        t2=min(t+300*300,end)
        u=f"https://api.exchange.coinbase.com/products/{prod}/candles?granularity=300&start={dt.datetime.utcfromtimestamp(t).isoformat()}Z&end={dt.datetime.utcfromtimestamp(t2).isoformat()}Z"
        for c in get(u): rows[c[0]]=c  # [time, low, high, open, close, volume]
        t=t2
    json.dump(sorted(rows.values()),open(out,"w")); print(name,len(rows))
for cur in ["BTC","ETH"]:
    out=f"data/ext/{cur}_dvol_long.json"
    rows={}; e=end*1000
    for _ in range(10):
        r=get("https://www.deribit.com/api/v2/public/get_volatility_index_data?"+urllib.parse.urlencode(dict(currency=cur,start_timestamp=(start-86400*10)*1000,end_timestamp=e,resolution="3600")))['result']
        for d in r['data']: rows[d[0]]=d
        if not r.get('continuation'): break
        e=r['continuation']
    json.dump(sorted(rows.values()),open(out,"w")); print(cur,'dvol',len(rows))
