import json,urllib.request
def y(sym,rng,iv):
    u=f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range={rng}&interval={iv}"
    d=json.loads(urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":"Mozilla/5.0"}),timeout=40).read())['chart']['result'][0]
    q=d['indicators']['quote'][0]
    return [(t,c) for t,c in zip(d['timestamp'],q['close']) if c is not None]
for sym,name in [("%5EGSPC","SPX"),("%5ENDX","NDX"),("%5EVIX","VIX"),("%5EVXN","VXN")]:
    if name in("VIX","VXN"): r=y(sym,"6mo","1d")
    else: r=y(sym,"60d","5m")
    json.dump(r,open(f"data/ext/{name}.json","w")); print(name,len(r),r[0],r[-1])
