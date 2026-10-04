#!/usr/bin/env python3
"""TSA weekly-average check-ins (KXTSAW).  The source (tsa.gov/travel/passenger-volumes) returns 403 to an honestly-identified client
(Akamai, even robots.txt) and Kalshi's archive holds NO daily TSA series, so the within-week running value cannot be reconstructed.
What CAN be tested: a seasonal (same week last year x trailing YoY) forecast at Monday-open vs Kalshi mid, plus late-week calibration.
Model is rolling/out-of-sample by construction: only values of earlier weeks.  Usage: obs_tsa_weekly.py RAWDIR CACHEDIR"""
import sys, os, json, re, math, collections, datetime as dt, random
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import *
import numpy as np
raw, cdir = sys.argv[1], sys.argv[2]
MON = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
def edate(et):
    m = re.search(r"-(\d\d)([A-Z]{3})(\d\d)", et); return dt.date(2000 + int(m[1]), MON[m[2]], int(m[3]))
mk = {}
for sub in ("markets_hist", "markets"):
    for l in open(f"{raw}/{sub}/KXTSAW.jsonl"):
        m = json.loads(l); mk[m["ticker"]] = m
V = {}; W = collections.defaultdict(list)
for m in mk.values():
    if m["status"] not in ("finalized", "settled") or m["floor_strike"] is None: continue
    ev = m["expiration_value"].replace(",", "")
    try: v = float(ev)
    except Exception: continue
    if v < 1e6: continue
    d = edate(m["event_ticker"]); V[d] = v; W[d].append(m)
ds = sorted(V); print("TSA weekly events with value:", len(ds), ds[0], ds[-1])
def fc(d):
    ks = [d - dt.timedelta(7 * k) for k in range(1, 5)]
    ly = d - dt.timedelta(364)
    if ly not in V or any(k not in V or (k - dt.timedelta(364)) not in V for k in ks): return None
    g = np.mean([math.log(V[k] / V[k - dt.timedelta(364)]) for k in ks])
    return math.log(V[ly]) + g
# rolling residuals
pred = {d: fc(d) for d in ds}; err = {d: math.log(V[d]) - pred[d] for d in ds if pred[d] is not None}
use = sorted(err); print("forecastable weeks:", len(use), use[0] if use else None, use[-1] if use else None)
sd_all = np.std([err[d] for d in use]); print(f"log-error sd of seasonal forecast: {sd_all:.4f} (bias {np.mean([err[d] for d in use]):+.4f})")
want = []; info = {}
for d in use:
    p = math.exp(pred[d])
    for m in W[d]:
        K = m["floor_strike"]
        if abs(K / p - 1) > 0.08: continue
        want.append((m["ticker"], "KXTSAW", iso_ts(m["open_time"]), iso_ts(m["close_time"])))
        info[m["ticker"]] = (d, K, m["result"], iso_ts(m["open_time"]), iso_ts(m["close_time"]))
print("candle requests", len(want), flush=True)
C = candles(want, f"{cdir}/tsaw_candles.json")
def at(cs, ts):
    r = [c for c in cs if c[0] == ts]; return r[0] if r else None
rows = []
HOURS = [(2, "Mon 14:00Z (week start)"), (96, "Fri 14:00Z (4d in)"), (-24, "Sat 23:59 ET - 24h = Sat ~04:00Z")]
for t, (d, K, res, o, cl) in info.items():
    sd_prior = np.std([err[x] for x in use if x < d]) if len([x for x in use if x < d]) >= 8 else None
    for h, lab in HOURS:
        ts = o + h * 3600 if h > 0 else cl + h * 3600
        c = at(C[t], ts)
        if not c or c[1] is None or c[2] is None: continue
        z = (math.log(K) - pred[d]) / (sd_prior or sd_all)
        p1 = 0.5 * math.erfc(z / math.sqrt(2))
        rows.append(dict(t=t, d=d, K=K, y=int(res == "yes"), lab=lab, bid=c[1], ask=c[2], mid=(c[1] + c[2]) / 2, p1=p1, rolling=sd_prior is not None))
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
for _, lab in HOURS:
    rs = [r for r in rows if r["lab"] == lab and r["rolling"]]
    if not rs: continue
    print(f"{lab}: rows {len(rs)} events {len({r['d'] for r in rs})}: Brier mid {brier(rs,'mid'):.4f} seasonal-model {brier(rs,'p1'):.4f}; model-mid CI {bootdiff(rs,'p1','mid')}")
    for thr in (0.05, 0.10):
        by = collections.defaultdict(list)
        for r in rs: by[r["d"]].append(r)
        tr = []
        for d, g in by.items():
            best = None
            for r in g:
                for side in ("yes", "no"):
                    px = r["ask"] if side == "yes" else 1 - r["bid"]; e = (r["p1"] - px) if side == "yes" else ((1 - r["p1"]) - px)
                    w = r["y"] if side == "yes" else 1 - r["y"]
                    if 0.03 < px < 0.97 and e > thr and (best is None or e > best[0]): best = (e, px, w - px - taker_fee(px, 1.0, 100) / 100)
            if best: tr.append(best)
        if tr:
            rnd = random.Random(8); bs = sorted(sum(rnd.choice(tr)[2] for _ in tr) / len(tr) for _ in range(500))
            print(f"    taker best-edge>{thr}: events {len(tr)} EV/ct {sum(t[2] for t in tr)/len(tr)*100:+.2f}c CI [{bs[12]*100:+.2f},{bs[487]*100:+.2f}]c")
