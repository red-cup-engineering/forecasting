"""Queue-aware EV of the weather tail-premium lane from the fill grid (fillmodel.py) and the live book queues (collector).
A SELL of YES at p cents has EV per filled contract  p - 100*q  (q = true YES probability; makers pay no fee: fills show fee_cost 0).
Per-order EV = P(fill | p, Q, H) * (p - 100 q).  Compared across: join the touch, improve 1c inside, take the bid.
Writes results/fill-model.md and results/weather-ev.md"""
import glob, json, numpy as np, pandas as pd
from common import *
G = pd.read_csv(f'{RES}/fill-grid.csv')
QS = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500]; HS = [20, 60, 240]
lab_tb_ = {0: '<1', 1: '1-10', 2: '10-50', 3: '50-200', 4: '>200'}
def pooled(**flt):
    g = G
    for k, v in flt.items(): g = g[g[k].isin(v if isinstance(v, (list, tuple, set)) else [v])]
    return g.groupby(['p', 'Q', 'H'])[['filled', 'clean', 'n']].sum()
P = pooled()
PT = G.groupby(['p', 'tb', 'Q', 'H'])[['filled', 'clean', 'n']].sum()
TBINS = [1, 10, 50, 200]
def pf_tb(p, Q, H, tb, col='filled'):
    """P(fill) interpolated in log1p(Q) and H, conditional on the trailing-6h taker-buy volume bucket tb (falls back to pooled when thin)."""
    def at(q, h):
        try:
            r = PT.loc[(p, tb, q, h)]
            if r.n >= 150: return r[col] / r.n
        except KeyError: pass
        try: r = P.loc[(p, q, h)]; return r[col] / r.n
        except KeyError: return 0.0
    x = np.log1p(Q); xs = np.log1p(QS)
    j = int(np.clip(np.searchsorted(xs, x) - 1, 0, len(QS) - 2)); w = float(np.clip((x - xs[j]) / (xs[j + 1] - xs[j]), 0, 1))
    def at_h(q):
        if H <= HS[0]: return at(q, HS[0]) * H / HS[0]
        if H >= HS[-1]: return at(q, HS[-1])
        k = 0 if H < HS[1] else 1
        u = (H - HS[k]) / (HS[k + 1] - HS[k]); return at(q, HS[k]) * (1 - u) + at(q, HS[k + 1]) * u
    return at_h(QS[j]) * (1 - w) + at_h(QS[j + 1]) * w
def pf_grid(p, Q, H, tab=P):
    """Interpolate P(fill) in log1p(Q) and H."""
    def at(q, h):
        try: r = tab.loc[(p, q, h)]; return r.filled / r.n if r.n else 0.0
        except KeyError: return 0.0
    x = np.log1p(Q); xs = np.log1p(QS)
    j = int(np.clip(np.searchsorted(xs, x) - 1, 0, len(QS) - 2)); w = (x - xs[j]) / (xs[j + 1] - xs[j]); w = float(np.clip(w, 0, 1))
    def at_h(q):
        if H <= HS[0]: return at(q, HS[0]) * H / HS[0]
        if H >= HS[-1]: return at(q, HS[-1])
        k = 0 if H < HS[1] else 1
        u = (H - HS[k]) / (HS[k + 1] - HS[k]); return at(q, HS[k]) * (1 - u) + at(q, HS[k + 1]) * u
    return at_h(QS[j]) * (1 - w) + at_h(QS[j + 1]) * w

out = ['# Queue-aware fill model for a resting sell of YES (weather tails)\n',
       f'Replay of {int(G[(G.Q==0)&(G.H==60)&(G.p==2)].n.sum()):,} (market, 10-minute placement time) samples per price for p=2c, over the public tape of settled KXHIGH/KXLOWT markets '
       '(fill iff taker-buy-YES volume at exactly p exceeds the queue ahead, or any taker bought YES above p). Liveness filter: a trade within 2c of p in the previous 60 minutes.\n']
