"""Book-snapshot analysis from the collector: depth by level, queue at the touch, touch churn, static-size (farmer) detection,
and the incentive join. Output: results/books.md, results/books-*.csv"""
import glob, json, os
import numpy as np, pandas as pd
from common import *

rows = []
for f in sorted(glob.glob(f'{DATA}/books-*.ndjson')):
    for l in open(f):
        if l.strip(): rows.append(json.loads(l))
B = pd.DataFrame(rows)
B['t'] = pd.to_datetime(B.t, utc=True, format='ISO8601')
state = json.load(open(f'{DATA}/collect-state.json'))
U = pd.DataFrame(state['universe']).drop_duplicates('tk').set_index('tk')
B['kind'] = B.tk.map(U.kind); B['series'] = B.tk.map(U.series)
B['close'] = pd.to_datetime(B.tk.map(U.close), utc=True)
B['hrs_to_close'] = (B.close - B.t).dt.total_seconds() / 3600

def best(lv):  return (lv[0][0], lv[0][1]) if lv else (np.nan, 0.0)
B['bid'], B['bid_q'] = zip(*B.bids.map(best)); B['ask'], B['ask_q'] = zip(*B.asks.map(best))
B['spread'] = B.ask - B.bid
out = [f'Snapshots: {len(B)} over {B.t.nunique()} sweeps, {B.tk.nunique()} markets, {B.t.min():%m-%d %H:%M} .. {B.t.max():%m-%d %H:%M} UTC\n']

# incentive join (hourly windows from the collector; fall back to the one-off dump)
inc = []
for f in sorted(glob.glob(f'{DATA}/incentive-windows-*.ndjson')):
    inc += [json.loads(l) for l in open(f) if l.strip()]
if not inc:
    for f in sorted(glob.glob(f'{DATA}/incentives-*.json')):
        inc += [dict(tk=g['market_ticker'], start=g['start_date'], end=g['end_date'], reward=g['period_reward'], target=float(g['target_size_fp']), disc=g['discount_factor_bps']) for g in json.load(open(f))]
I = pd.DataFrame(inc).drop_duplicates(['tk', 'start', 'end']) if inc else pd.DataFrame(columns=['tk', 'start', 'end', 'reward', 'target', 'disc'])
if len(I):
    I['start'] = pd.to_datetime(I.start, utc=True, format='ISO8601'); I['end'] = pd.to_datetime(I.end, utc=True, format='ISO8601')
def has_lip(r):
    w = I_by.get(r.tk)
    return bool(w is not None and ((w.start <= r.t) & (w.end >= r.t)).any())
I_by = {k: v for k, v in I.groupby('tk')} if len(I) else {}
B['lip'] = [has_lip(r) for r in B[['tk', 't']].itertuples()]
out.append(f'Snapshots inside an active LIP window: {B.lip.mean():.1%} (weather: {B[B.kind=="weather"].lip.mean():.1%}, gas: {B[B.kind=="gas"].lip.mean():.1%})\n')

# ---- weather: the sell side (asks) ----
W = B[B.kind == 'weather']
tail = W[(W.ask >= 2) & (W.ask <= 8)]
out.append('## Weather: queue length at the touch ask, by touch price (a sell joining the touch has this many contracts ahead)\n')
t = tail.groupby('ask').ask_q.describe(percentiles=[.25, .5, .75, .9])[['count', 'mean', '25%', '50%', '75%', '90%', 'max']].reset_index()
out.append(md(t.round(1)))
out.append('\n## Weather: spread (ask - bid) and share of snapshots where a 1c improvement is possible (spread >= 2c), touch ask 2-6c\n')
tt = W[(W.ask >= 2) & (W.ask <= 6)]
s = tt.groupby('ask').agg(snaps=('spread', 'size'), spread_median=('spread', 'median'), share_spread_ge2=('spread', lambda x: (x >= 2).mean()), share_no_bid=('bid', lambda x: x.isna().mean())).reset_index()
out.append(md(s.round(3)))

# depth profile on the ask side
def depth_at(lv, p):
    for pp, q in lv:
        if pp == p: return q
    return 0.0
for p in [2, 3, 4, 5, 6]:
    W = W.assign(**{f'a{p}': [depth_at(l, p) for l in W.asks]})
dp = W[[f'a{p}' for p in [2, 3, 4, 5, 6]]].replace(0, np.nan).describe(percentiles=[.5, .9]).loc[['count', 'mean', '50%', '90%', 'max']].T
out.append('\n## Weather: depth resting at each ask price when any exists (contracts)\n'); out.append(md(dp.reset_index().round(1)))

