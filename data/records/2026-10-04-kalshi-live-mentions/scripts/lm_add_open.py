"""Append a not-yet-settled mention event to results/events.json, inferring result=yes where last price>=0.95 (provisional; re-run lm_events.py after settlement)."""
import sys, json, os
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import kget
et = sys.argv[1]; evs = json.load(open('results/events.json')); evs = [e for e in evs if e['event'] != et]
d = kget('/markets', event_ticker=et, limit=200); ms = []
for m in d['markets']:
    ms.append({k: m.get(k) for k in ('ticker','custom_strike','open_time','close_time','occurrence_datetime','volume_fp','rules_primary','rules_secondary')} | {'result': 'yes' if float(m['last_price_dollars']) >= 0.95 else 'no', 'settlement_ts': None})
evs.append(dict(event=et, series=et.split('-')[0], markets=ms, n=len(ms), n_yes=sum(m['result']=='yes' for m in ms), vol=sum(float(m['volume_fp'] or 0) for m in ms), close=ms[0]['close_time'], title=ms[0]['rules_primary'].replace('\n',' ')[:200], provisional=True))
json.dump(evs, open('results/events.json', 'w')); print(et, len(ms), evs[-1]['n_yes'])