for H in HS:
    t = P.xs(H, level='H'); r = (t.filled / t.n).unstack()
    out.append(f'\n## P(fill) within {H} min, by price p (rows) and contracts ahead Q (columns)\n'); out.append(md(r.reset_index().round(3)))
    n = t.n.unstack().iloc[:, 0]; out.append(f'\nsamples per cell: p=2: {int(n.loc[2]):,}, 3: {int(n.loc[3]):,}, 4: {int(n.loc[4]):,}, 5: {int(n.loc[5]):,}, 6: {int(n.loc[6]):,}')

for H in HS:
    t = P.xs(H, level='H'); r = (t.clean / t.n).unstack()
    out.append(f'\n## CLEAN fills only: P(queue consumed by taker volume at p, before any sweep through the level) within {H} min\n'); out.append(md(r.reset_index().round(3)))
lab_tb_ = {0: '<1', 1: '1-10', 2: '10-50', 3: '50-200', 4: '>200'}
# by hours to close (hb: 0:<6, 1:6-12, 2:12-24, 3:24-36, 4:36-48, 5:>48) and ET block (eb 0:0-4h ... 5:20-24h) for Q in 0, 20; H=60
lab_hb = {0: '<6h', 1: '6-12h', 2: '12-24h', 3: '24-36h', 4: '36-48h', 5: '>48h'}; lab_eb = {0: '00-04ET', 1: '04-08', 2: '08-12', 3: '12-16', 4: '16-20', 5: '20-24'}
for Q in [0, 20]:
    g = G[(G.H == 60) & (G.Q == Q) & (G.p.isin([2, 3, 4, 5, 6]))]
    t = g.groupby('hb')[['filled', 'n']].sum(); t['P_fill_60min'] = t.filled / t.n; t.index = t.index.map(lab_hb)
    out.append(f'\n## P(fill in 60 min) at Q={Q}, p=2-6c pooled, by hours to settlement\n'); out.append(md(t.reset_index().rename(columns={'hb': 'hours_to_close'}).round(3)))
    t = g.groupby('eb')[['filled', 'n']].sum(); t['P_fill_60min'] = t.filled / t.n; t.index = t.index.map(lab_eb)
    out.append(f'\n## P(fill in 60 min) at Q={Q}, p=2-6c pooled, by Eastern time of placement\n'); out.append(md(t.reset_index().rename(columns={'eb': 'placement_time'}).round(3)))
# trailing volume
lab_tb = {0: '<1', 1: '1-10', 2: '10-50', 3: '50-200', 4: '>200'}
g = G[(G.H == 60) & (G.Q.isin([0, 20])) & (G.p.isin([2, 3, 4, 5, 6]))]
t = g.groupby(['tb', 'Q'])[['filled', 'n']].sum(); t['P'] = t.filled / t.n
tt = t.P.unstack(); tt.index = tt.index.map(lab_tb); tt['samples'] = t.n.groupby('tb').sum().values
out.append('\n## P(fill in 60 min) by trailing-6h taker-buy volume at >= p (arrival-rate proxy), p=2-6c pooled\n'); out.append(md(tt.reset_index().rename(columns={'tb': 'trailing_6h_contracts', 0: 'Q=0', 20: 'Q=20'}).round(3)))
# adverse selection: fill rate when market ends YES vs NO
g = G[(G.H == 240) & (G.Q == 0) & (G.p.isin([2, 3, 4, 5, 6]))]
t = g.groupby('yes')[['filled', 'n']].sum(); t['P_fill_240min_Q0'] = t.filled / t.n; t.index = t.index.map({0: 'settles NO', 1: 'settles YES'})
out.append('\n## Adverse selection: P(fill within 240 min at Q=0) by how the market settles (all brackets trading at 2-6c, not just certified tails)\n'); out.append(md(t.reset_index().round(3)))
g2 = G[(G.H == 240) & (G.Q == 0) & (G.p.isin([2, 3, 4, 5, 6]))].groupby('yes')[['filled', 'clean', 'n']].sum()
out.append('\n## Where fills land, by channel (H=240, Q=0, all brackets at 2-6c): share of fills in markets that settle YES\n')
out.append(md(pd.DataFrame([dict(channel='any fill', yes_share=g2.filled.get(1, 0) / g2.filled.sum()), dict(channel='clean (volume) fill', yes_share=g2.clean.get(1, 0) / g2.clean.sum()),
                            dict(channel='sweep-only fill (level cleared by price move)', yes_share=(g2.filled.get(1, 0) - g2.clean.get(1, 0)) / (g2.filled.sum() - g2.clean.sum())),
                            dict(channel='all samples', yes_share=g2.n.get(1, 0) / g2.n.sum())]).round(4)))
