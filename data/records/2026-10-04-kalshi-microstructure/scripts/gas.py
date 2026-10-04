"""Gas ladders (AAA/diesel daily): fill model for a resting BUY of YES at 94-98c and the live queue/LIP picture. Output results/gas.md"""
import json, glob, numpy as np, pandas as pd
from common import *
G = pd.read_csv(f'{RES}/fill-grid-gas.csv')
QS = [0, 1, 5, 20, 100, 500, 1000, 2000, 5000]
out = ['# Gas favourites (resting BUY of YES at 94-98c): queue-aware fill model\n',
       'Replay of the public tape of settled KXAAAGASD*/KXDIESELD ladders (last 5 days): fill iff taker-SELL-YES volume at exactly p exceeds the queue ahead, or any taker sold YES below p. 10-minute placement grid, liveness = a trade within 2c of p in the prior hour.\n']
for H in [20, 60, 240]:
    t = G[G.H == H].groupby(['p', 'Q'])[['filled', 'clean', 'n']].sum(); r = (t.filled / t.n).unstack(); rc = (t.clean / t.n).unstack()
    out.append(f'\n## P(any fill) within {H} min by price (rows) and contracts ahead (cols)\n'); out.append(md(r.reset_index().round(4)))
    out.append(f'\n## P(CLEAN fill: queue consumed by taker volume before any sweep) within {H} min\n'); out.append(md(rc.reset_index().round(4)))
    out.append(f'\nsamples per price: ' + ', '.join(f'{p}: {int(t.n.xs(p).iloc[0]):,}' for p in sorted(G.p.unique())))
lab = {0: '<1h', 1: '1-2h', 2: '2-4h', 3: '4-8h', 4: '8-24h', 5: '>24h'}
g = G[(G.H == 60) & (G.p.isin([97, 98]))]
t = g.groupby(['hb', 'Q'])[['filled', 'clean', 'n']].sum(); r = (t.filled / t.n).unstack(); r.index = r.index.map(lab)
out.append('\n## P(fill in 60 min), p=97-98c, by hours to close (the lane trades the final 2 hours)\n'); out.append(md(r.reset_index().rename(columns={'hb': 'hours_to_close'}).round(4)))
# live queue vs the model: what Q do we actually face
rows = []
for f in sorted(glob.glob(f'{DATA}/books-*.ndjson')):
    rows += [json.loads(l) for l in open(f) if l.strip()]
B = pd.DataFrame(rows)
st = json.load(open(f'{DATA}/collect-state.json')); U = {u['tk']: u for u in st['universe']}
B = B[B.tk.map(lambda k: U.get(k, {}).get('kind') == 'gas')]
B['bid'] = B.bids.map(lambda l: l[0][0] if l else np.nan); B['bid_q'] = B.bids.map(lambda l: l[0][1] if l else 0.0)
B['ask'] = B.asks.map(lambda l: l[0][0] if l else np.nan)
F = B[B.bid.between(94, 98)]
out.append(f'\n## Live gas books: touch-bid queue (what a joining 1-lot has ahead of it), {len(F)} snapshots, {F.tk.nunique()} markets\n')
rows = []
for p, g in F.groupby('bid'):
    rows.append(dict(touch_bid=int(p), snaps=len(g), q_le_10=(g.bid_q <= 10).mean(), q_le_100=(g.bid_q <= 100).mean(), q_ge_1000=(g.bid_q >= 1000).mean(), median_q=g.bid_q.median(), p90_q=g.bid_q.quantile(.9), no_ask_share=g.ask.isna().mean()))
out.append(md(pd.DataFrame(rows).round(3)))
# expected fill probability for a joiner at the live queue
def pf(p, Q, H, col='filled'):
    t = G[(G.p == p) & (G.H == H)].groupby('Q')[['filled', 'clean', 'n']].sum(); v = (t[col] / t.n).reindex(QS).values
    return float(np.interp(np.log1p(Q), np.log1p(QS), v))
for H in [60, 240]:
    F = F.assign(**{f'pf{H}': [pf(int(r.bid), r.bid_q, H) for r in F.itertuples()], f'pc{H}': [pf(int(r.bid), r.bid_q, H, 'clean') for r in F.itertuples()]})
out.append(f'\nExpected P(fill) for a 1-lot joining the touch bid at the live queue: within 60 min {F.pf60.mean():.2%}; within 240 min {F.pf240.mean():.2%}. '
           f'CLEAN (volume-only) fills: {F.pc60.mean():.2%} / {F.pc240.mean():.2%}. Where the queue is <= 100: {F[F.bid_q<=100].pf60.mean():.2%} / {F[F.bid_q<=100].pf240.mean():.2%} (n={int((F.bid_q<=100).sum())} snapshots).\n')
open(f'{RES}/gas.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))

# realised result of the simulated fills, by channel (all strikes with a live bid at p; 'yes' = the YES side won)
g = G[(G.H == 240) & (G.Q == 0)]
rows = []
for p, gg in g.groupby('p'):
    t = gg.groupby('yes')[['filled', 'clean', 'n']].sum()
    for ch, col in [('any', 'filled'), ('clean', 'clean')]:
        fills = t[col].sum(); win = t[col].get(1, 0)
        sweep = t.filled.sum() - t.clean.sum(); swin = t.filled.get(1, 0) - t.clean.get(1, 0)
        rows.append(dict(p=int(p), channel=ch, fills=int(fills), win_rate=win / fills if fills else np.nan, pnl_per_contract_c=(100 * win / fills - p) if fills else np.nan))
    rows.append(dict(p=int(p), channel='sweep-only', fills=int(sweep), win_rate=swin / sweep if sweep else np.nan, pnl_per_contract_c=(100 * swin / sweep - p) if sweep else np.nan))
txt = '\n## Gas bids: realised result of the simulated fills by channel (every strike with a live bid at p, held to settlement, no fee)\n\n' + md(pd.DataFrame(rows).sort_values(['channel', 'p']).round(3)) + '\n\nSweep fills are the price falling through the bid: the favourite is losing, and the win rate shows it.\n'
open(f'{RES}/gas.md', 'a').write(txt); print(txt)
