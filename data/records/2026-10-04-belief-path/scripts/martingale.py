#!/usr/bin/env python3
"""Martingale tests per class x horizon: drift, variance ratio, autocorrelation, state-feature regressions with a date holdout.
usage: martingale.py CLASS   -> results/martingale-CLASS.json (+ csv)"""
import sys, json, os
import numpy as np
from lab import *
cls = sys.argv[1]
CAP = float(sys.argv[2]) if len(sys.argv) > 2 else 5.0   # max quoted spread (cents) for the mid to count as a price; 100 = every two-sided book
SUF = "" if CAP < 100 else "-all"
A = load(cls)
H = [1, 5, 30, 120]
mid, bidv = A["mid"], A["bidv"]
midf = ffill_mkt(A, mid)
X = A["X"]
stride = (A["pos"] % 3 == 0) & (A["pos"] >= 10)
obs = stride & A["ok"] & (mid >= 0.05) & (mid <= 0.95) & ((A["ask"] - A["bid"]) * 100 <= CAP + 1e-6)
sports = cls.startswith("sports")
names, Fm = features(A, cls)
good_f = np.isfinite(Fm).all(1)
out = dict(cap=CAP, cls=cls, n_markets=len(A["meta"]), n_events=A["nev"], n_days=A["nday"], cut=A["cut"], n_obs=int(obs.sum()), rows={})

def ols_cluster(y, F, clu, ncl):
    n = len(y)
    Xm = np.column_stack([np.ones(n), F]).astype(np.float64)
    XtX = Xm.T @ Xm
    try: inv = np.linalg.inv(XtX)
    except Exception: return None
    b = inv @ (Xm.T @ y)
    e = y - Xm @ b
    S = np.zeros((ncl, Xm.shape[1]))
    for j in range(Xm.shape[1]): S[:, j] = np.bincount(clu, weights=Xm[:, j] * e, minlength=ncl)
    meat = S.T @ S
    G = (np.bincount(clu, minlength=ncl) > 0).sum()
    V = inv @ meat @ inv * (G / max(G - 1, 1))
    return b, np.sqrt(np.diag(V))

for h in H:
    ymid_end, _ = shift(A, mid, h, end_value=X)
    ymid = (ymid_end - mid) * 100
    ybid_end, _ = shift(A, bidv, h, end_value=X)
    ybid = (ybid_end - bidv) * 100
    d1, _ = shift(A, midf, 1, end_value=X); d1 = (d1 - midf) * 100  # forward 1m move (for VR denominator)
    dback = (lag(A, midf, h)); dh_back = (midf - dback) * 100  # trailing h move (for autocorr of consecutive h-moves)
    for tgt, y in (("mid", ymid), ("bid", ybid)):
        m = obs & np.isfinite(y) & good_f
        key = f"{tgt}_{h}"
        r = {}
        for clname, clu, ncl in (("event", A["ev"], A["nev"]), ("day", A["day"], A["nday"])):
            c = clu[m]
            pt, lo, hi = cluster_stat(c, ncl, [y[m], np.ones(m.sum())], lambda s: s[0] / s[1], B=300)
            r[f"mean_{clname}"] = [pt, lo, hi]
            if tgt == "mid":
                mm = m & np.isfinite(d1)
                pt, lo, hi = cluster_stat(clu[mm], ncl, [y[mm] ** 2, h * d1[mm] ** 2], lambda s: s[0] / s[1], B=300)
                r[f"vr_{clname}"] = [pt, lo, hi]
                mm = m & np.isfinite(dh_back)
                pt, lo, hi = cluster_stat(clu[mm], ncl, [y[mm] * dh_back[mm], y[mm] ** 2], lambda s: s[0] / s[1], B=300)
                r[f"ac_{clname}"] = [pt, lo, hi]
        r["sd_c"] = float(np.nanstd(y[m])); r["n"] = int(m.sum())
        r["frac_zero"] = float((y[m] == 0).mean())
        # regression
        tr = m & ~A["test"]; te = m & A["test"]
        if tr.sum() > 500 and te.sum() > 500:
            mu = Fm[tr].mean(0); sd = Fm[tr].std(0) + 1e-9
            Z = (Fm - mu) / sd
            fit = ols_cluster(y[tr].astype(np.float64), Z[tr], A["ev"][tr], A["nev"])
            fit_te = ols_cluster(y[te].astype(np.float64), Z[te], A["ev"][te], A["nev"])
            if fit and fit_te:
                b, se = fit; bt, set_ = fit_te
                pred = b[0] * 0 + Z[te] @ b[1:] + b[0]  # includes intercept (unconditional drift in train)
                pred_f = Z[te] @ b[1:]
                yt = y[te].astype(np.float64)
                sse0 = (yt ** 2)
                # OOS gain over the martingale (zero) forecast, per-row loss difference, event-clustered
                gain = sse0 - (yt - pred) ** 2
                pt, lo, hi = cluster_stat(A["ev"][te], A["nev"], [gain, yt ** 2], lambda s: s[0] / s[1], B=300)
                r["oos_r2"] = [pt, lo, hi]
                r["coef"] = {names[i]: dict(b_train=float(b[i + 1]), t_train=float(b[i + 1] / se[i + 1]), b_test=float(bt[i + 1]), t_test=float(bt[i + 1] / set_[i + 1])) for i in range(len(names))}
                r["intercept_train"] = [float(b[0]), float(b[0] / se[0])]; r["intercept_test"] = [float(bt[0]), float(bt[0] / set_[0])]
                r["n_train"] = int(tr.sum()); r["n_test"] = int(te.sum())
        out["rows"][key] = r
    print(cls, "h", h, flush=True)