sh = t.loc['settles YES', 'filled'] / (t.filled.sum())
out.append(f'\nShare of simulated fills that land on markets that settle YES: {sh:.2%}; share of all samples that settle YES: {t.loc["settles YES","n"]/t.n.sum():.2%}. '
           'Resting sellers are adversely selected when the first is larger than the second.\n')
# old rule vs queue-aware, same placements
Q0 = {2: 85, 3: 53, 4: 18, 5: 50, 6: 10}
rows = []
for pp in [2, 3, 4, 5, 6, 'all']:
    for tbv in ['all', 0, 4]:
        g = G[(G.H == 240)]
        if pp != 'all': g = g[g.p == pp]
        if tbv != 'all': g = g[g.tb == tbv]
        if g.empty: continue
        base = g[g.Q == 0]
        old = base.old6.sum() / base.n.sum()
        qm = []
        for p_, gg in g.groupby('p'):
            q = Q0[p_]; qq = min(QS, key=lambda x: abs(np.log1p(x) - np.log1p(q))); gq = gg[gg.Q == qq]; qm.append((gq.filled.sum(), gq.clean.sum(), gq.n.sum()))
        f, c, n = np.sum(qm, axis=0)
        rows.append(dict(price=pp, trailing_vol='all' if tbv == 'all' else lab_tb_[tbv], samples=int(base.n.sum()), old_rule_6h=old, queue_aware_Q0_4h=base.filled.sum() / base.n.sum(), queue_aware_Qmedian_4h=f / n, clean_Qmedian_4h=c / n))
out.append('\n## Old backtest fill rule (any later trade at/through p within 6h) vs queue-aware rule on the same placements\n')
out.append(md(pd.DataFrame(rows).round(3)))
out.append('\n(queue_aware horizons are 4h: the old rule gets 6h, so the gap is understated. Q_median = the median touch depth by price measured in the live books: 2c: 85, 3c: 53, 4c: 18, 5c: 50, 6c: 10.)\n')
open(f'{RES}/fill-model.md', 'w').write('\n'.join(out) + '\n')

# ---- EV with the live book queues, conditional on trailing volume ----
rows = []
for f in sorted(glob.glob(f'{DATA}/books-*.ndjson')):
    for l in open(f):
        if l.strip(): rows.append(json.loads(l))
B = pd.DataFrame(rows); B['t'] = pd.to_datetime(B.t, utc=True, format='ISO8601')
st = json.load(open(f'{DATA}/collect-state.json')); U = {u['tk']: u for u in st['universe']}
B = B[B.tk.map(lambda k: U.get(k, {}).get('kind') == 'weather')]
tr = {}
seen = set()
for f in [f'{DATA}/tape-universe.ndjson'] + sorted(glob.glob(f'{DATA}/trades-*.ndjson')):
    for l in open(f):
        if not l.strip(): continue
        r = json.loads(l)
        if r['id'] in seen: continue
        seen.add(r['id']); tr.setdefault(r['tk'], []).append((pd.Timestamp(r['t']).timestamp(), r['p'], r['n'], r['s'] == 'yes'))
tr = {k: np.array(v, dtype=float) for k, v in tr.items()}
def trailing(tk, t, p):
    a = tr.get(tk)
    if a is None: return 0.0
    ts = t.timestamp(); m = (a[:, 0] <= ts) & (a[:, 0] > ts - 6 * 3600) & (a[:, 3] == 1) & (a[:, 1] >= p)
    return float(a[m, 2].sum())
