"""KXRAIN edges: certified tails (sell YES) and near-certain favourites (buy YES), taker and queue-aware resting, real fees."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from edges import *
d = pd.read_csv(f'{D}/rain-scored.csv')
tapes = load_tape(f'{D}/trades-rain.ndjson')
out = ['# KXRAIN edges (model: NBS P06 logistic, cross-fit; truth: Kalshi results)', '', f'{d.date.min()}..{d.date.max()}, {d.ticker.nunique()} markets. One entry per market (first decision time that qualifies). Pnl in cents per contract after fees (taker at batch 10; resting pays no fee). Resting fills use the queue-aware rule, 4h horizon, queue ahead from the microstructure table.', '']
def pick(mask_fn, kind):
    c = d[mask_fn(d)].sort_values('t').drop_duplicates('ticker').copy(); c['kind'] = kind; return c
def summarise(c, label, h=4.0):
    if c.empty: return None
    s = score(c, tapes, horizon_h=h)
    n = len(s); filled = s.rest_fill.sum()
    return dict(rule=label, markets=n, losses=int((s.taker_pnl < -0.5).sum()) if c.kind.iloc[0] == 'tail_sell' else int((s.y == 0).sum()), lost_yes=int(s.y.sum()) if c.kind.iloc[0] == 'tail_sell' else int((1 - s.y).sum()), taker_c=round(100 * s.taker_pnl.mean(), 2), taker_total_c_per_ct=round(100 * s.taker_pnl.sum(), 1), rest_fill_rate=round(filled / n, 3), rest_clean=int((s.rest_channel == 'clean').sum()), rest_c_per_filled=round(100 * s.rest_pnl.sum() / max(filled, 1), 2), rest_c_per_placed=round(100 * s.rest_pnl.sum() / n, 2), median_flow=float(s.flow_at_touch.median()))
rows = []
for dec_set, nm in ((['D-1 15h', 'D-1 21h'], 'day-before'), (['D 07h'], 'same-day 07h')):
    for thr in (0.005, 0.01, 0.02):
        for bmin in (0.03, 0.04):
            c = pick(lambda x: x.dec.isin(dec_set) & (x.pm_pany <= thr) & (x.bid >= bmin) & (x.bid <= 0.10), 'tail_sell')
            r = summarise(c, f'TAIL sell {nm} p<={thr} bid>={bmin}');  rows.append(r) if r else None
    for thr in (0.95, 0.97, 0.98):
        for amax in (0.96, 0.97):
            c = pick(lambda x: x.dec.isin(dec_set) & (x.pm_pany >= thr) & (x.ask <= amax) & (x.ask > 0.5), 'fav_buy')
            r = summarise(c, f'FAV buy {nm} p>={thr} ask<={amax}');  rows.append(r) if r else None
res = pd.DataFrame(rows); res.to_csv(f'{R}/rain-edges.csv', index=False)
out += [md(res, index=False)]
open(f'{R}/rain-edges.md', 'w').write('\n'.join(out)); print('\n'.join(out))
