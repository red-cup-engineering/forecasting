"""Settled markets (public) for the non-temperature weather families -> data/settled-<family>.ndjson."""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from kalshi import get, paged
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
fams = sys.argv[1:] or ['KXRAIN', 'KXRAINWKND']
for s in fams:
    n = 0
    with open(f'{D}/settled-{s}.ndjson', 'w') as f:
        for m in paged('/markets', 'markets', series_ticker=s, status='settled', limit=1000):
            f.write(json.dumps({k: m.get(k) for k in ('ticker','event_ticker','close_time','open_time','result','volume_fp','open_interest_fp','last_price_dollars','strike_type','floor_strike','cap_strike','custom_strike','yes_sub_title','rules_primary','settlement_ts','expiration_value')}) + '\n'); n += 1
    print(s, n, flush=True)