def depth(lv, p): return next((q for pp, q in lv if pp == p), 0.0)
recs = []
for r in B.itertuples():
    asks, bids = r.asks, r.bids
    if not asks: continue
    ta = asks[0][0]
    if not 2 <= ta <= 6: continue
    tb_ = bids[0][0] if bids else 0
    recs.append(dict(tk=r.tk, t=r.t, touch=ta, Q_touch=asks[0][1], bid=tb_, spread=ta - tb_, Q_in=depth(asks, ta - 1),
                     trail=trailing(r.tk, r.t, ta), trail_in=trailing(r.tk, r.t, ta - 1), hrs=(pd.Timestamp(U[r.tk]['close']) - r.t).total_seconds() / 3600))
S = pd.DataFrame(recs)
S['tb'] = np.digitize(S.trail, TBINS); S['tb_in'] = np.digitize(S.trail_in, TBINS)
ev = ['# Weather tail-premium lane: queue-aware expected value per resting order\n',
      f'{len(S)} weather book snapshots (touch ask 2-6c) over {S.t.nunique()} sweeps, {S.tk.nunique()} markets. Fill probabilities come from the replay grid CONDITIONAL on the market\'s trailing-6h taker-buy volume at the price (the arrival-rate proxy), and on the queue ahead read from the book.\n']
lab = {0: '<1', 1: '1-10', 2: '10-50', 3: '50-200', 4: '>200'}
for q_loss in [0.01, 0.0025]:
    rows = []
    for tbv in [None, 0, 1, 2, 3, 4]:
        s_ = S if tbv is None else S[S.tb == tbv]
        if len(s_) == 0: continue
        for H in [30, 60, 240]:
            A = [pf_tb(r.touch, r.Q_touch, H, r.tb) for r in s_.itertuples()]
            Ac = [pf_tb(r.touch, r.Q_touch, H, r.tb, 'clean') for r in s_.itertuples()]
            imp = s_[(s_.spread >= 2) & (s_.touch - 1 >= 2)]
            Bf = [pf_tb(r.touch - 1, r.Q_in, H, r.tb_in) for r in imp.itertuples()]
            Af = [pf_tb(r.touch, r.Q_touch, H, r.tb) for r in imp.itertuples()]
            tk_ = s_[s_.bid >= 1]
            rows.append(dict(trailing_6h_vol=('all' if tbv is None else lab[tbv]), H_min=H, snaps=len(s_), median_Q_touch=s_.Q_touch.median(),
                             join_Pfill=np.mean(A), join_Pclean=np.mean(Ac), join_EV_c=np.mean([a * (r.touch - 100 * q_loss) for a, r in zip(A, s_.itertuples())]), join_EV_clean_c=np.mean([a * (r.touch - 100 * q_loss) for a, r in zip(Ac, s_.itertuples())]),
                             imp_snaps=len(imp), imp_join_Pfill=np.mean(Af) if len(imp) else np.nan, imp_improve_Pfill=np.mean(Bf) if len(imp) else np.nan,
                             imp_join_EV_c=np.mean([a * (r.touch - 100 * q_loss) for a, r in zip(Af, imp.itertuples())]) if len(imp) else np.nan,
                             imp_improve_EV_c=np.mean([b * (r.touch - 1 - 100 * q_loss) for b, r in zip(Bf, imp.itertuples())]) if len(imp) else np.nan,
                             take_bid_EV_c=np.mean([r.bid - 100 * q_loss - 7 * (r.bid / 100) * (1 - r.bid / 100) for r in tk_.itertuples()]) if len(tk_) else np.nan))
    ev.append(f'\n## EV in cents per contract per resting order; true YES probability q = {q_loss:.2%}\n'); ev.append(md(pd.DataFrame(rows).round(3)))