# churn: how often the touch ask price / size changes between consecutive sweeps
W = W.sort_values(['tk', 't'])
W['prev_ask'] = W.groupby('tk').ask.shift(); W['prev_q'] = W.groupby('tk').ask_q.shift()
W['dt'] = W.groupby('tk').t.diff().dt.total_seconds()
c = W[(W.dt > 0) & (W.dt < 900) & W.ask.between(2, 8)]
out.append('\n## Weather: touch churn between consecutive sweeps (about 5 min apart), touch ask 2-8c\n')
out.append(f'pairs {len(c)}; touch price changed {(c.ask != c.prev_ask).mean():.1%}; touch size changed (same price) {((c.ask == c.prev_ask) & (c.ask_q != c.prev_q)).mean():.1%}; unchanged {((c.ask == c.prev_ask) & (c.ask_q == c.prev_q)).mean():.1%}\n')

# ---- gas: the bid side ----
G = B[B.kind == 'gas']
fav = G[(G.bid >= 90) & (G.bid <= 98)]
out.append('## Gas: depth at the touch bid (a buy joining the touch has this many ahead), by touch price and LIP window\n')
g = fav.groupby(['bid', 'lip']).bid_q.describe(percentiles=[.5, .9])[['count', 'mean', '50%', '90%', 'max']].reset_index()
out.append(md(g.round(1)))
fav = fav.assign(share_ge_target=(fav.bid_q >= 1000))
out.append('\n## Gas: share of snapshots with >= 1000 contracts at the touch bid (LIP target size), by LIP window\n')
out.append(md(fav.groupby('lip').agg(snaps=('bid', 'size'), ge1000=('share_ge_target', 'mean'), median_q=('bid_q', 'median')).reset_index().round(3)))
out.append('\n## Gas: no-ask-at-all (nothing offered): share of favourite snapshots whose book has no YES ask\n')
out.append(f'{fav.ask.isna().mean():.1%}  (only bids and no asks => our bid can fill only against a taker who sells YES, a rare event)\n')

# static size (farmer) detection: same (market, price, size) level on both sides in >= 80% of the market's sweeps
def static_levels(side):
    recs = []
    for r in B.itertuples():
        for p, q in getattr(r, side):
            if q >= 200: recs.append((r.tk, p, q))
    D = pd.DataFrame(recs, columns=['tk', 'p', 'q'])
    if D.empty: return D
    n = B.groupby('tk').size()
    gg = D.groupby(['tk', 'p', 'q']).size().reset_index(name='hits')
    gg['sweeps'] = gg.tk.map(n); gg['share'] = gg.hits / gg.sweeps
    return gg[(gg.share >= .6) & (gg.sweeps >= 3)]
for side in ['bids', 'asks']:
    sl = static_levels(side)
    sl['kind'] = sl.tk.map(U.kind) if len(sl) else None
    sl.to_csv(f'{RES}/books-static-{side}.csv', index=False)
    out.append(f'\n## Static large levels ({side}, >= 200 contracts, identical size in >= 60% of sweeps): {len(sl)} levels in {sl.tk.nunique() if len(sl) else 0} markets; weather {int((sl.kind=="weather").sum()) if len(sl) else 0}, gas {int((sl.kind=="gas").sum()) if len(sl) else 0}\n')
    if len(sl): out.append(md(sl.groupby(['kind', 'p']).agg(levels=('q', 'size'), median_size=('q', 'median')).reset_index().sort_values('levels', ascending=False).head(15).round(0)))

# desk queue positions vs the book's depth at the order's level
dq = []
for f in sorted(glob.glob(f'{DATA}/desk-queue-*.ndjson')):
    dq += [json.loads(l) for l in open(f) if l.strip()]
if dq:
    D = pd.DataFrame(dq); D['t'] = pd.to_datetime(D.t, utc=True, format='ISO8601')
    def level_depth(r):
        b = B[(B.tk == r.tk) & (B.t == r.t)]
        if b.empty: return np.nan
        lv = b.iloc[0].asks if r.side == 'ask' else b.iloc[0].bids
        return depth_at(lv, r.p)
    D['book_depth_at_level'] = [level_depth(r) for r in D.itertuples()]
    D.to_csv(f'{RES}/desk-queue-vs-book.csv', index=False)
    out.append('\n## Desk resting orders: signed queue_position (contracts ahead) vs book depth at that level, per sweep\n')
    out.append(md(D.groupby(['tk', 'side', 'p']).agg(reads=('q', 'size'), q_first=('q', 'first'), q_last=('q', 'last'), depth_first=('book_depth_at_level', 'first'), depth_last=('book_depth_at_level', 'last'), size=('n', 'first')).reset_index().head(40).round(1)))
open(f'{RES}/books.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
