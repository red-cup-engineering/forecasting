#!/usr/bin/env python3
"""Round-trip scan: for each class x horizon, taker-in/taker-out net EV (fees both legs, 1-minute latency) in state-feature quintile bins, both sides,
fit on the first half of dates, confirmed on the second. A cell survives only if its confirm-half 95% event-clustered lower bound is > 0 AND fit-half mean > 0.
usage: rtscan.py CLASS -> results/rtscan-CLASS.json"""
import sys, json, os
import numpy as np
from lab import *
from rt import round_trips
cls = sys.argv[1]
A = load(cls)
names, Fm = features(A, cls)
mid = A["mid"]
stride = (A["pos"] % 3 == 0) & (A["pos"] >= 10)
base = stride & A["ok"] & (mid >= 0.05) & (mid <= 0.95) & np.isfinite(Fm).all(1)
spread = (A["ask"] - A["bid"]) * 100
out = dict(cls=cls, cells=[], n_cells=0, n_survive=0, n_pos_fit=0, unconditional={})
for h in (5, 30, 120):
    rtn = round_trips(A, h, 1)
    for side in ("yes", "no"):
        net = rtn["net_" + side]
        ok = base & np.isfinite(net)
        for sub, sm in (("all", ok), ("tight", ok & (spread <= 2.01))):
            tr = sm & ~A["test"]; te = sm & A["test"]
            if tr.sum() < 1000 or te.sum() < 1000: continue
            for fi, fn in enumerate(names + ["none"]):
                if fn == "none":
                    bins = [(f"all", sm)]
                else:
                    qs = np.quantile(Fm[tr, fi], [0.2, 0.4, 0.6, 0.8])
                    b = np.digitize(Fm[:, fi], qs)
                    bins = [(f"q{k + 1}", sm & (b == k)) for k in range(5)]
                for bn, bm in bins:
                    r = {}
                    for nm, mm in (("fit", bm & ~A["test"]), ("test", bm & A["test"])):
                        if mm.sum() < 300: r = None; break
                        r[nm] = cluster_stat(A["ev"][mm], A["nev"], [net[mm], np.ones(mm.sum())], lambda s: s[0] / s[1], B=200) + (int(mm.sum()),)
                    if r is None: continue
                    out["n_cells"] += 1
                    if r["fit"][0] > 0: out["n_pos_fit"] += 1
                    surv = bool(r["fit"][0] > 0 and r["test"][1] > 0)
                    if surv: out["n_survive"] += 1
                    if fn == "none" and sub == "all": out["unconditional"][f"{side}_h{h}"] = r
                    out["cells"].append(dict(h=h, side=side, sub=sub, feature=fn, bin=bn, fit=r["fit"], test=r["test"], survive=surv))
    print(cls, "h", h, flush=True)
out["cells"].sort(key=lambda c: -c["test"][1])
out["top"] = out["cells"][:12]; del out["cells"]
json.dump(out, open(os.path.join(RES, f"rtscan-{cls}.json"), "w"), indent=1)
print(cls, out["n_cells"], out["n_survive"], flush=True)
