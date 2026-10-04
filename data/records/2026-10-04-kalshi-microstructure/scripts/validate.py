"""Validate the queue model against the desk's own resting history (data/desk-orders.json, signed GET /portfolio/orders).
For every desk SELL order (weather) replay the public tape over [created, last_update] (end of life = cancel/expiry/fill):
  V = taker-buy-YES volume at exactly the order's price; A = a taker bought YES above it (level cleared).
With Q contracts ahead the order fills iff V > Q or A. Expected fills at each Q vs the 1 realised fill pins the queue the desk faced.
Also the same for desk gas BIDs (taker-sell-YES at the bid price, or any taker sell below it)."""
import json, numpy as np, pandas as pd
from common import *
O = pd.DataFrame(json.load(open(f'{DATA}/desk-orders.json')))
O['created'] = pd.to_datetime(O.created_time, utc=True, format='ISO8601'); O['end'] = pd.to_datetime(O.last_update_time, utc=True, format='ISO8601')
O['p'] = (O.yes_price_dollars.astype(float) * 100).round().astype(int); O['n'] = O.initial_count_fp.astype(float); O['filled'] = O.fill_count_fp.astype(float)
O['lane'] = np.where(O.ticker.str.contains('AAAGAS|DIESEL'), 'gas', 'weather')
# the tape for desk tickers, public (historic file + live file) — desk markets are open, so the live collector tape is the source
T = load_tape()
T = T[T.tk.isin(O.ticker.unique())].copy()
by = {k: g.sort_values('t') for k, g in T.groupby('tk', observed=True)}
rows = []
for o in O.itertuples():
    g = by.get(o.ticker)
    V = A = 0.0; covered = g is not None
    if covered:
        w = g[(g.t > o.created) & (g.t <= o.end)]
        if o.lane == 'weather':
            V = w[(w.s == 'yes') & (w.p == o.p)].n.sum(); A = int(((w.s == 'yes') & (w.p > o.p)).any())
        else:
            V = w[(w.s == 'no') & (w.p == o.p)].n.sum(); A = int(((w.s == 'no') & (w.p < o.p)).any())
    life = (o.end - o.created).total_seconds() / 60
    rows.append(dict(id=o.order_id, tk=o.ticker, lane=o.lane, p=o.p, n=o.n, filled=o.filled, status=o.status, life_min=life, V=V, A=A, covered=covered, created=o.created))
R = pd.DataFrame(rows)
R.to_csv(f'{RES}/desk-orders-replay.csv', index=False)
out = ['# Desk resting history replayed against the public tape\n']
for lane, g in R.groupby('lane'):
    out.append(f'\n## {lane}: {len(g)} orders, {g.n.sum():.0f} contracts, {g.life_min.sum()/60:.1f} order-hours, realised fill {g.filled.sum():.0f} contracts in {int((g.filled>0).sum())} orders\n')
    out.append(f'tape-covered orders: {int(g.covered.sum())}; orders where ANY taker volume reached the price during life (V>0 or level cleared): {int(((g.V>0)|(g.A>0)).sum())}; median V among those: {g[(g.V>0)].V.median():.1f}\n')
    rows2 = []
    for Q in [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 3000]:
        e = ((g.V > Q) | (g.A > 0)).sum()
        rows2.append(dict(Q_ahead=Q, orders_that_would_fill=int(e), share=e / len(g), realised_fills=int((g.filled > 0).sum())))
    out.append(md(pd.DataFrame(rows2).round(3)))
