import json, urllib.request, urllib.parse, time, os, sys
B="https://api.elections.kalshi.com/trade-api/v2"
UA={"accept":"application/json","user-agent":"561-group research (ops@561.group)"}
def get(url, tries=6, pace=0.08):
    for i in range(tries):
        try:
            time.sleep(pace)
            with urllib.request.urlopen(urllib.request.Request(url,headers=UA),timeout=60) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (429,500,502,503,504): time.sleep(2**i); continue
            raise
        except Exception: time.sleep(2**i)
    raise RuntimeError(url)
def kget(path, **q): return json.loads(get(B+path+"?"+urllib.parse.urlencode(q)))
def settled(series, out_dir="data/markets"):
    os.makedirs(out_dir,exist_ok=True); out=f"{out_dir}/{series}.json"
    if os.path.exists(out): return json.load(open(out))
    rows=[];cur=""
    while True:
        q=dict(series_ticker=series,status="settled",limit=1000)
        if cur:q["cursor"]=cur
        d=kget("/markets",**q); rows+=d.get("markets",[]); cur=d.get("cursor")
        if not cur: break
    json.dump(rows,open(out,"w")); return rows
if __name__=="__main__":
    for s in sys.argv[1:]:
        r=settled(s); print(s,len(r), r[0]["close_time"] if r else "", r[-1]["close_time"] if r else "")

def historical(series, out_dir="data/hmarkets"):
    os.makedirs(out_dir,exist_ok=True); out=f"{out_dir}/{series}.json"
    if os.path.exists(out): return json.load(open(out))
    rows=[];cur=""
    while True:
        q=dict(series_ticker=series,limit=1000)
        if cur:q["cursor"]=cur
        d=kget("/historical/markets",**q); rows+=d.get("markets",[]); cur=d.get("cursor")
        if not cur or not d.get("markets"): break
    json.dump(rows,open(out,"w")); return rows
