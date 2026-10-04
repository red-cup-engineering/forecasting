#!/usr/bin/env python3
"""Longshot decay curve: certified-tail (ask 2-5c, bid >= 1c) cohorts entered at fixed times before close (or since start, for sports) and followed to settlement.
Reports: settlement rate vs entry ask, mean ask/bid path, and the short-the-tail (long NO) P&L held to settlement vs sold early, fees on each order.
usage: longshot.py CLASS -> results/longshot-CLASS.json"""
import sys, json, os
import numpy as np
from lab import *
cls = sys.argv[1]
A = load(cls)
sports = cls.startswith("sports")
T = A["hrs_occ"] if sports else A["hrs_close"]
meta = A["meta"]; mk = A["mkt"]
starts = np.r_[0, np.where(np.diff(mk) != 0)[0] + 1]; ends = np.r_[starts[1:], len(mk)]
ENTRY = [0.0, 1.0, 2.0] if sports else [24.0, 12.0, 6.0, 3.0, 1.0]
PATH = [15, 30, 60, 120, 240]
out = dict(cls=cls, axis="hours since start" if sports else "hours to close", cohorts={})
for t0 in ENTRY:
    idx = []
    for s, e in zip(starts, ends):
        tt = T[s:e]
        j = np.where(tt >= t0)[0] if sports else np.where(tt <= t0)[0]
        if len(j) == 0: continue
        j = s + j[0]
        if abs(T[j] - t0) > 0.5: continue
        a, b = A["askv"][j], A["bidv"][j]
        if np.isfinite(a) and np.isfinite(b) and 0.0199 <= a <= 0.0501 and b >= 0.0099 and b < a:
            idx.append(j)
    idx = np.array(idx, dtype=np.int64)
    if len(idx) < 15: out["cohorts"][f"t{t0}"] = dict(n=int(len(idx))); continue
    X = A["X"][idx]; a0 = A["askv"][idx]; b0 = A["bidv"][idx]
    c = dict(n=int(len(idx)), n_events=int(len(np.unique(A["ev"][idx]))), entry_ask_c=float(a0.mean() * 100), entry_bid_c=float(b0.mean() * 100))
    # settlement rate: Wilson 95% interval with the number of independent events as the effective sample (a bootstrap is degenerate when no tail ever hit)
    ne = max(1, c["n_events"]); ph = float(X.mean())
    z = 1.96; den = 1 + z * z / ne; ctr = (ph + z * z / (2 * ne)) / den; hw = z * np.sqrt(ph * (1 - ph) / ne + z * z / (4 * ne * ne)) / den
    p_lo, p_hi = max(0.0, ctr - hw), min(1.0, ctr + hw)
    c["yes_rate_pct"] = [ph * 100, p_lo * 100, p_hi * 100]
    c["implied_mid_pct"] = float(((a0 + b0) / 2).mean() * 100)
    # long-NO held to settlement (short the tail), per contract, taker entry fee only; C=1 and C=10 order sizes
    for C in (1, 10):
        net = (b0 - X) * 100 - fee_c(1 - b0, C) / C
        base = ((b0 - 0) * 100 - fee_c(1 - b0, C) / C).mean()   # certain part: bid received minus entry fee; the loss is 100c per YES
        c[f"hold_net_C{C}"] = [float(net.mean()), float(base - 100 * p_hi), float(base - 100 * p_lo)]
    gross = (b0 - X) * 100
    c["resting_at_ask_gross_c"] = [float(((a0 - X) * 100).mean()), float(a0.mean() * 100 - 100 * p_hi), float(a0.mean() * 100 - 100 * p_lo)]  # if a resting sell at the entry ask fills (maker fee 0), ignores fill/adverse selection
    c["hold_gross"] = list(cluster_stat(A["ev"][idx], A["nev"], [gross, np.ones(len(idx))], lambda s: s[0] / s[1], B=300))
    # path
    path = {}
    for h in PATH:
        inside = (A["pos"][idx] + h) < A["Lm"][idx]
        ah = np.where(inside, np.nan_to_num(A["askv"][np.clip(idx + h, 0, len(mk) - 1)], nan=1.0), X)
        bh = np.where(inside, np.nan_to_num(A["bidv"][np.clip(idx + h, 0, len(mk) - 1)], nan=0.0), X)
        p = dict(frac_settled=float((~inside).mean()), ask_c=float(ah.mean() * 100), bid_c=float(bh.mean() * 100), mid_c=float(((ah + bh) / 2).mean() * 100), mid_decay_c=float((((ah + bh) / 2) - ((a0 + b0) / 2)).mean() * 100))
        # sell the tail now, buy it back later (round trip): NO bought at 1-b0, sold at 1-ah (or collected X at settlement)
        fx = np.where(inside, fee_c(1 - ah, 1), 0.0)
        net = (b0 - ah) * 100 - fee_c(1 - b0, 1) - fx
        p["roundtrip_net_c"] = list(cluster_stat(A["ev"][idx], A["nev"], [net, np.ones(len(idx))], lambda s: s[0] / s[1], B=300))
        p["roundtrip_gross_c"] = list(cluster_stat(A["ev"][idx], A["nev"], [(b0 - ah) * 100, np.ones(len(idx))], lambda s: s[0] / s[1], B=300))
        p["ask_decay_c"] = list(cluster_stat(A["ev"][idx], A["nev"], [(ah - a0) * 100, np.ones(len(idx))], lambda s: s[0] / s[1], B=300))
        path[f"+{h}m"] = p
    c["path"] = path
    # split halves of hold_net
    te = A["test"][idx]
    net1 = (b0 - X) * 100 - fee_c(1 - b0, 1)
    c["hold_net_C1_split"] = dict(fit=[float(net1[~te].mean()) if (~te).any() else None, int((~te).sum())], test=[float(net1[te].mean()) if te.any() else None, int(te.sum())])
    out["cohorts"][f"t{t0}"] = c
    print(cls, t0, len(idx), flush=True)
json.dump(out, open(os.path.join(RES, f"longshot-{cls}.json"), "w"), indent=1)
