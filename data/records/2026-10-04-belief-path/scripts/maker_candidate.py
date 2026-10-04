#!/usr/bin/env python3
"""Follow-up on the one overreaction cell whose maker-in lower bound was positive: join the fade side of the touch after a >= k-cent one-minute jump
in a thin market, strict fill (a trade prints through our price) within W minutes, exit by crossing the spread h minutes after the fill.
Splits: date halves, exit before the market's end (a real bid) vs at settlement, day clusters, and shifted-time placebo.
usage: maker_candidate.py CLASS K H -> results/maker-CLASS-kK-hH.json"""
import sys, json, os
import numpy as np
from lab import *
cls, K, H = sys.argv[1], float(sys.argv[2]), int(sys.argv[3]); W = 10
A = load(cls)
mid = A["mid"]; prev = lag(A, mid, 1); d1 = (mid - prev) * 100
spread = (A["ask"] - A["bid"]) * 100
cs = np.cumsum(A["vol"].astype(np.float64)); v60 = (cs - np.concatenate([np.zeros(60), cs[:-60]])[:len(cs)]); v60[A["pos"] < 60] = np.nan
trig = A["ok"] & np.isfinite(prev) & (mid >= 0.05) & (mid <= 0.95) & (prev >= 0.05) & (prev <= 0.95) & (np.abs(d1) >= K - 1e-6) & ((spread >= 4) | (np.nan_to_num(v60, nan=0) < 5))
keep = []; lm = -1; li = -10**9
for i in np.where(trig)[0]:
    if A["mkt"][i] == lm and i - li < 30: continue
    keep.append(i); lm = A["mkt"][i]; li = i
keep = np.array(keep)
def run(idx, signs, shift_min=0):
    n = len(idx); val = np.zeros(n); filled = np.zeros(n, bool); inside_exit = np.zeros(n, bool); gross = np.zeros(n)
    for q, i in enumerate(idx):
        end = i + A["Lm"][i] - A["pos"][i]; up = signs[q] > 0
        px_e = A["ask"][i] if up else A["bid"][i]
        if not np.isfinite(px_e) or px_e <= 0.0099 or px_e >= 0.9901: continue
        jr = np.arange(i + 1 + shift_min, min(i + 1 + shift_min + W, end))
        if len(jr) == 0: continue
        hit = (A["phi"][jr] > px_e + 1e-6) if up else (A["plo"][jr] < px_e - 1e-6)
        hit = np.nan_to_num(hit.astype(float)) > 0
        if not hit.any(): continue
        j = jr[np.argmax(hit)]; jo = j + H
        if jo < end:
            qo = A["askv"][jo] if up else A["bidv"][jo]; qo = (1.0 if up else 0.0) if not np.isfinite(qo) else qo
            fx = float(fee_c(np.array([qo]), 1)[0]); inside_exit[q] = True
        else: qo = A["X"][i]; fx = 0.0
        g = ((px_e - qo) if up else (qo - px_e)) * 100
        mf = float(fee_maker_c(np.array([px_e]), 1, maker_fees=(A["meta"][A["mkt"][i]]["fee_type"] == "quadratic_with_maker_fees"))[0])
        val[q] = g - fx - mf; gross[q] = g; filled[q] = True
    return val, filled, inside_exit
sg = np.sign(d1[keep]); val, fill, ins = run(keep, sg)
out = dict(cls=cls, k=K, h=H, n_trig=int(len(keep)), n_events=int(len(np.unique(A["ev"][keep]))), n_days=int(len(np.unique(A["day"][keep]))), fill_rate=float(fill.mean()))
def cs_(mask, clu, ncl):
    return list(cluster_stat(clu[keep][mask], ncl, [val[mask], np.ones(mask.sum())], lambda s: s[0] / s[1], B=400))
al = np.ones(len(keep), bool); te = A["test"][keep]
out["all_event"] = cs_(al, A["ev"], A["nev"]); out["all_day"] = cs_(al, A["day"], A["nday"])
out["fit_half"] = cs_(~te, A["ev"], A["nev"]) + [int((~te).sum())]; out["test_half"] = cs_(te, A["ev"], A["nev"]) + [int(te.sum())]
for nm, m in (("exit_at_bid", ~fill | ins), ("exit_at_settlement", ~fill | ~ins)):
    # per-placement EV counting only fills of this kind (other kind scored 0), so the two add up to the total
    vv = np.where(m & fill, val, 0.0)
    out[nm] = dict(n_fills=int((m & fill).sum()), ev_per_placement=list(cluster_stat(A["ev"][keep], A["nev"], [vv, np.ones(len(keep))], lambda s: s[0] / s[1], B=400)), ev_given_fill=float(val[m & fill].mean()) if (m & fill).any() else None)
# placebo: same placements, fill window shifted 60 minutes later (no information link to the jump)
pv, pf, _ = run(keep, sg, shift_min=60)
out["placebo_shift60"] = list(cluster_stat(A["ev"][keep], A["nev"], [pv, np.ones(len(keep))], lambda s: s[0] / s[1], B=400)); out["placebo_fill_rate"] = float(pf.mean())
# random-direction placebo: reverse the fade side (momentum maker)
mv, mf_, _ = run(keep, -sg)
out["momentum_side"] = list(cluster_stat(A["ev"][keep], A["nev"], [mv, np.ones(len(keep))], lambda s: s[0] / s[1], B=400)); out["momentum_fill_rate"] = float(mf_.mean())
json.dump(out, open(os.path.join(RES, f"maker-{cls}-k{int(K)}-h{H}.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
