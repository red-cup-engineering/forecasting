"""Queue-aware fill rule (same as microstructure/queue_aware_fill.py), vectorised per market tape.
A resting SELL of YES at p placed at t0 with q0 ahead fills at the first taker-buy-YES that goes above p (sweep) or when cumulative taker-buy-YES at exactly p exceeds q0 (clean).
A resting BUY of YES at p fills on a taker-sell-YES below p (sweep) or cumulative at p over q0 (clean).
taker side 's': 'yes' = taker bought YES (hit the ask), 'no' = taker bought NO (sold YES, hit the bid)."""
import numpy as np, pandas as pd
Q0_SELL_TOUCH = {1: 150, 2: 103, 3: 70, 4: 34, 5: 50, 6: 12}   # median contracts ahead when joining the touch ask (2026-10-04 microstructure books)
def load_tape(path):
    t = pd.read_json(path, lines=True)
    t = t[t.s != 'none'].copy(); t['t'] = pd.to_datetime(t.t, utc=True, format='ISO8601')
    return {k: g.sort_values('t').reset_index(drop=True) for k, g in t.groupby('tk')}
def first_fill(tp, side, p, t0, horizon_h, q0):
    """tp: tape frame of one market. Returns (time, channel, taker_volume_at_or_through_before_fill) or (None, None)."""
    if tp is None or tp.empty: return None, None
    w = tp[(tp.t > t0) & (tp.t <= t0 + pd.Timedelta(hours=horizon_h))]
    taker = 'yes' if side == 'sell' else 'no'
    w = w[w.s == taker]
    if w.empty: return None, None
    through = (w.p > p) if side == 'sell' else (w.p < p)
    if through.any(): ts_sweep = w.t[through].iloc[0]
    else: ts_sweep = None
    at = w[w.p == p]
    ts_clean = None
    if not at.empty:
        cum = at.n.cumsum()
        hit = cum > q0 + 1e-6
        if hit.any(): ts_clean = at.t[hit].iloc[0]
    if ts_sweep is not None and (ts_clean is None or ts_sweep <= ts_clean): return ts_sweep, 'sweep'
    if ts_clean is not None: return ts_clean, 'clean'
    return None, None
def flow(tp, taker, ge_p=None, le_p=None, t0=None, horizon_h=4.0):
    """Contracts of public taker flow in the horizon after t0: by taker side ('yes' bought YES, 'no' sold YES), at yes-price >= ge_p or <= le_p."""
    if tp is None or tp.empty: return 0.0
    w = tp[(tp.t > t0) & (tp.t <= t0 + pd.Timedelta(hours=horizon_h)) & (tp.s == taker)]
    if ge_p is not None: w = w[w.p >= ge_p]
    if le_p is not None: w = w[w.p <= le_p]
    return float(w.n.sum())
