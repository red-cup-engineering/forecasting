"""Taker flow on the desk's price levels. Sells of YES by the desk (2-6c) are lifted by taker=yes trades at that price;
bids at 94-98c are hit by taker=no trades. Output: results/flow.md and csvs."""
import pandas as pd, numpy as np
from common import *
df = load_tape()
wx = df[df.kind == 'weather'].copy()
out = []
days = (df.t.max() - df.t.min()).total_seconds() / 86400
out.append(f'Tape: {len(df)} trades, {df.tk.nunique()} markets, {df.t.min():%Y-%m-%d %H:%M} .. {df.t.max():%Y-%m-%d %H:%M} UTC ({days:.1f} days)\n')

# 1. Who trades at tail prices: by price, taker side
tail = wx[wx.p <= 8]
g = tail.groupby(['p', 's']).agg(trades=('n', 'size'), contracts=('n', 'sum'), median_size=('n', 'median'), mean_size=('n', 'mean')).reset_index()
g['markets'] = [tail[(tail.p == a) & (tail.s == b)].tk.nunique() for a, b in zip(g.p, g.s)]
g['trades_per_market'] = g.trades / g.markets
out.append('## Weather tail tape by YES price and taker side (taker yes = buys YES, lifts an ask = fills a resting seller like the desk; taker no = sells YES, hits a bid)\n')
out.append(md(g.round(2))); g.to_csv(f'{RES}/flow-by-price.csv', index=False)

# size distribution of takers at 2-5c
out.append('\n## Taker size distribution (contracts per trade) at 2-5c\n')
rows = []
for s in ['yes', 'no']:
    x = wx[(wx.p >= 2) & (wx.p <= 5) & (wx.s == s)].n
    rows.append(dict(taker=s, trades=len(x), p10=x.quantile(.1), p50=x.quantile(.5), p90=x.quantile(.9), p99=x.quantile(.99), share_le_5=(x <= 5).mean(), share_ge_100=(x >= 100).mean()))
out.append(md(pd.DataFrame(rows).round(2)))

# 2. Timing: by ET hour, taker-yes at 2-6c (the desk's sell fills)
buy = wx[(wx.s == 'yes') & (wx.p >= 2) & (wx.p <= 6)]
h = buy.groupby('et_hour').agg(trades=('n', 'size'), contracts=('n', 'sum')).reindex(range(24), fill_value=0)
h['share_of_contracts'] = h.contracts / h.contracts.sum()
out.append('\n## Taker-buy-YES at 2-6c by Eastern hour of day (weather)\n'); out.append(md(h.reset_index().round(3)))
h.to_csv(f'{RES}/flow-buy-yes-by-et-hour.csv')

# 3. Days to settlement: buckets of hours to close
bins = [-1, 6, 12, 24, 36, 48, 72, 120, 1e9]
buy2 = buy.assign(bucket=pd.cut(buy.hrs_to_close, bins))
mk = wx[(wx.p >= 1) & (wx.p <= 6)].assign(bucket=pd.cut(wx[(wx.p >= 1) & (wx.p <= 6)].hrs_to_close, bins))
d = buy2.groupby('bucket', observed=True).agg(trades=('n', 'size'), contracts=('n', 'sum'), markets=('tk', 'nunique'))
d['contracts_per_market'] = d.contracts / d.markets
out.append('\n## Taker-buy-YES at 2-6c by hours to close\n'); out.append(md(d.reset_index().round(2)))
d.to_csv(f'{RES}/flow-buy-yes-by-hours-to-close.csv')

# 4. Takers selling YES at 1-3c (who sells cheap YES -> they hit bids; relevant to desk BID side, and to why 1-3c asks are sparse)
sell = wx[(wx.s == 'no') & (wx.p <= 3)]
h2 = sell.groupby('et_hour').agg(trades=('n', 'size'), contracts=('n', 'sum')).reindex(range(24), fill_value=0)
out.append('\n## Taker-sell-YES at 1-3c by Eastern hour (weather)\n'); out.append(md(h2.reset_index()))