ev.append('\n(join: sell at the current best ask, Q ahead = depth there; improve: sell 1c below the touch where spread >= 2c and price stays >= 2c, Q ahead = depth at that level; take_bid: IOC sell into the best bid with the taker fee 0.07*b*(1-b) per contract before per-order cent rounding. A makers pays 0 (desk fills show fee_cost 0). Replay assumptions: no cancels ahead of us, we are visible instantly.)\n')
rp = pd.read_csv(f'{RES}/desk-orders-replay.csv'); w = rp[(rp.lane == 'weather') & rp.covered]
ev.append(f'\n## Against the desk\'s own record\nweather sells with tape coverage: {len(w)} orders, {w.life_min.sum()/60:.1f} order-hours, realised fills {int((w.filled>0).sum())} orders ({(w.filled>0).mean():.1%} per order); '
          f'orders whose price saw ANY taker volume or sweep during their life: {int(((w.V>0)|(w.A>0)).sum())} ({((w.V>0)|(w.A>0)).mean():.1%}) = the ceiling at Q=0.\n')
S.to_csv(f'{RES}/weather-snapshots-scored.csv', index=False)
open(f'{RES}/weather-ev.md', 'w').write('\n'.join(ev) + '\n')
print('\n'.join(ev))

# realised result of simulated weather sells by channel and trailing-volume bucket (ALL brackets at p, not certified tails; held to settlement)
g = G[(G.H == 240) & (G.Q == 0)]
rows = []
for p, gg in g.groupby('p'):
    t = gg.groupby('yes')[['filled', 'clean', 'n']].sum()
    for ch, mask in [('any', t.filled), ('clean', t.clean), ('sweep-only', t.filled - t.clean)]:
        f = mask.sum(); loss = mask.get(1, 0)
        rows.append(dict(p=int(p), channel=ch, fills=int(f), yes_rate=loss / f, pnl_per_contract_c=p - 100 * loss / f))
txt = '\n## Weather sells: realised result of simulated fills by channel (all brackets at p, uncertified, sold at p and held, no fee)\n\n' + md(pd.DataFrame(rows).sort_values(['channel', 'p']).round(3)) + \
      '\n\nThe uncertified base rate settles YES about 1.7% of the time; certified far tails (model p <= 1%) must beat it. A sweep fill is the market moving up through the ask.\n'
open(f'{RES}/fill-model.md', 'a').write(txt)
print(txt)

# EV per resting contract by price: where does a resting sell earn?  (join at the median touch queue vs 1c inside at Q=0)
rows = []
for tbv, name in [(None, 'all markets'), (0, 'quiet (<1 contract bought at >=p in 6h)')]:
    for p in [2, 3, 4, 5, 6]:
        for H in [30, 60, 240]:
            def f(pp, Q, col='filled'):
                if tbv is None:
                    r = []
                    for tb_ in range(5):
                        try: n = PT.loc[(pp, tb_, 0, 60)].n
                        except KeyError: n = 0
                        r.append((pf_tb(pp, Q, H, tb_, col), n))
                    w = sum(n for _, n in r); return sum(v * n for v, n in r) / w if w else 0
                return pf_tb(pp, Q, H, tbv, col)
            join = f(p, Q0[p]); jc = f(p, Q0[p], 'clean'); imp = f(p - 1, 0) if p > 2 else np.nan
            rows.append(dict(market=name, p=p, H_min=H, Q_ahead=Q0[p], P_fill=join, P_clean=jc, EV_c_q1pct=join * (p - 1), EV_clean_c_q1pct=jc * (p - 1), EV_c_q025pct=join * (p - .25),
                             inside_p=p - 1 if p > 2 else None, inside_P_fill=imp, inside_EV_c_q1pct=imp * (p - 2) if p > 2 else np.nan))
T = pd.DataFrame(rows)
txt = '\n## Resting-sell EV per contract by price (cents; join at the median touch queue vs one cent inside at Q=0)\n\n' + md(T.round(3)) + '\n'
open(f'{RES}/weather-ev.md', 'a').write(txt); T.to_csv(f'{RES}/weather-ev-by-price.csv', index=False)
print(txt)
