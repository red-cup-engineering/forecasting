import json, time, calendar, datetime as dt, numpy as np, sys
sys.path.insert(0,'scripts')
from common import *
zqf = json.load(open('data/ext/zqf.json')); zd = {time.strftime('%Y-%m-%d', time.gmtime(t)): v for t, v in zqf}
zk = sorted(zd)
effr = {r['effectiveDate']: r['percentRate'] for r in json.load(open('data/ext/effr.json'))['refRates']}
ek = sorted(effr)
def last_on_or_before(dct, keys, day):
    import bisect
    i = bisect.bisect_right(keys, day)-1
    return dct[keys[i]] if i >= 0 else None
mk = load_markets('KXFEDDECISION'); cd = json.load(open('data/candles/KXFEDDECISION.json'))
rows = []; used = set()
for t, m in mk.items():
    if t not in cd or m.get('result') not in ('yes', 'no'): continue
    day = m['close_time'][:10]; d0 = dt.date.fromisoformat(day)
    N = calendar.monthrange(d0.year, d0.month)[1]; post = N-d0.day
    if post < 8: continue
    prev = (d0-dt.timedelta(days=1)).isoformat()
    p = last_on_or_before(zd, zk, prev); pre = last_on_or_before(effr, ek, prev)
    if p is None or pre is None: continue
    r_post = ((100-p)*N-pre*d0.day)/post
    delta = (r_post-pre)/0.25; k = int(np.floor(delta)); f = delta-k
    dist = {k: 1-f, k+1: f}
    sub = m.get('yes_sub_title', '')
    kk = {'Cut >25bps': -2, 'Cut 25bps': -1, 'Fed maintains rate': 0, 'Hike 25bps': 1, 'Hike >25bps': 2}.get(sub)
    if kk is None: continue
    def pk(kk):
        if kk == -2: return sum(v for j, v in dist.items() if j <= -2)
        if kk == 2: return sum(v for j, v in dist.items() if j >= 2)
        return dist.get(kk, 0.0)
    s = snapshot(cd[t], ts(m['close_time'])-16*3600, max_age=12*3600)
    if not s or s['bid'] is None or s['ask'] is None: continue
    used.add(m['event_ticker'])
    rows.append(dict(ev=m['event_ticker'], D=day, tk=t, y=int(m['result'] == 'yes'), bid=s['bid'], ask=s['ask'], mid=(s['bid']+s['ask'])/2, pn=pk(kk), vol=s['vol'], pre=pre, imp=(r_post-pre)*100))
print("meetings used:", len(used), sorted(used)); print("rows", len(rows))
json.dump(rows, open('data/rows/KXFEDDECISION_rows.json', 'w'))
