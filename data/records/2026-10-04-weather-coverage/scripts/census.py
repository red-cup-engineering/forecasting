"""Census of every Kalshi Climate & Weather series: open markets, volume, top-of-book depth, settlement sources.
Writes data/series.json, data/open-markets.ndjson, results/census.md and results/census.csv."""
import json, os, sys, re, collections
sys.path.insert(0, os.path.dirname(__file__))
from kalshi import get, paged
H = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(H, '..', 'data'); R = os.path.join(H, '..', 'results')
ser = get('/series', category='Climate and Weather')['series']
json.dump({'series': ser}, open(f'{D}/series.json', 'w'))
rows = []
with open(f'{D}/open-markets.ndjson', 'w') as out:
    for s in ser:
        ms = list(paged('/markets', 'markets', series_ticker=s['ticker'], status='open', limit=1000))
        ev = collections.Counter(m['event_ticker'] for m in ms)
        vol24 = sum(float(m['volume_24h_fp']) for m in ms); oi = sum(float(m['open_interest_fp']) for m in ms)
        bid_sz = sum(float(m['yes_bid_size_fp']) for m in ms if float(m['yes_bid_dollars']) > 0)
        ask_sz = sum(float(m['yes_ask_size_fp']) for m in ms if float(m['yes_ask_dollars']) > 0)
        for m in ms: out.write(json.dumps({k: m.get(k) for k in ('ticker','event_ticker','close_time','yes_bid_dollars','yes_ask_dollars','yes_bid_size_fp','yes_ask_size_fp','volume_24h_fp','open_interest_fp','strike_type','title')}) + '\n')
        rows.append(dict(series=s['ticker'], title=s['title'], freq=s['frequency'], fee=f"{s['fee_type']}x{s['fee_multiplier']}", markets=len(ms), events=len(ev), vol24h=round(vol24), oi=round(oi), bid_top=round(bid_sz), ask_top=round(ask_sz), source='; '.join(x.get('name','') for x in (s.get('settlement_sources') or []))[:80], tags=','.join(s.get('tags') or [])))
        print(s['ticker'], len(ms), round(vol24), flush=True)
json.dump(rows, open(f'{D}/census-rows.json', 'w'))
