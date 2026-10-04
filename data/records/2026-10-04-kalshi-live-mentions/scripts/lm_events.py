"""Catalog settled mention events (Kalshi public API) -> results/events.json.
usage: lm_events.py SERIES... ; keeps events whose last close >= --since"""
import sys, json, collections, argparse
sys.path.insert(0, __import__('os').path.dirname(__file__))
from kalshi_obs_lib import kget
ap = argparse.ArgumentParser(); ap.add_argument('series', nargs='+'); ap.add_argument('--since', default='2026-08-15'); ap.add_argument('--out', default='results/events.json')
a = ap.parse_args()
ev = {}
for s in a.series:
    cur = None
    while True:
        d = kget('/markets', series_ticker=s, status='settled', limit=1000, cursor=cur)
        if not d: break
        for m in d['markets']:
            if m['close_time'] < a.since: continue
            e = ev.setdefault(m['event_ticker'], {'event': m['event_ticker'], 'series': s, 'markets': []})
            e['markets'].append({k: m.get(k) for k in ('ticker','custom_strike','result','open_time','close_time','occurrence_datetime','settlement_ts','volume_fp','rules_primary','rules_secondary')})
        cur = d.get('cursor')
        if not cur or not d['markets']: break
for e in ev.values():
    ms = e['markets']
    e['n'] = len(ms); e['n_yes'] = sum(m['result']=='yes' for m in ms)
    e['vol'] = sum(float(m['volume_fp'] or 0) for m in ms)
    e['close'] = max(m['close_time'] for m in ms)
    e['title'] = ms[0]['rules_primary'].replace('\n',' ')[:200]
json.dump(sorted(ev.values(), key=lambda e: e['close']), open(a.out, 'w'))
for e in sorted(ev.values(), key=lambda e: e['close']):
    print(e['event'], e['n'], e['n_yes'], int(e['vol']), e['close'][:16], e['title'][:110])