# the single fill: the tape volume at its price in its window
f = R[R.filled > 0]
out.append('\n## The realised fill(s)\n'); out.append(md(f[['tk', 'p', 'n', 'filled', 'life_min', 'V', 'A']].round(1)))
# likelihood of Q (lognormal) given outcomes, weather sells
g = R[(R.lane == 'weather') & R.covered].copy()
best = None
res = []
from math import erf, sqrt, log
def cdf(x, mu, sg): return 0.5 * (1 + erf((log(max(x, 1e-9)) - mu) / (sg * sqrt(2))))
for mu in np.arange(0, 8.01, .25):
    for sg in [.5, 1, 1.5, 2, 3]:
        ll = 0
        for r in g.itertuples():
            # P(fill) = P(Q < V) (or 1 if level cleared); Q>=0 so Q=0 has mass: treat Q' = Q+1 lognormal, fill iff Q' <= V
            pf = 1.0 if r.A else (cdf(r.V, mu, sg) if r.V > 0 else 0.0)
            pf = min(max(pf, 1e-9), 1 - 1e-9)
            ll += np.log(pf) if r.filled > 0 else np.log(1 - pf)
        res.append((ll, mu, sg))
res.sort(reverse=True)
out.append('\n## Implied queue ahead of the desk (lognormal on Q+1), maximum likelihood on weather sells\n')
out.append(md(pd.DataFrame([dict(loglik=a, median_Q=np.exp(b) - 1, sigma=c) for a, b, c in res[:8]]).round(2)))
out.append('\n(With one realised fill the likelihood is flat above its peak; read it as a lower bound on Q, not a point estimate.)\n')

# ---- calibration of the grid against the desk: matched covariates (trailing 6h taker-buy volume, hours to close, liveness) ----
G = pd.read_csv(f'{RES}/fill-grid.csv')
TB = [1, 10, 50, 200]; HB = [6, 12, 24, 36, 48]
def grid_p(p, tb, hb, life, Q=0):
    r = {}
    for H in (20, 60, 240):
        g = G[(G.p == p) & (G.Q == Q) & (G.H == H) & (G.tb == tb)]
        gh = g[g.hb == hb]
        g = gh if gh.n.sum() > 200 else g
        r[H] = g.filled.sum() / g.n.sum() if g.n.sum() else np.nan
    xs = [20, 60, 240]; ys = [r[h] for h in xs]
    return float(np.interp(life, xs, ys)) if life >= 20 else ys[0] * life / 20
meta = json.load(open(f'{DATA}/tape-markets.json'))
cal = []
for o in R[(R.lane == 'weather') & R.covered].itertuples():
    g = by[o.tk]
    pre = g[(g.t <= o.created) & (g.t > o.created - pd.Timedelta(hours=6))]
    trail = pre[(pre.s == 'yes') & (pre.p >= o.p)].n.sum()
    last = g[g.t <= o.created]
    live = bool(len(last)) and (o.created - last.t.iloc[-1]).total_seconds() <= 3600 and abs(int(last.p.iloc[-1]) - o.p) <= 2
    close = g.close.iloc[0] if g.close.notna().any() else pd.NaT
    # close from the ticker's event date when the tape has no meta: 24:00 local of the target date approximated by 08:00Z next day
    hrs = np.nan
    cal.append(dict(tk=o.tk, p=o.p, life=o.life_min, filled=o.filled > 0, ceiling=(o.V > 0) or (o.A > 0), trail=trail, live=live, tb=int(np.digitize(trail, TB)), created=o.created))
C = pd.DataFrame(cal)
C['pred_Q0'] = [grid_p(r.p, r.tb, 2, max(r.life, 1)) for r in C.itertuples()]
out.append('\n## Calibration of the replay grid on the desk\'s weather sells (Q=0 prediction vs outcome, matched on price, trailing-6h taker-buy volume, order life)\n')
rows3 = []
for name, m in [('all', C.life > -1), ('live market at placement', C.live), ('not live', ~C.live), ('trailing 6h volume < 1', C.tb == 0), ('trailing 6h volume >= 1', C.tb > 0)]:
    x = C[m]
    rows3.append(dict(subset=name, orders=len(x), predicted_fills_Q0=x.pred_Q0.sum(), ceiling_orders_with_volume=int(x.ceiling.sum()), realised_fill_orders=int(x.filled.sum())))
out.append(md(pd.DataFrame(rows3).round(2)))
C.to_csv(f'{RES}/desk-calibration.csv', index=False)
open(f'{RES}/desk-validation.md', 'w').write('\n'.join(out) + '\n')
print('\n'.join(out))
