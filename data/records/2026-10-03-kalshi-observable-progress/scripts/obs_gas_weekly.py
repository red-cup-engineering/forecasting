#!/usr/bin/env python3
"""AAA gas, weekly 'above K' markets (KXAAAGASW): opens Monday 10:00 ET, closes Sunday 23:59 ET, settles on the AAA average
of the following Monday.  Running value: AAA average on the decision day (weekly settle values 2023-12..; daily values from
KXAAAGASD events 2026-03-26..).  Decision times: Monday 14:00Z (H=7 days left) and, for weeks with daily values, Thursday 14:00Z (H=4).
Model: OLS on weekly (or H-day) difference with lagged momentum, empirical residual kernel; fit = first 60% of weeks, test = rest."""
import sys, os, json, re, math, collections, datetime as dt, random
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import *
import numpy as np
raw, cdir = sys.argv[1], sys.argv[2]
MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
def edate(et):
    m = re.search(r"-(\d\d)([A-Z]{3})(\d\d)", et); return dt.date(2000 + int(m[1]), MON[m[2]], int(m[3]))
def load(t):
    mk = {}
    for sub in ("markets_hist", "markets"):
        fp = f"{raw}/{sub}/{t}.jsonl"
        if os.path.exists(fp):
            for l in open(fp):
                m = json.loads(l); mk[m["ticker"]] = m
    return mk
V = {}
for t in ("KXAAAGASD", "KXAAAGASW", "KXAAAGASM"):
    for m in load(t).values():
        if m["status"] in ("finalized", "settled") and m["expiration_value"]:
            try: V[edate(m["event_ticker"])] = float(m["expiration_value"])
            except Exception: pass
W = collections.defaultdict(list)
for m in load("KXAAAGASW").values():
    if m["status"] in ("finalized", "settled") and m["expiration_value"] and m["floor_strike"] is not None:
        W[edate(m["event_ticker"])].append(m)
weeks = sorted(d for d in W if (d - dt.timedelta(7)) in V and (d - dt.timedelta(14)) in V and (d - dt.timedelta(21)) in V)
print("weekly events with 3 prior weekly values:", len(weeks), weeks[0], weeks[-1])
cut = weeks[int(len(weeks) * 0.6)]
def wfeat(d): return [1.0, V[d - dt.timedelta(7)] - V[d - dt.timedelta(14)], V[d - dt.timedelta(14)] - V[d - dt.timedelta(21)]]
fit = [d for d in weeks if d < cut]; test = [d for d in weeks if d >= cut]
X = np.array([wfeat(d) for d in fit]); y = np.array([V[d] - V[d - dt.timedelta(7)] for d in fit])
beta = np.linalg.lstsq(X, y, rcond=None)[0]; RES = y - X @ beta
print(f"H=7: fit {len(fit)} wks (<{cut}), test {len(test)}; beta {np.round(beta,3).tolist()}; resid sd {RES.std():.4f} vs raw sd {y.std():.4f}; lag1 corr {np.corrcoef(y[1:],y[:-1])[0,1]:.2f}")
SK = 0.006
def pab(K, v0, mu, resid):
    return float(np.mean([0.5 * math.erfc(((K - v0 - mu - e) / SK) / math.sqrt(2)) for e in resid]))
want = []; info = {}
for d in weeks:
    v0 = V[d - dt.timedelta(7)]
    for m in W[d]:
        K = m["floor_strike"]
        if abs(K - v0) > 0.15: continue
        want.append((m["ticker"], "KXAAAGASW", iso_ts(m["open_time"]), iso_ts(m["close_time"])))
        info[m["ticker"]] = (d, K, m["result"], iso_ts(m["open_time"]))
print("candle requests", len(want), flush=True)
C = candles(want, f"{cdir}/gasw_candles.json")
rows = []
for t, (d, K, res, o) in info.items():
    c = [x for x in C[t] if x[0] == o + 2 * 3600]
    if not c or c[0][1] is None or c[0][2] is None: continue
    c = c[0]; v0 = V[d - dt.timedelta(7)]
    mu = float(np.array(wfeat(d)) @ beta)
    rows.append(dict(d=d, K=K, y=int(res == "yes"), bid=c[1], ask=c[2], mid=(c[1] + c[2]) / 2,
                     p1=pab(K, v0, mu, RES), p0=pab(K, v0, 0.0, y)))
def brier(rs, k): return sum((r[k] - r["y"]) ** 2 for r in rs) / len(rs)
def bootdiff(rs, a, b, B=400):
    ev = collections.defaultdict(list)
    for r in rs: ev[r["d"]].append((r[a] - r["y"]) ** 2 - (r[b] - r["y"]) ** 2)
    ks = list(ev); rnd = random.Random(3); v = []
    for _ in range(B):
        s = n = 0
        for k in (rnd.choice(ks) for _ in ks): s += sum(ev[k]); n += len(ev[k])
        v.append(s / n)
    v.sort(); return round(v[int(.025 * B)], 4), round(v[int(.975 * B)], 4)
print("\n== H=7 (Monday 14:00Z, strikes within 15c of known value): Brier")
for name, rs in (("FIT", [r for r in rows if r["d"] < cut]), ("TEST", [r for r in rows if r["d"] >= cut])):
    print(f"{name}: rows {len(rs)} events {len({r['d'] for r in rs})}: mid {brier(rs,'mid'):.4f} AR {brier(rs,'p1'):.4f} null {brier(rs,'p0'):.4f}; AR-mid CI {bootdiff(rs,'p1','mid')}")
def trades(rs, key, thr):
    by = collections.defaultdict(list)
    for r in rs: by[r["d"]].append(r)
    out = []
    for d, g in by.items():
        best = None
        for r in g:
            for side in ("yes", "no"):
                px = r["ask"] if side == "yes" else 1 - r["bid"]
                edge = (r[key] - px) if side == "yes" else ((1 - r[key]) - px)
                win = r["y"] if side == "yes" else 1 - r["y"]
                if 0.02 < px < 0.98 and edge > thr and (best is None or edge > best[0]): best = (edge, px, win)
        if best: out.append((d, best[1], best[2] - best[1] - taker_fee(best[1], 1.0, 100) / 100, best[2]))
    return out
def summ(tr, lab):
    if not tr: print(lab, "no trades"); return
    n = len(tr); ev = sum(t[2] for t in tr) / n; rnd = random.Random(4); bs = []
    for _ in range(500):
        bs.append(sum(rnd.choice(tr)[2] for _ in tr) / n)  # one trade per event -> iid over events
    bs.sort(); print(f"{lab}: trades/events {n}, avg px {sum(t[1] for t in tr)/n:.3f}, win {sum(t[3] for t in tr)/n:.3f}, EV/ct {ev*100:+.2f}c CI [{bs[12]*100:+.2f},{bs[487]*100:+.2f}]c")
for thr in (0.03, 0.06, 0.10):
    summ(trades([r for r in rows if r["d"] >= cut], "p1", thr), f"TEST taker AR edge>{thr}")
    summ(trades([r for r in rows if r["d"] < cut], "p1", thr), f"FIT  taker AR edge>{thr}")
