"""Queue-aware fill model for a resting SELL of YES at p cents (the weather lane's order).
An order placed at t0 with Q contracts ahead of it at its price level fills (at least partly) when
  cumulative taker-buy-YES volume at exactly p after t0 exceeds Q, OR any taker buys YES above p (the level was cleared).
Replayed over the public tape on a 10-minute grid per market. Queue ahead Q is a free parameter (the tape has no book);
the live collector's book snapshots tell which Q values actually occur (see queue.py).
Liveness filter: some trade within 2c of p in the previous 60 minutes (a market where the level is being tested).
Output: results/fill-grid.csv and results/fill-model.md"""
import numpy as np, pandas as pd
from common import *
import sys
MODE = sys.argv[1] if len(sys.argv) > 1 else 'weather'   # weather: resting SELL of YES at 2-6c; gas: resting BUY of YES at 94-98c
df = load_tape()
wx = df[(df.kind == MODE)].copy()
if MODE == 'weather':
    QS = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500]; PS = [2, 3, 4, 5, 6]; HB = [6, 12, 24, 36, 48]
else:
    QS = [0, 1, 5, 20, 100, 500, 1000, 2000, 5000]; PS = [94, 95, 96, 97, 98]; HB = [1, 2, 4, 8, 24]
HS = [20, 60, 240]
GRID = 600  # seconds
TB = [1, 10, 50, 200]
rows = []
for tk, g in wx.groupby('tk'):
    g = g.sort_values('t')
    ts = g.t.astype('int64').values // 10**9
    ps, ns, ss = g.p.values, g.n.values, g.s.values
    if len(ts) < 3: continue
    close = g.close.iloc[0].value // 10**9
    t0s = np.arange(ts[0] - GRID, min(ts[-1], close) + 1, GRID)
    i0 = np.searchsorted(ts, t0s, side='right')            # first trade strictly after t0
    for p in PS:
        TAKER = 'yes' if MODE == 'weather' else 'no'   # who hits our level: takers buying YES lift a resting ask; takers selling YES hit a resting bid
        yes_at = np.where((ss == TAKER) & (ps == p), ns, 0.0)
        cum = np.concatenate([[0.0], np.cumsum(yes_at)])    # cum[i] = volume at p in trades [0,i)
        above_idx = np.where((ss == TAKER) & ((ps > p) if MODE == 'weather' else (ps < p)))[0]
        # first "above" trade at index >= i0
        k = np.searchsorted(above_idx, i0)
        t_above = np.where(k < len(above_idx), ts[above_idx[np.minimum(k, len(above_idx) - 1)]], 10**12) if len(above_idx) else np.full(len(t0s), 10**12)
        # liveness: last trade before t0 within 60 min and within 2c of p
        last = i0 - 1
        ok = (last >= 0)
        lt = np.where(ok, ts[np.maximum(last, 0)], 0)
        lp = np.where(ok, ps[np.maximum(last, 0)], 999)
        live = ok & (t0s - lt <= 3600) & (np.abs(lp - p) <= 2)
        # trailing 6h taker-buy volume at >= p (arrival-rate proxy)
        j6 = np.searchsorted(ts, t0s - 6 * 3600, side='right')
        yes_ge = np.where((ss == TAKER) & ((ps >= p) if MODE == 'weather' else (ps <= p)), ns, 0.0)
        cge = np.concatenate([[0.0], np.cumsum(yes_ge)])
        trail = cge[i0] - cge[j6]
        # the OLD backtest rule: filled iff any later trade, either side, printed at or through p within 6 hours
        thru = np.where((ps >= p) if MODE == 'weather' else (ps <= p))[0]
        kk = np.searchsorted(thru, i0)
        t_old = np.where(kk < len(thru), ts[thru[np.minimum(kk, len(thru) - 1)]], 10**12) if len(thru) else np.full(len(t0s), 10**12)
        old6 = ((t_old - t0s) <= 6 * 3600)
        for Q in QS:
            target = cum[i0] + Q + 1e-6                         # need volume > Q at p
            idx = np.searchsorted(cum[1:], target, side='left') # first trade index (0-based) reaching target
            t_vol = np.where(idx < len(ts), ts[np.minimum(idx, len(ts) - 1)], 10**12)
            tf = np.minimum(t_vol, t_above)
            for H in HS:
                filled = (tf - t0s) <= H * 60
                clean = (t_vol < t_above) & ((t_vol - t0s) <= H * 60)   # filled by queue-consuming volume at p BEFORE any sweep through the level
                sel = live
                if sel.any():
                    hb = np.digitize((close - t0s[sel]) / 3600, HB)
                    tb = np.digitize(trail[sel], TB)
                    eb = (((t0s[sel] // 3600) - 4) % 24) // 4
                    rows.append(pd.DataFrame(dict(p=p, Q=Q, H=H, hb=hb, tb=tb, eb=eb, filled=filled[sel].astype(int), clean=clean[sel].astype(int), old6=old6[sel].astype(int), n=1, yes=int(g.result.iloc[0] == 'yes'))))
    if len(rows) > 300:
        rows = [pd.concat(rows).groupby(['p', 'Q', 'H', 'hb', 'tb', 'eb', 'yes'], as_index=False)[['filled', 'clean', 'old6', 'n']].sum()]
res = pd.concat(rows).groupby(['p', 'Q', 'H', 'hb', 'tb', 'eb', 'yes'], as_index=False)[['filled', 'clean', 'old6', 'n']].sum()
res.to_csv(f'{RES}/fill-grid.csv' if MODE == 'weather' else f'{RES}/fill-grid-{MODE}.csv', index=False)
print(len(res), res.n.sum())
