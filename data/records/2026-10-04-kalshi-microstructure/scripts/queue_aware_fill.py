"""The corrected backtest fill rule (queue-aware), for re-scoring any resting-order backtest against the public tape.

Old rule (2026-10-03 backtest): a resting sell at p is filled if ANY later trade printed at or through p within 6 hours.
That ignores (a) who the taker was, (b) how many contracts were queued ahead of us at p.

Queue-aware rule: a resting SELL of YES at p (taker = buyer of YES) placed at t0 with Q0 contracts ahead is filled at the first
time either (1) a taker buys YES above p (the level was cleared), or (2) cumulative taker-buy-YES volume at exactly p since t0
exceeds Q0 + 1e-6 (the order's own turn). A resting BUY of YES at p mirrors this with taker-sell-YES (taker side 'no') at or below p.
`clean` fills (case 2 before case 1) are the ones the queue controls; `sweep` fills are the market moving through the level.

Default Q0 by price when no book is available = median touch depth measured from the collector's snapshots (results/queue.md).
"""
import pandas as pd

Q0_WEATHER_SELL_JOIN_TOUCH = {2: 103, 3: 70, 4: 34, 5: 50, 6: 12}   # contracts ahead when joining the touch (median, 2026-10-04 sweeps)
Q0_WEATHER_SELL_IMPROVE = {p: 0 for p in range(2, 7)}              # one cent inside the spread: nobody is ahead
Q0_GAS_BID_LIP_TOUCH = {94: 1000, 95: 5, 96: 1100, 97: 1000, 98: 1500}   # under an active LIP window (bimodal: farmers' ~1000+ or a near-empty level)


def first_fill(tape: pd.DataFrame, side: str, p: int, t0: pd.Timestamp, horizon_min: float, q0: float):
    """tape: columns t (tz-aware), p (cents), n, s ('yes'|'no' taker side), sorted by t. Returns (fill_time, channel) or (None, None)."""
    w = tape[(tape.t > t0) & (tape.t <= t0 + pd.Timedelta(minutes=horizon_min))]
    taker = 'yes' if side == 'sell' else 'no'
    w = w[w.s == taker]
    cum = 0.0
    for r in w.itertuples():
        through = r.p > p if side == 'sell' else r.p < p
        if through:
            return r.t, 'sweep'
        if r.p == p:
            cum += r.n
            if cum > q0 + 1e-6:
                return r.t, 'clean'
    return None, None


def fill_probability(tapes: dict, orders: pd.DataFrame, horizon_min: float, q0) -> float:
    """orders: tk, side, p, t0. q0: number or callable(row)->number. Returns the share filled under the queue-aware rule."""
    hits = 0
    for o in orders.itertuples():
        q = q0(o) if callable(q0) else q0
        t, _ = first_fill(tapes[o.tk], o.side, o.p, o.t0, horizon_min, q)
        hits += t is not None
    return hits / max(len(orders), 1)
