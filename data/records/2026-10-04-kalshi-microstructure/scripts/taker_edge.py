"""Taking (IOC sell into the best bid) vs resting, weather tails: how often a bid exists, and the per-order fee rounding.
Kalshi taker fee per order = ceil_to_cent(0.07 * C * P * (1-P)) (the desk policy's own formula). Output results/taker-edge.md"""
import math, numpy as np, pandas as pd
from common import *
S = pd.read_csv(f'{RES}/weather-snapshots-scored.csv')
out = ['# Taking the bid: availability and fee rounding (weather tails, touch ask 2-6c)\n', f'{len(S)} snapshots, {S.tk.nunique()} markets.\n']
rows = []
for b in [1, 2, 3, 4, 5]:
    rows.append(dict(best_bid_at_least=b, share_of_snapshots=(S.bid >= b).mean(), share_where_spread_ge2=(S.spread >= 2).mean() if b == 1 else np.nan))
out.append(md(pd.DataFrame(rows).round(3)))
rows = []
for b in [2, 3, 4, 5, 6]:
    for C in [1, 2, 5, 10, 25, 50, 100]:
        fee = math.ceil(0.07 * C * (b / 100) * (1 - b / 100) * 100 - 1e-9)   # cents per order
        for q in [0.01]:
            ev_order = C * (b - 100 * q) - fee
            rows.append(dict(bid_c=b, contracts=C, fee_c_per_order=fee, fee_c_per_contract=fee / C, EV_c_per_order_q1pct=ev_order, EV_c_per_contract=ev_order / C))
T = pd.DataFrame(rows)
out.append('\n## EV of an IOC sell into the best bid (cents), by bid and order size; true YES probability 1%\n'); out.append(md(T[T.contracts.isin([1, 5, 10, 25, 100])].round(3)))
smallest = T[(T.EV_c_per_contract > 0.6)].groupby('bid_c').contracts.min()
out.append('\nSmallest order size in this grid whose EV per contract clears the desk\'s 0.6c admission edge: ' + ', '.join(f'bid {k}c: {v}' for k, v in smallest.items()) + '\n')
open(f'{RES}/taker-edge.md', 'w').write('\n'.join(out) + '\n'); print('\n'.join(out))
