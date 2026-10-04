"""Live public order books for every open market of the covered families (temperature lane's 48 series, KXRAIN, KXRAINWKND) -> data/live-books.ndjson. Depth = what a taker could hit now."""
import sys, os, json, time
sys.path.insert(0, os.path.dirname(__file__))
from kalshi import get
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
cfg = json.load(open(os.path.join(D, '../../../../content/config/temperature-markets.json')))
fam = {s['seriesTicker'] for s in cfg['series']} | {'KXRAIN', 'KXRAINWKND'}
mk = [json.loads(l) for l in open(f'{D}/open-markets.ndjson')]
mk = [m for m in mk if m['ticker'].split('-')[0] in fam]
now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
with open(f'{D}/live-books.ndjson', 'w') as f:
    for m in mk:
        b = get('/markets/' + m['ticker'] + '/orderbook')
        if not b: continue
        ob = b['orderbook_fp']
        f.write(json.dumps({'ticker': m['ticker'], 'series': m['ticker'].split('-')[0], 'asof': now, 'yes': ob.get('yes_dollars') or [], 'no': ob.get('no_dollars') or [], 'close': m['close_time']}) + '\n')
print(len(mk), now)
