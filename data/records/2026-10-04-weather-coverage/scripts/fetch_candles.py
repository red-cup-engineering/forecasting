"""Hourly candlesticks (price, yes_bid, yes_ask OHLC, volume) for settled markets of a family -> data/candles-<family>.json (batched, resumable)."""
import sys, os, json, calendar, time
sys.path.insert(0, os.path.dirname(__file__))
from kalshi import get
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
ts = lambda s: calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))
fam = sys.argv[1]
B = int(sys.argv[2]) if len(sys.argv) > 2 else 40
ms = [json.loads(l) for l in open(f'{D}/settled-{fam}.ndjson')]
ms = [m for m in ms if m['open_time'] and m['close_time']]
p = f'{D}/candles-{fam}.json'
out = json.load(open(p)) if os.path.exists(p) else {}
ms = [m for m in ms if m['ticker'] not in out]
ms.sort(key=lambda m: m['close_time'])
for i in range(0, len(ms), B):
    ch = ms[i:i + B]
    try:
        r = get('/markets/candlesticks', market_tickers=','.join(m['ticker'] for m in ch), start_ts=min(ts(m['open_time']) for m in ch), end_ts=max(ts(m['close_time']) for m in ch) + 3600, period_interval=60)
    except Exception as e:
        print('skip batch', i, e); continue
    for mk in (r or {}).get('markets', []): out[mk['market_ticker']] = mk['candlesticks']
    json.dump(out, open(p, 'w')); print(fam, len(out), flush=True)