# to-resolution: calibration drift E[X - mid] at fixed times before close, by price bucket (settlement game bias)
res = {}
hc = A["hrs_occ"] if sports else A["hrs_close"]   # sports close_time is only known once the winner is declared (look-ahead): use hours since start
TB = ((-12, 0), (0, 1), (1, 3), (3, 8)) if sports else ((0, 1), (1, 3), (3, 12), (12, 36))
out["time_axis"] = "hours since start" if sports else "hours to close"
for tl, tu in TB:
    for lo_p, hi_p in ((0.05, 0.2), (0.2, 0.5), (0.5, 0.8), (0.8, 0.95)):
        m = A["ok"] & (hc >= tl) & (hc < tu) & (mid >= lo_p) & (mid < hi_p) & (A["pos"] % 10 == 0)
        if m.sum() < 200: continue
        y = (X - mid) * 100
        pt, lo, hi = cluster_stat(A["ev"][m], A["nev"], [y[m], np.ones(m.sum())], lambda s: s[0] / s[1], B=300)
        res[f"{tl}-{tu}h_mid{lo_p}-{hi_p}"] = [pt, lo, hi, int(m.sum())]
out["to_resolution"] = res
# executable settlement value: buy YES at the ask / NO at the bid-implied price and hold to settlement, taker fee at entry, per contract (C=1 and C=10)
rx = {}
tr_ = A["test"]
for tl, tu in TB:
    for lo_p, hi_p in ((0.02, 0.1), (0.1, 0.3), (0.3, 0.7), (0.7, 0.9), (0.9, 0.99)):
        base_m = (hc >= tl) & (hc < tu) & (A["pos"] % 10 == 0)
        for side in ("yes", "no"):
            if side == "yes":
                p = A["askv"]; m = base_m & np.isfinite(p) & (p >= lo_p) & (p < hi_p) & (A["bidv"] > 0.0099)   # a bid must exist (two-sided book)
                v1 = (X - p) * 100 - fee_c(p, 1); v10 = (X - p) * 100 - fee_c(p, 10) / 10
            else:
                q = A["bidv"]; p = 1 - q; m = base_m & np.isfinite(q) & (p >= lo_p) & (p < hi_p) & (A["askv"] < 0.9901)
                v1 = ((1 - X) - p) * 100 - fee_c(p, 1); v10 = ((1 - X) - p) * 100 - fee_c(p, 10) / 10
            if m.sum() < 200: continue
            r1 = cluster_stat(A["ev"][m], A["nev"], [v1[m], np.ones(m.sum())], lambda s: s[0] / s[1], B=200)
            r10 = cluster_stat(A["ev"][m], A["nev"], [v10[m], np.ones(m.sum())], lambda s: s[0] / s[1], B=200)
            rf = float(v1[m & ~tr_].mean()) if (m & ~tr_).sum() else None; rt_ = float(v1[m & tr_].mean()) if (m & tr_).sum() else None
            rx[f"{tl}-{tu}h_{side}_{lo_p}-{hi_p}"] = dict(C1=list(r1), C10=list(r10), n=int(m.sum()), n_events=int(len(np.unique(A["ev"][m]))), fit=rf, test=rt_)
out["to_resolution_exec"] = rx
os.makedirs(RES, exist_ok=True)
json.dump(out, open(os.path.join(RES, f"martingale-{cls}{SUF}.json"), "w"), indent=1)
print(cls, "done", flush=True)
