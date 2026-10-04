#!/usr/bin/env python3
"""Reuse of the microstructure collector's 5-minute order books (weather + gas candidates, no outcomes needed for path tests):
does book depth imbalance / micro-price / queue asymmetry predict the next 5/10/15-minute change in mid and bid?
usage: books5m.py -> results/books5m.json   (sample is small: the number of sweeps is printed)"""
import json, os, glob, datetime
import numpy as np
from bp_common import DATA, RES
src = os.path.join(DATA, "..", "..", "2026-10-04-kalshi-microstructure", "data")
snaps = {}
for f in sorted(glob.glob(os.path.join(src, "books-*.ndjson"))):
    for l in open(f):
        try: d = json.loads(l)
        except Exception: continue
        t = datetime.datetime.fromisoformat(d["t"].replace("Z", "+00:00")).timestamp()
        snaps.setdefault(d["tk"], []).append((t, d["bids"], d["asks"]))
def feat(bids, asks):
    if not bids or not asks: return None
    bb, ba = max(b[0] for b in bids), min(a[0] for a in asks)
    if ba <= bb: return None
    qb = sum(q for p, q in bids if p >= bb - 2); qa = sum(q for p, q in asks if p <= ba + 2)
    q1b = [q for p, q in bids if p == bb][0]; q1a = [q for p, q in asks if p == ba][0]
    mid = (bb + ba) / 2
    micro = (ba * q1b + bb * q1a) / (q1b + q1a)
    return dict(bid=bb, ask=ba, mid=mid, spread=ba - bb, imb3=(qb - qa) / (qb + qa), micro=micro - mid, imb1=(q1b - q1a) / (q1b + q1a), lq=np.log1p(q1b + q1a))
rows = []
for tk, s in snaps.items():
    s.sort(key=lambda x: x[0]); F = [feat(b, a) for _, b, a in s]
    for h in (1, 2, 3):                       # 5, 10, 15 minutes (snapshots are ~5 min apart)
        for i in range(len(s) - h):
            if F[i] is None or F[i + h] is None: continue
            dt = (s[i + h][0] - s[i][0]) / 60
            if not (h * 5 - 2 <= dt <= h * 5 + 2): continue
            f = F[i]
            if not (5 <= f["mid"] <= 95): continue
            rows.append(dict(tk=tk, ev=tk.rsplit("-", 1)[0], h=h * 5, dmid=F[i + h]["mid"] - f["mid"], dbid=F[i + h]["bid"] - f["bid"], **{k: f[k] for k in ("spread", "imb3", "micro", "imb1", "lq")}, mid=f["mid"]))
out = dict(n_snapshots=sum(len(v) for v in snaps.values()), n_tickers=len(snaps), n_times=len({x[0] // 60 for v in snaps.values() for x in v}), results={})
evs = sorted({r["ev"] for r in rows}); eid = {e: i for i, e in enumerate(evs)}
for h in (5, 10, 15):
    R = [r for r in rows if r["h"] == h]
    if len(R) < 200: continue
    clu = np.array([eid[r["ev"]] for r in R])
    names = ["imb3", "micro", "imb1", "spread", "lq"]
    Fm = np.array([[r[k] for k in names] for r in R]); Fm = (Fm - Fm.mean(0)) / (Fm.std(0) + 1e-9)
    for tgt in ("dmid", "dbid"):
        y = np.array([r[tgt] for r in R]); n = len(y)
        Xm = np.column_stack([np.ones(n), Fm]); inv = np.linalg.inv(Xm.T @ Xm); b = inv @ Xm.T @ y; e = y - Xm @ b
        S = np.zeros((len(evs), Xm.shape[1]))
        for j in range(Xm.shape[1]): S[:, j] = np.bincount(clu, weights=Xm[:, j] * e, minlength=len(evs))
        V = inv @ (S.T @ S) @ inv; se = np.sqrt(np.diag(V))
        out["results"][f"{tgt}_{h}m"] = dict(n=n, n_events=int(len(set(clu))), mean_c=float(y.mean()), sd_c=float(y.std()), coef={k: [float(b[i + 1]), float(b[i + 1] / se[i + 1])] for i, k in enumerate(names)})
json.dump(out, open(os.path.join(RES, "books5m.json"), "w"), indent=1)
print(json.dumps(out, indent=1)[:3500])
