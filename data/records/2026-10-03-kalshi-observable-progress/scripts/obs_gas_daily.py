#!/usr/bin/env python3
"""AAA national gas average, daily 'above K' markets (KXAAAGASD).  Running value = AAA average of the previous day
(public, posted each morning).  Model = AR on daily differences fit on the fit period; test = later events.
Usage: obs_gas_daily.py RAWDIR CACHEDIR [SPLIT_DATE=2026-07-15]"""
import sys, os, json, re, math, collections, datetime as dt, random
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import *
raw, cdir = sys.argv[1], sys.argv[2]; split = dt.date.fromisoformat(sys.argv[3] if len(sys.argv) > 3 else "2026-07-15")
os.makedirs(cdir, exist_ok=True)
MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
def edate(et):
    m = re.search(r"-(\d\d)([A-Z]{3})(\d\d)", et); return dt.date(2000 + int(m[1]), MON[m[2]], int(m[3]))
mk = {}
for sub in ("markets_hist", "markets"):
    for l in open(f"{raw}/{sub}/KXAAAGASD.jsonl"):
        m = json.loads(l); mk[m["ticker"]] = m
ev = collections.defaultdict(list)
for m in mk.values():
    if m["status"] in ("finalized", "settled") and m["expiration_value"]: ev[edate(m["event_ticker"])].append(m)
days = sorted(d for d in ev if d >= dt.date(2026, 3, 26))
V = {d: float(ev[d][0]["expiration_value"]) for d in days}
# contiguity
days = [d for d in days if (d - dt.timedelta(1)) in V and (d - dt.timedelta(2)) in V and (d - dt.timedelta(4)) in V]
D1 = lambda d: V[d] - V[d - dt.timedelta(1)]
# --- model: d_t = a + b1 d_{t-1} + b2 d_{t-2} + b3 d_{t-3}  (OLS, fit period only)
import numpy as np
def feats(d):
    p = lambda k: D1(d - dt.timedelta(k))
    return [1.0, p(1), p(2), p(3)]
fit = [d for d in days if d < split]; test = [d for d in days if d >= split]
X = np.array([feats(d) for d in fit]); y = np.array([D1(d) for d in fit])
beta = np.linalg.lstsq(X, y, rcond=None)[0]; RES = y - X @ beta
print(f"daily events usable {len(days)} (fit {len(fit)} < {split}, test {len(test)}); beta={np.round(beta,3).tolist()}; resid sd {RES.std():.4f}; raw d sd {y.std():.4f}")
base_beta = np.array([0, 0, 0, 0.0]); 
# AR1 persistence baselines: lag-1 corr
print("lag-1 autocorr of daily diffs (fit):", round(float(np.corrcoef(y[1:], y[:-1])[0,1]),3))
sig_k = 0.0015
def p_above(K, d, b, resid):
    mu = float(np.array(feats(d)) @ b); thr = K - V[d - dt.timedelta(1)]
    # P(mu + e > thr) , e smoothed empirical
    z = (thr - mu - resid) / sig_k
    return float(np.mean([0.5 * math.erfc(t / math.sqrt(2)) for t in z]))
# --- candles for near-the-money strikes
want = []; info = {}
for d in days:
    v0 = V[d - dt.timedelta(1)]
    for m in ev[d]:
        K = m["floor_strike"]
        if K is None or abs(K - v0) > 0.04: continue
        want.append((m["ticker"], "KXAAAGASD", iso_ts(m["open_time"]), iso_ts(m["close_time"])))
        info[m["ticker"]] = (d, K, m["result"], m["open_time"], m["close_time"])
print("candle requests:", len(want), flush=True)
C = candles(want, f"{cdir}/gasd_candles.json")
# decision times: offsets (hours) from open_time (open = 12:00Z previous day): 14:00Z -> +2h ... use candle ending at that time
HOURS = [2, 6, 10, 14]   # 14:00Z, 18:00Z, 22:00Z, 02:00Z(+1) i.e. 10am,2pm,6pm,10pm ET of D-1
def at(cs, ts):
    best = None
    for c in cs:
        if c[0] == ts: best = c
    return best
rows = []
for t, (d, K, res, ot, ct) in info.items():
    o = iso_ts(ot)
    for h in HOURS:
        c = at(C[t], o + h * 3600)
        if not c or c[1] is None or c[2] is None: continue
        rows.append(dict(t=t, d=d, K=K, y=1 if res == "yes" else 0, h=h, bid=c[1], ask=c[2], mid=(c[1] + c[2]) / 2, vol=c[4]))
print("rows", len(rows))
def evaluate(rows, b, resid, label):
    out = collections.defaultdict(list)
    for r in rows:
        r["p"] = p_above(r["K"], r["d"], b, resid)
    return rows
# models: M0 = no-drift persistence (b=0), M1 = AR
for r in rows:
    r["p1"] = p_above(r["K"], r["d"], beta, RES)
    r["p0"] = p_above(r["K"], r["d"], np.array([0, 0, 0, 0.0]), y)
