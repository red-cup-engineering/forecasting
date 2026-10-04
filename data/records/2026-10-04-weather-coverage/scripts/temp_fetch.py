"""Settled KXHIGH*/KXLOWT* markets of the last N days (default 16) with hourly candles -> data/settled-TEMP.ndjson, data/candles-TEMP.json."""
import sys, os, json, time, calendar
sys.path.insert(0, os.path.dirname(__file__))
from kalshi import paged, get
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
cfg = json.load(open(os.path.join(D, '../../../../content/config/temperature-markets.json')))
days = int(sys.argv[1]) if len(sys.argv) > 1 else 16
minc = int(time.time()) - days * 86400
ts = lambda s: calendar.timegm(time.strptime(s[:19], "%Y-%m-%dT%H:%M:%S"))
ms = []
for s in cfg['series']:
    for m in paged('/markets', 'markets', series_ticker=s['seriesTicker'], status='settled', min_close_ts=minc, limit=1000):
        ms.append({k: m.get(k) for k in ('ticker','event_ticker','close_time','open_time','result','volume_fp','strike_type','floor_strike','cap_strike')} | {'series': s['seriesTicker']})
    print(s['seriesTicker'], len(ms), flush=True)
with open(f'{D}/settled-TEMP.ndjson', 'w') as f:
    for m in ms: f.write(json.dumps(m) + '\n')
p = f'{D}/candles-TEMP.json'; out = json.load(open(p)) if os.path.exists(p) else {}
todo = sorted([m for m in ms if m['ticker'] not in out], key=lambda m: m['close_time'])
for i in range(0, len(todo), 40):
    ch = todo[i:i + 40]
    try:
        r = get('/markets/candlesticks', market_tickers=','.join(m['ticker'] for m in ch), start_ts=min(ts(m['open_time']) for m in ch), end_ts=max(ts(m['close_time']) for m in ch) + 3600, period_interval=60)
    except Exception as e:
        print('skip', i, e); continue
    for mk in (r or {}).get('markets', []): out[mk['market_ticker']] = mk['candlesticks']
    if (i // 40) % 10 == 0: json.dump(out, open(p, 'w')); print('candles', len(out), flush=True)
json.dump(out, open(p, 'w')); print('done', len(out))
