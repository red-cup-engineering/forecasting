"""Shared helpers for the Kalshi sports edge backtests (stdlib only)."""
import json, math, datetime, collections
FEE_MULT = {"KXMLBGAME": 0.5}
def fee_per_contract(p, series, n=100):
    """Taker fee per contract: ceil_to_cent(0.07*mult*n*P*(1-P)) / n."""
    m = FEE_MULT.get(series, 1.0)
    return math.ceil(round(0.07 * m * n * p * (1 - p) * 100, 6)) / 100 / n
def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 1.0)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0, c - h), min(1, c + h))
def mean_ci(xs, z=1.96):
    n = len(xs)
    if n < 2: return (float(xs[0]) if xs else 0.0, float("-inf"), float("inf"))
    m = sum(xs) / n; v = sum((x - m) ** 2 for x in xs) / (n - 1); se = math.sqrt(v / n)
    return (m, m - z * se, m + z * se)
def ts(s): return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
def load_markets(path):
    M = {}
    for l in open(path):
        r = json.loads(l); M[r["ticker"]] = r
    return M
def load_candles(path):
    """yield (ticker, rows) rows=[ts,bid,ask,price,vol]; merge duplicate chunks."""
    C = {}
    for l in open(path):
        r = json.loads(l); C.setdefault(r["ticker"], {}).update({x[0]: x for x in r["rows"]})
    for t, d in C.items():
        yield t, [d[k] for k in sorted(d)]
def sport(series):
    return {"KXNFLGAME":"NFL","KXNCAAFGAME":"NCAAF","KXMLBGAME":"MLB","KXWNBAGAME":"WNBA","KXNHLGAME":"NHL","KXNBAGAME":"NBA",
            "KXATPMATCH":"ATP","KXWTAMATCH":"WTA"}.get(series, "soccer")
def report(name, rows):
    """rows: list of dict(event, date, p, win, fee, pnl). Aggregates by distinct event (one entry each)."""
    n = len(rows); k = sum(r["win"] for r in rows)
    lo, hi = wilson(k, n)
    m, a, b = mean_ci([r["pnl"] for r in rows])
    ap = sum(r["p"] for r in rows) / n if n else 0
    return "%-26s n=%4d win=%.3f [%.3f,%.3f] avgP=%.3f EV/ct=%+.4f CI[%+.4f,%+.4f]" % (name, n, k / n if n else 0, lo, hi, ap, m, a, b)

def ml_prob(ml):
    ml = float(ml)
    return 100 / (ml + 100) if ml > 0 else -ml / (-ml + 100)
def devig(h, a, d=None):
    ps = [ml_prob(h), ml_prob(a)] + ([ml_prob(d)] if d is not None else [])
    s = sum(ps); return [p / s for p in ps]
def series_index(rows):
    """rows sorted; return dict end_ts -> row and sorted ts list"""
    return {r[0]: r for r in rows}, [r[0] for r in rows]
def row_at(rows, t, after=True):
    """first candle with end_ts >= t (after=True) else last candle with end_ts <= t"""
    import bisect
    tsl = [r[0] for r in rows]
    if after:
        i = bisect.bisect_left(tsl, t); return rows[i] if i < len(rows) else None
    i = bisect.bisect_right(tsl, t) - 1; return rows[i] if i >= 0 else None
