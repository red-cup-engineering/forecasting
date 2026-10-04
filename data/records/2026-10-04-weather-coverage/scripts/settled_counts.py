"""Count settled markets and first/last close for every Climate & Weather series (all 417, open or not)."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from kalshi import paged
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
ser = json.load(open(f'{D}/series.json'))['series']
out = {}
for s in ser:
    t = s['ticker']
    if t.startswith(('KXHIGHT','KXLOWT')) : continue
    n = 0; lo = hi = None; yes = 0
    for m in paged('/markets', 'markets', series_ticker=t, status='settled', limit=1000):
        n += 1; c = m['close_time']; lo = min(lo or c, c); hi = max(hi or c, c); yes += m['result'] == 'yes'
    out[t] = dict(settled=n, first=lo, last=hi, yes=yes)
json.dump(out, open(f'{D}/settled-counts.json', 'w'))
