"""Cheapest credible daily-rain model: logistic regression of the settled yes/no on NBS P06 features; out-of-sample vs Kalshi's mid.
Fit on dates < SPLIT, test on >= SPLIT. Writes results/rain-model.md and data/rain-scored.csv."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from scipy.optimize import minimize
SPLIT = '2026-09-02'
df = pd.read_csv(f'{D}/rain-dataset.csv')
df = df[(df.ask > df.bid)].copy()
df['mid'] = (df.bid + df.ask) / 2
eps = 1e-3
lg = lambda p: np.log(np.clip(p, eps, 1 - eps) / (1 - np.clip(p, eps, 1 - eps)))
def X(d, kind):
    cols = [np.ones(len(d)), lg(d.pany.values)]
    if kind == 'pany+q': cols += [d.qsum.values, lg(d.pmax.values)]
    return np.column_stack(cols)
def fit(x, y, l2=1e-3):
    f = lambda w: -(y * (x @ w) - np.log1p(np.exp(x @ w))).sum() + l2 * (w[1:] ** 2).sum()
    return minimize(f, np.zeros(x.shape[1]), method='BFGS').x
sig = lambda z: 1 / (1 + np.exp(-z))
brier = lambda p, y: float(np.mean((p - y) ** 2))
rowsout0 = 0
out = ['# Daily rain (KXRAIN) model: NBS P06 vs Kalshi mid', '', f'Fit dates < {SPLIT}, test >= {SPLIT}. Rows are (market, decision time); mid = (bid+ask)/2 from the last hourly candle.', '']
rowsout = []
out.append('Two-fold cross-fit by date (fit on one side of the split, predict the other), so every row is out-of-sample.')
for dec in ['D-1 15h', 'D-1 21h', 'D 07h']:
    d = df[df.dec == dec].copy()
    for kind in ('pany', 'pany+q'):
        d['pm_' + kind] = np.nan
        for fitmask in (d.date < SPLIT, d.date >= SPLIT):
            a = d[fitmask]; w = fit(X(a, kind), a.y.values.astype(float))
            d.loc[~fitmask, 'pm_' + kind] = sig(X(d[~fitmask], kind) @ w)
            out.append(f'{dec} {kind}: fit on {"early" if fitmask.equals(d.date < SPLIT) else "late"} half w={np.round(w,3).tolist()} n={len(a)}')
    b = d; rowsout.append(b)
    pool = sig(0.5 * lg(b['pm_pany']) + 0.5 * lg(b.mid))
    out += [f'  OOF Brier (n={len(b)}): climatology {brier(b.y.mean(), b.y):.4f} | raw pany {brier(b.pany, b.y):.4f} | model(pany) {brier(b.pm_pany, b.y):.4f} | model(pany+q) {brier(b["pm_pany+q"], b.y):.4f} | Kalshi mid {brier(b.mid, b.y):.4f} | 50/50 pool {brier(pool, b.y):.4f}', '']
te = pd.concat(rowsout); te.to_csv(f'{D}/rain-scored.csv', index=False)
# calibration table of model(pany) on test
te['bin'] = pd.cut(te.pm_pany, [0, .02, .05, .1, .2, .4, .6, .8, .9, .95, .98, 1])
cal = te.groupby('bin', observed=True).agg(n=('y', 'size'), model=('pm_pany', 'mean'), mid=('mid', 'mean'), yes=('y', 'mean')).round(3)
out += ['## Calibration on test (model p bins; all decision times)', '', md(cal), '']
te['mbin'] = pd.cut(te.mid, [0, .02, .05, .1, .2, .4, .6, .8, .9, .95, .98, 1])
cal2 = te.groupby('mbin', observed=True).agg(n=('y', 'size'), model=('pm_pany', 'mean'), mid=('mid', 'mean'), yes=('y', 'mean')).round(3)
out += ['## Calibration of the market mid on test', '', md(cal2)]
open(f'{R}/rain-model.md', 'w').write('\n'.join(out)); print('\n'.join(out))
