#!/usr/bin/env python3
"""Overreaction test (note section 6.4): after |d mid| >= k cents in one minute, the subsequent drift at each horizon; fade round-trip net of fees and latency.
usage: overreaction.py CLASS -> results/overreaction-CLASS.json"""
import sys, json, os
import numpy as np
from lab import *
from rt import round_trips
cls = sys.argv[1]
A = load(cls)
mid = A["mid"]; midf = ffill_mkt(A, mid)
prev = lag(A, mid, 1)
d1 = (mid - prev) * 100
spread = (A["ask"] - A["bid"]) * 100
v60 = np.zeros(len(mid), dtype=np.float32)
for k in range(1, 61, 1): pass
cs = np.cumsum(A["vol"].astype(np.float64)); v60 = (cs - np.concatenate([np.zeros(60), cs[:-60]])[:len(cs)]).astype(np.float32)
# trailing-60-minute volume must not cross markets: approximate by zeroing the first 60 rows of each market
v60[A["pos"] < 60] = np.nan
cl_ok = A["ok"] & np.isfinite(prev) & (mid >= 0.05) & (mid <= 0.95) & (prev >= 0.05) & (prev <= 0.95)
H = [1, 5, 30, 120]
out = dict(cls=cls, n_events=A["nev"], cut=A["cut"], cells={})
for k in (2, 3, 5, 10):
    trig = cl_ok & (np.abs(d1) >= k - 1e-6)
    idx = np.where(trig)[0]
    keep = []; last_m = -1; last_i = -10**9
    for i in idx:
        if A["mkt"][i] == last_m and i - last_i < 30: continue
        keep.append(i); last_m = A["mkt"][i]; last_i = i
    keep = np.array(keep, dtype=np.int64)
    if len(keep) < 30: out["cells"][f"k{k}"] = dict(n=int(len(keep))); continue
    sgn = np.sign(d1[keep])
    thin = (spread[keep] >= 4) | (np.nan_to_num(v60[keep], nan=0) < 5)
    for hname, hmask in (("all", np.ones(len(keep), bool)), ("thin", thin), ("thick", ~thin)):
        if hmask.sum() < 30: continue
        sel = keep[hmask]; sg = sgn[hmask]
        cell = dict(n=int(len(sel)), n_events=int(len(np.unique(A["ev"][sel]))), mean_move_c=float(np.mean(np.abs(d1[sel]))))
        for h in H:
            me, _ = shift(A, mid, h, end_value=A["X"]); me = me[sel]
            rev = -sg * (me - mid[sel]) * 100          # positive = reversion toward the pre-move price
            ok = np.isfinite(rev)
            c = {}
            if ok.sum() >= 30:
                pt, lo, hi = cluster_stat(A["ev"][sel][ok], A["nev"], [rev[ok], np.ones(ok.sum())], lambda s: s[0] / s[1], B=300)
                c["rev_mid_c"] = [pt, lo, hi]
                te = A["test"][sel][ok]
                for nm, mm in (("fit", ~te), ("test", te)):
                    if mm.sum() >= 20:
                        c[f"rev_mid_{nm}"] = [float(rev[ok][mm].mean()), int(mm.sum())]
            for L in (0, 1):
                rtn = round_trips(A, h, L)
                # fade: up-move -> long NO; down-move -> long YES
                net = np.where(sg > 0, rtn["net_no"][sel], rtn["net_yes"][sel]); gross = np.where(sg > 0, rtn["gross_no"][sel], rtn["gross_yes"][sel])
                ok2 = np.isfinite(net)
                if ok2.sum() >= 30:
                    pt, lo, hi = cluster_stat(A["ev"][sel][ok2], A["nev"], [net[ok2], np.ones(ok2.sum())], lambda s: s[0] / s[1], B=300)
                    g, glo, ghi = cluster_stat(A["ev"][sel][ok2], A["nev"], [gross[ok2], np.ones(ok2.sum())], lambda s: s[0] / s[1], B=300)
                    c[f"net_L{L}"] = [pt, lo, hi, int(ok2.sum())]; c[f"gross_L{L}"] = [g, glo, ghi]
                    te = A["test"][sel][ok2]
                    c[f"net_L{L}_split"] = {"fit": [float(net[ok2][~te].mean()) if (~te).sum() else None, int((~te).sum())], "test": [float(net[ok2][te].mean()) if te.sum() else None, int(te.sum())]}
            cell[f"h{h}"] = c
            # maker-in (join the fade side of the touch, strict/optimistic fill within W minutes), taker-out at j+h
            for W in (10,):
                for fm in ("strict", "opt"):
                    val = np.zeros(len(sel)); filled = np.zeros(len(sel), bool)
                    for q, i in enumerate(sel):
                        m_ = A["mkt"][i]; end = i + A["Lm"][i] - A["pos"][i]
                        up = sg[q] > 0
                        px_e = A["ask"][i] if up else A["bid"][i]
                        if not np.isfinite(px_e) or px_e <= 0.0099 or px_e >= 0.9901: continue
                        jr = np.arange(i + 1, min(i + 1 + W, end))
                        if len(jr) == 0: continue
                        if up: hit = (A["phi"][jr] > px_e + 1e-6) if fm == "strict" else (A["phi"][jr] >= px_e - 1e-6)
                        else: hit = (A["plo"][jr] < px_e - 1e-6) if fm == "strict" else (A["plo"][jr] <= px_e + 1e-6)
                        hit = np.nan_to_num(hit.astype(float)) > 0
                        if not hit.any(): continue
                        j = jr[np.argmax(hit)]
                        jo = j + h
                        if jo < end:
                            q_out = A["askv"][jo] if up else A["bidv"][jo]
                            q_out = (1.0 if up else 0.0) if not np.isfinite(q_out) else q_out
                            fx = float(fee_c(np.array([q_out]), 1)[0])
                        else:
                            q_out = A["X"][i]; fx = 0.0
                        pnl = ((px_e - q_out) if up else (q_out - px_e)) * 100 - fx
                        mf = float(fee_maker_c(np.array([px_e]), 1, maker_fees=(A["meta"][m_]["fee_type"] == "quadratic_with_maker_fees"))[0])
                        val[q] = pnl - mf; filled[q] = True
                    pt, lo, hi = cluster_stat(A["ev"][sel], A["nev"], [val, np.ones(len(sel))], lambda s: s[0] / s[1], B=300)
                    c[f"maker_{fm}_ev_per_placement"] = [pt, lo, hi]; c[f"maker_{fm}_fill_rate"] = float(filled.mean())
                    c[f"maker_{fm}_ev_given_fill"] = float(val[filled].mean()) if filled.any() else None
        out["cells"][f"k{k}_{hname}"] = cell
    print(cls, "k", k, len(keep), flush=True)
json.dump(out, open(os.path.join(RES, f"overreaction-{cls}.json"), "w"), indent=1)
