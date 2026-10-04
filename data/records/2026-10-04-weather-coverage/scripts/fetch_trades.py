"""Public taker tape for a ticker list (csv with header, first column ticker) -> data/trades-<name>.ndjson (resumable).  usage: fetch_trades.py <name> <tickers.csv>"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from kalshi import paged
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
name, src = sys.argv[1], sys.argv[2]
tk = [l.strip().split(',')[0] for l in open(src)][1:]
done = set(); p = f'{D}/trades-{name}.ndjson'
if os.path.exists(p):
    done = {json.loads(l)['tk'] for l in open(p)}
with open(p, 'a') as f:
    for i, t in enumerate(tk):
        if t in done: continue
        n = 0
        for tr in paged('/markets/trades', 'trades', ticker=t, limit=1000):
            f.write(json.dumps({'tk': t, 't': tr['created_time'], 'p': round(float(tr['yes_price_dollars']) * 100), 'n': float(tr['count_fp']), 's': tr['taker_side']}) + '\n'); n += 1
        if n == 0: f.write(json.dumps({'tk': t, 't': None, 'p': 0, 'n': 0, 's': 'none'}) + '\n')
        f.flush()
        if i % 20 == 0: print(i, len(tk), flush=True)