def brier(rs, key): return sum((r[key] - r["y"]) ** 2 for r in rs) / max(1, len(rs))
def boot_diff(rs, ka, kb, B=400):
    evs = collections.defaultdict(list)
    for r in rs: evs[r["d"]].append((r[ka] - r["y"]) ** 2 - (r[kb] - r["y"]) ** 2)
    keys = list(evs); vals = []
    rnd = random.Random(1)
    for _ in range(B):
        s = n = 0
        for k in (rnd.choice(keys) for _ in keys): s += sum(evs[k]); n += len(evs[k])
        vals.append(s / n)
    vals.sort(); return vals[int(.025 * B)], vals[int(.975 * B)]
print("\n== Brier on near-the-money (strike,hour) rows; negative diff = model better than Kalshi mid")
for name, rs in (("FIT", [r for r in rows if r["d"] < split]), ("TEST", [r for r in rows if r["d"] >= split])):
    ne = len({r["d"] for r in rs})
    print(f"{name}: rows {len(rs)}, events {ne}: Brier mid {brier(rs,'mid'):.4f}  AR {brier(rs,'p1'):.4f}  persistence-null {brier(rs,'p0'):.4f}")
    if name == "TEST":
        print("   AR - mid  95% CI (event bootstrap):", tuple(round(x, 4) for x in boot_diff(rs, "p1", "mid")))
# --- trading EV: per (event, hour): take best edge strike; taker; fee ceil to cent per 1 lot (use 100-lot fee/100)
def trades(rows, key, thr, hours=None, side_both=True):
    byk = collections.defaultdict(list)
    for r in rows:
        if hours and r["h"] not in hours: continue
        byk[(r["d"], r["h"])].append(r)
    out = []
    for k, rs in byk.items():
        best = None
        for r in rs:
            for side in ("yes", "no"):
                if side == "yes": px = r["ask"]; edge = r[key] - px; win = r["y"]
                else: px = 1 - r["bid"]; edge = (1 - r[key]) - px; win = 1 - r["y"]
                if px <= 0.02 or px >= 0.98: continue
                if edge > thr and (best is None or edge > best[0]): best = (edge, side, px, win, r)
        if best:
            e, side, px, win, r = best
            fee = taker_fee(px, 1.0, 100) / 100
            out.append((r["d"], r["h"], side, px, win - px - fee, e))
    return out
def summarize(tr, label):
    if not tr: print(label, "no trades"); return
    n = len(tr); ev = sum(t[4] for t in tr) / n
    # cluster by event day for CI
    byd = collections.defaultdict(list)
    for t in tr: byd[t[0]].append(t[4])
    ks = list(byd); rnd = random.Random(2); bs = []
    for _ in range(500):
        s = c = 0
        for k in (rnd.choice(ks) for _ in ks): s += sum(byd[k]); c += len(byd[k])
        bs.append(s / c)
    bs.sort(); nev = len(ks)
    wins = sum(1 for t in tr if t[4] + t[3] > 0.5)
    print(f"{label}: trades {n} on {nev} events, avg px {sum(t[3] for t in tr)/n:.3f}, win {wins/n:.3f}, EV/ct {ev*100:+.2f}c  95% CI [{bs[12]*100:+.2f},{bs[487]*100:+.2f}]c")
print("\n== Brier by decision hour (TEST+FIT): hour is offset from 12:00Z open of the day BEFORE the settlement date")
for h in HOURS:
    rs = [r for r in rows if r["h"] == h]
    print(f"h=+{h} ({(12+h)%24:02d}:00Z): rows {len(rs)} events {len({r['d'] for r in rs})}: Brier mid {brier(rs,'mid'):.4f} AR {brier(rs,'p1'):.4f}")
print("\n== Taker EV, best-edge strike per (event, hour), after fee")
for name, rs in (("FIT", [r for r in rows if r["d"] < split]), ("TEST", [r for r in rows if r["d"] >= split])):
    for thr in (0.03, 0.05, 0.08):
        summarize(trades(rs, "p1", thr), f"{name} AR  edge>{thr}")
for thr in (0.05,):
    summarize(trades([r for r in rows if r["d"] >= split], "p0", thr), f"TEST persistence-null edge>{thr}")
# calibration of Kalshi mid by bucket (TEST+FIT)
print("\n== Kalshi mid calibration (all near-money rows, clustered caveat: rows within an event are dependent)")
bk = collections.defaultdict(lambda: [0, 0, set()])
for r in rows:
    b = min(9, int(r["mid"] * 10)); bk[b][0] += 1; bk[b][1] += r["y"]; bk[b][2].add(r["d"])
for b in sorted(bk):
    n, k, e = bk[b]; p, lo, hi = wilson(k, n)
    print(f"mid {b/10:.1f}-{(b+1)/10:.1f}: n={n} events={len(e)} hit {p:.3f} [{lo:.3f},{hi:.3f}] avg-mid~{b/10+.05:.2f}")