# 5. Per-market view for desk-sellable tails: markets with any trade 2-6c; contracts lifted at p>=2 over life
life = wx.groupby('tk', observed=True).agg(first=('t', 'min'), last=('t', 'max'), close=('close', 'first'), result=('result', 'first'))
ev = buy.groupby('tk', observed=True).agg(buy_trades=('n', 'size'), buy_contracts=('n', 'sum'))
life = life.join(ev, how='left').fillna({'buy_trades': 0, 'buy_contracts': 0})
out.append('\n## Per-market taker-buy-YES at 2-6c over the whole life\n')
out.append(f'markets with any weather trade: {len(life)}; with a taker-buy at 2-6c: {(life.buy_trades>0).sum()}; ' \
           f'median contracts lifted at 2-6c per market (those with any): {life[life.buy_trades>0].buy_contracts.median():.0f}; mean {life[life.buy_trades>0].buy_contracts.mean():.0f}')
out.append('\n## By market resolution (tails that settled YES are where takers buy YES at 2-6c with reason)\n')
r = buy.groupby('result', observed=True).agg(trades=('n', 'size'), contracts=('n', 'sum'), markets=('tk', 'nunique'))
out.append(md(r.reset_index()))

# 6. gas
gs = df[df.kind == 'gas']
if len(gs):
    out.append('\n## Gas tape (settled ladders): taker-sell-YES (hits bids) at 94-98c, by price\n')
    z = gs[(gs.p >= 90) & (gs.p <= 99)].groupby(['p', 's']).agg(trades=('n', 'size'), contracts=('n', 'sum'), median=('n', 'median'), markets=('tk', 'nunique')).reset_index()
    out.append(md(z.round(2)))

# 7. Who: size classes and sweep structure (identity is not on the tape; size and walking-the-book are the proxies)
out.append('\n## Taker size classes (share of trades / share of contracts), weather\n')
bins_n = [0, 2, 10, 50, 200, 1e9]; labs = ['1-2', '3-10', '11-50', '51-200', '>200']
rows = []
for name, m in [('buy YES at 1c', (wx.s == 'yes') & (wx.p == 1)), ('buy YES at 2-3c', (wx.s == 'yes') & wx.p.between(2, 3)), ('buy YES at 4-6c', (wx.s == 'yes') & wx.p.between(4, 6)),
                ('sell YES at 1c', (wx.s == 'no') & (wx.p == 1)), ('sell YES at 2-3c', (wx.s == 'no') & wx.p.between(2, 3)), ('sell YES at 4-6c', (wx.s == 'no') & wx.p.between(4, 6))]:
    x = wx[m]; c = pd.cut(x.n, bins_n, labels=labs)
    sh_t = c.value_counts(normalize=True).reindex(labs); sh_v = x.groupby(c).n.sum().reindex(labs) / x.n.sum()
    rows.append(dict(flow=name, trades=len(x), **{f'{l} trades': sh_t[l] for l in labs}, **{f'{l} vol': sh_v[l] for l in labs}))
out.append(md(pd.DataFrame(rows).round(3)))
w2 = wx[(wx.s == 'yes') & wx.p.between(2, 6)].copy(); w2['tk'] = w2.tk.astype(str)
w2['sec'] = w2.t.dt.floor('s')
grp = w2.groupby(['tk', 'sec'], observed=True).agg(levels=('p', 'nunique'), trades=('n', 'size'), vol=('n', 'sum'))
multi = grp[grp.levels >= 2]
out.append(f'\nTaker buys of YES at 2-6c: {len(grp):,} same-second clusters per market; {len(multi):,} ({len(multi)/len(grp):.1%}) walk two or more price levels (one aggressive order sweeping the book), carrying {multi.vol.sum()/grp.vol.sum():.1%} of the contracts. '
           f'Single-level clusters of 1-2 contracts: {((grp.levels==1)&(grp.vol<=2)).mean():.1%} of clusters.\n')
open(f'{RES}/flow.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
