"""Belief-path lab core: build 1-minute grids from candle files, shifts, clustered statistics, fees.
Everything is public data; nothing here places or prices a live order."""
import json, os, datetime
import numpy as np
from bp_common import DATA, RES

def iso(s): return int(datetime.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())

def build(cls):
    """Concatenated per-market minute grids (forward-filled quotes). Returns dict of arrays.
    mid/bid valid-ness: bid>=1c, ask<=99c, ask>bid. After the last grid minute the market is settled: value X."""
    ms = {}
    for l in open(os.path.join(DATA, f"markets-{cls}.jsonl")):
        m = json.loads(l); ms[m["ticker"]] = m
    cols = {k: [] for k in ("bid", "ask", "px", "vol", "mkt", "pos", "plo", "phi")}
    meta = []
    n = 0
    for l in open(os.path.join(DATA, f"candles-{cls}.jsonl")):
        d = json.loads(l); r = d["rows"]
        if len(r) < 5: continue
        m = ms[d["ticker"]]
        ts = np.array([x[0] for x in r], dtype=np.int64)
        close = iso(m["close_time"])
        t0 = ts[0] // 60 * 60
        t1 = max(ts[-1], close)  # grid runs to the market close (quotes persist between candles)
        L = int((t1 - t0) // 60) + 1
        if L < 5: continue
        gi = ((ts - t0) // 60).astype(np.int64)
        def col(j, fill=np.nan):
            a = np.array([np.nan if x[j] is None else x[j] for x in r], dtype=np.float64)
            return a
        bid, ask, px, vol, plo, phi = col(1), col(2), col(3), col(4), col(5), col(6)
        g_bid = np.full(L, np.nan); g_ask = np.full(L, np.nan); g_px = np.full(L, np.nan); g_vol = np.zeros(L)
        g_plo = np.full(L, np.nan); g_phi = np.full(L, np.nan); g_plo[gi] = plo; g_phi[gi] = phi
        g_bid[gi] = bid; g_ask[gi] = ask; g_px[gi] = px; np.add.at(g_vol, gi, np.nan_to_num(vol))
        # forward fill quotes (state persists between candles); last-trade price ffilled too (stale marker via vol)
        for g in (g_bid, g_ask):
            idx = np.where(~np.isnan(g), np.arange(L), 0); np.maximum.accumulate(idx, out=idx); g[:] = g[idx]
        cols["bid"].append(g_bid.astype(np.float32)); cols["ask"].append(g_ask.astype(np.float32))
        cols["px"].append(g_px.astype(np.float32)); cols["vol"].append(g_vol.astype(np.float32))
        cols["plo"].append(g_plo.astype(np.float32)); cols["phi"].append(g_phi.astype(np.float32))
        cols["mkt"].append(np.full(L, len(meta), dtype=np.int32)); cols["pos"].append(np.arange(L, dtype=np.int32))
        x = 1.0 if m["result"] == "yes" else 0.0
        occ = iso(m["occurrence_datetime"] or m["open_time"])
        meta.append(dict(ticker=d["ticker"], event=m["event_ticker"], series=m["series"], fee_type=m["fee_type"], X=x, t0=int(t0), L=L, close=close, occ=occ, open=iso(m["open_time"]), volume=float(m.get("volume_fp") or 0)))
    out = {k: np.concatenate(v) for k, v in cols.items()}
    out["meta"] = meta
    return out

def finish(A, cls):
    """Derived arrays: mid, valid, X per row, hours-to-close, cluster ids, fit/test flag."""
    meta = A["meta"]; mk = A["mkt"]
    X = np.array([m["X"] for m in meta], dtype=np.float32)
    L = np.array([m["L"] for m in meta], dtype=np.int32)
    t0 = np.array([m["t0"] for m in meta], dtype=np.int64)
    close = np.array([m["close"] for m in meta], dtype=np.int64)
    occ = np.array([m["occ"] for m in meta], dtype=np.int64)
    A["X"] = X[mk]; A["Lm"] = L[mk]
    ts = t0[mk] + A["pos"].astype(np.int64) * 60
    A["ts"] = ts
    bid, ask = A["bid"], A["ask"]
    ok = (bid >= 0.0099) & (ask <= 0.9901) & (ask > bid)
    A["ok"] = ok
    A["mid"] = np.where(ok, (bid + ask) / 2, np.nan).astype(np.float32)
    A["bidv"] = np.where(bid >= 0.0099, bid, np.nan).astype(np.float32)
    A["askv"] = np.where(ask <= 0.9901, ask, np.nan).astype(np.float32)
    A["hrs_close"] = ((close[mk] - ts) / 3600).astype(np.float32)
    A["hrs_occ"] = ((ts - occ[mk]) / 3600).astype(np.float32)
    # clusters: date for weather/gas/crypto/econ, event for sports/mentions; split by date
    days = np.array([datetime.datetime.utcfromtimestamp(m["occ"] if cls.startswith("sports") else m["close"]).strftime("%Y-%m-%d") for m in meta])
    ud = sorted(set(days)); cut = ud[len(ud) // 2]
    A["test_m"] = days >= cut; A["cut"] = cut; A["days"] = days
    if cls.startswith("sports") or cls == "mentions":
        keys = [m["event"] for m in meta]
    else:
        keys = list(days)
    kid = {k: i for i, k in enumerate(sorted(set(keys)))}
    A["clu_m"] = np.array([kid[k] for k in keys], dtype=np.int32)
    A["nclu"] = len(kid)
    # event clusters (the headline) and a coarser day-cluster check (events on one day share news/weather/price shocks)
    ek = {k: i for i, k in enumerate(sorted({m["event"] for m in meta}))}
    A["ev_m"] = np.array([ek[m["event"]] for m in meta], dtype=np.int32); A["nev"] = len(ek)
    dk = {k: i for i, k in enumerate(sorted(set(days)))}
    A["day_m"] = np.array([dk[k] for k in days], dtype=np.int32); A["nday"] = len(dk)
    A["ev"] = A["ev_m"][mk]; A["day"] = A["day_m"][mk]; A["test"] = A["test_m"][mk]
    return A

def ffill_mkt(A, arr):
    """Forward-fill NaNs within each market."""
    N = len(arr); idx = np.where(~np.isnan(arr), np.arange(N), 0)
    np.maximum.accumulate(idx, out=idx)
    out = arr[idx].copy()
    out[A["mkt"][idx] != A["mkt"]] = np.nan
    return out

def shift(A, arr, h, end_value=None):
    """arr at row+h within the same market; beyond the market's end -> end_value (per row array) or NaN."""
    N = len(arr); i = np.arange(N); j = i + h
    inside = (A["pos"] + h) < A["Lm"]
    jj = np.clip(j, 0, N - 1)
    out = arr[jj].astype(np.float32)
    beyond = ~inside
    out[beyond] = (end_value[beyond] if end_value is not None else np.nan)
    return out, inside

def lag(A, arr, h):
    N = len(arr); jj = np.clip(np.arange(N) - h, 0, N - 1)
    ok = A["pos"] >= h
    out = arr[jj].astype(np.float32); out[~ok] = np.nan
    return out

def load(cls):
    return finish(build(cls), cls)

def cluster_stat(clu, nclu, num_terms, fn, B=400, seed=1):
    """Cluster bootstrap of a statistic computed from per-cluster sums.
    num_terms: list of per-row arrays; per-cluster sums are formed; fn(sums_list)->float. Returns (point, lo, hi)."""
    sums = [np.bincount(clu, weights=np.nan_to_num(t.astype(np.float64)), minlength=nclu) for t in num_terms]
    pt = fn([s.sum() for s in sums])
    rng = np.random.default_rng(seed)
    present = np.where(np.bincount(clu, minlength=nclu) > 0)[0]
    vals = []
    for _ in range(B):
        pick = rng.choice(present, len(present), replace=True)
        vals.append(fn([s[pick].sum() for s in sums]))
    vals = np.array(vals)
    return pt, np.nanpercentile(vals, 2.5), np.nanpercentile(vals, 97.5)

def fee_c(P, C=1):
    """Taker fee in cents for one order of C contracts at price P (dollars): ceil(7*C*P*(1-P)) cents."""
    return np.ceil(np.round(7.0 * C * P * (1 - P), 9))

def fee_maker_c(P, C=1, maker_fees=False):
    return np.ceil(np.round(1.75 * C * P * (1 - P), 9)) if maker_fees else np.zeros_like(P)

def fmt_ci(p, lo, hi, d=2): return f"{p:.{d}f} [{lo:.{d}f}, {hi:.{d}f}]"

def features(A, cls):
    """State features at each minute (all known at time t): returns (names, matrix float32)."""
    mid = A["mid"]; midf = ffill_mkt(A, mid)
    sports = cls.startswith("sports")
    hrs = A["hrs_occ"] if sports else A["hrs_close"]
    loghrs = np.log(np.clip(hrs, 0, None) + 0.1)
    spread = (A["ask"] - A["bid"]) * 100
    mc = mid - 0.5
    edge = np.minimum(mid, 1 - mid)
    prev1 = (midf - lag(A, midf, 1)) * 100
    prev5 = (midf - lag(A, midf, 5)) * 100
    sgn = np.sign(np.nan_to_num(A["px"] - lag(A, midf, 1), nan=0.0))
    sv = sgn * A["vol"]
    s5 = np.zeros_like(sv); v5 = np.zeros_like(sv)
    for k in range(5):
        s5 += np.nan_to_num(lag(A, sv, k)); v5 += np.nan_to_num(lag(A, A["vol"], k))
    flow = s5 / (v5 + 1.0); lvol = np.log1p(v5)
    FE = {"log_hours": loghrs, "mid_minus_half": mc, "dist_to_edge": edge, "spread_c": spread, "flow_imb_5m": flow, "log_vol_5m": lvol, "prev_move_1m_c": prev1, "prev_move_5m_c": prev5}
    names = list(FE)
    Fm = np.column_stack([FE[k] for k in names]).astype(np.float32)
    return names, Fm
