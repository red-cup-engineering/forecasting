#!/usr/bin/env python3
"""Mention markets (settle on what a speaker/broadcast says).  (1) calibration of cheap YES by price bucket at point-in-time
anchors (open+1h, +24h; only markets still open then), (2) a public-info base-rate model = hit rate of the SAME WORD in
EARLIER events of the SAME SERIES (stand-in for 'prior transcripts'), tested out of sample vs the market.
Usage: obs_mentions.py RAWDIR CACHEDIR [MIN_VOL=50] [MAX_MARKETS=6000]"""
import sys, os, json, re, math, glob, collections, random, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_obs_lib import *
from obs_families import family
raw, cdir = sys.argv[1], sys.argv[2]
MINV = float(sys.argv[3]) if len(sys.argv) > 3 else 50; MAXM = int(sys.argv[4]) if len(sys.argv) > 4 else 6000
S = {s["ticker"]: s for s in json.load(open(raw + "/series_all.json"))["series"]}
mk = {}
for fp in glob.glob(raw + "/markets/*.jsonl"):
    st = os.path.basename(fp)[:-6]
    if family(S[st]) != "MENTIONS": continue
    for sub in ("markets_hist", "markets"):
        f = f"{raw}/{sub}/{st}.jsonl"
        if os.path.exists(f):
            for l in open(f):
                m = json.loads(l)
                if m["result"] in ("yes", "no"): m["series"] = st; mk[m["ticker"]] = m
ms = list(mk.values())
print("settled mention markets:", len(ms), "events:", len({m["event_ticker"] for m in ms}), "series:", len({m["series"] for m in ms}))
ms.sort(key=lambda m: m["close_time"])
# pick candle sample: volume >= MINV, newest first up to MAXM (keeps prior-event structure for the biggest series)
samp = [m for m in ms if float(m["volume_fp"] or 0) >= MINV]
samp = samp[-MAXM:]
print("sample for candles:", len(samp), flush=True)
want = [(m["ticker"], m["series"], iso_ts(m["open_time"]), min(iso_ts(m["close_time"]), iso_ts(m["open_time"]) + 26 * 3600)) for m in samp]
C = candles(want, f"{cdir}/mentions_candles.json")
def word(m): return re.sub(r"[^a-z0-9 ]", "", (m["yes_sub_title"] or m["title"]).lower()).strip()
def evdate(m): return m["close_time"]  # close_time of EARLIER events is known at the time of later events (they finished)
rows = []
for m in samp:
    o = iso_ts(m["open_time"]); cl = iso_ts(m["close_time"])
    for h in (1, 24):
        c = [x for x in C[m["ticker"]] if x[0] == o + h * 3600]
        if not c or c[0][1] is None or c[0][2] is None: continue
        rows.append(dict(t=m["ticker"], ser=m["series"], ev=m["event_ticker"], w=word(m), h=h, bid=c[0][1], ask=c[0][2], y=int(m["result"] == "yes"),
                         close=m["close_time"], open=m["open_time"]))
print("anchor rows:", len(rows), "events:", len({r["ev"] for r in rows}))
def group(r):
    s = r["ser"]
    if "TRUMP" in s: return "Trump (say/mention)"
    if "EARNINGS" in s or s.startswith("KXMENTIONEARN"): return "earnings calls"
    return "other speakers/broadcasts"
def table(sel, title, edges=(0.0, .05, .10, .15, .20, .30, .50, .70, .90, 1.01), side="yes"):
    print(f"\n{title}  [buy {side.upper()} at ask-close, taker fee ceil-to-cent/100-lot]")
    for lo, hi in zip(edges[:-1], edges[1:]):
        g = [r for r in sel if lo <= (r["ask"] if side == "yes" else 1 - r["bid"]) < hi]
        if len(g) < 5: continue
        px = [(r["ask"] if side == "yes" else 1 - r["bid"]) for r in g]
        wn = [r["y"] if side == "yes" else 1 - r["y"] for r in g]
        k = sum(wn); n = len(g); p, a, b = wilson(k, n)
        pnl = [w - x - taker_fee(x, 1.0, 100) / 100 for w, x in zip(wn, px)]
        byev = collections.defaultdict(list)
        for r, v in zip(g, pnl): byev[r["ev"]].append(v)
        ks = list(byev); rnd = random.Random(5); bs = []
        for _ in range(400):
            s_ = c_ = 0
            for kk in (rnd.choice(ks) for _ in ks): s_ += sum(byev[kk]); c_ += len(byev[kk])
            bs.append(s_ / c_)
        bs.sort()
        print(f"  ask {lo:.2f}-{min(hi,1):.2f}: n={n} events={len(ks)} avg px {sum(px)/n:.3f} hit {p:.3f} [{a:.3f},{b:.3f}] EV/ct {sum(pnl)/n*100:+.2f}c CI [{bs[10]*100:+.2f},{bs[389]*100:+.2f}]c")
for h in (1, 24):
    sel = [r for r in rows if r["h"] == h]
    table(sel, f"== ALL mention series, anchor open+{h}h: n={len(sel)}")
    for g in ("Trump (say/mention)", "earnings calls", "other speakers/broadcasts"):
        table([r for r in sel if group(r) == g], f"-- {g}, anchor open+{h}h", edges=(0.0, .05, .10, .20, .30, .50, 1.01))
table([r for r in rows if r["h"] == 1], "== NO side, all series, anchor open+1h", edges=(0.0, .5, .7, .8, .9, .95, 1.01), side="no")
# --- base-rate model (strictly earlier events of same series; word match)
hist_by = collections.defaultdict(list)  # (series) -> list of (event, close, {word: y})
evs = collections.defaultdict(dict)
for m in ms:  # ALL settled markets (not just sampled) form the 'transcript' history
    evs[(m["series"], m["event_ticker"])].setdefault("close", m["close_time"]); evs[(m["series"], m["event_ticker"])].setdefault("w", {})[word(m)] = int(m["result"] == "yes")
bys = collections.defaultdict(list)
for (s, e), d in evs.items(): bys[s].append((d["close"], e, d["w"]))
for s in bys: bys[s].sort()
def prior(series, ev_close, ev, w):
    k = n = 0; tot_k = tot_n = 0
    for c, e, ws in bys[series]:
        if c >= ev_close or e == ev: continue
        tot_n += len(ws); tot_k += sum(ws.values())
        if w in ws: n += 1; k += ws[w]
    return k, n, tot_k, tot_n
ALPHA = 2.0
for r in rows:
    k, n, tk, tn = prior(r["ser"], r["close"], r["ev"], r["w"])
    base = tk / tn if tn >= 5 else None
    r["pri"] = (k, n)
    r["pm"] = None if base is None else (k + ALPHA * base) / (n + ALPHA)
cut = sorted({r["close"] for r in rows})[int(len({r["close"] for r in rows}) * 0.5)]
print("\nbase-rate model: p = (k + 2*series_rate)/(n + 2), k/n = same-word hits in earlier events of the series; fit/test split at", cut)
for h in (1, 24):
    for name, rs in (("FIT", [r for r in rows if r["h"] == h and r["pm"] is not None and r["close"] < cut]), ("TEST", [r for r in rows if r["h"] == h and r["pm"] is not None and r["close"] >= cut])):
        if not rs: continue
        mid = lambda r: (r["bid"] + r["ask"]) / 2
        bm = sum((mid(r) - r["y"]) ** 2 for r in rs) / len(rs); bp = sum((r["pm"] - r["y"]) ** 2 for r in rs) / len(rs)
        bc = sum((0.5 * (r["pm"] + mid(r)) - r["y"]) ** 2 for r in rs) / len(rs)
        print(f"h={h} {name}: rows {len(rs)} events {len({r['ev'] for r in rs})}: Brier market-mid {bm:.4f} base-rate {bp:.4f} 50/50 blend {bc:.4f}")
        for thr in (0.10, 0.20):
            tr = []
            for r in rs:
                for side in ("yes", "no"):
                    px = r["ask"] if side == "yes" else 1 - r["bid"]
                    edge = (r["pm"] - px) if side == "yes" else ((1 - r["pm"]) - px)
                    if 0.03 < px < 0.97 and edge > thr:
                        w = r["y"] if side == "yes" else 1 - r["y"]
                        tr.append((r["ev"], side, px, w - px - taker_fee(px, 1.0, 100) / 100))
            if tr:
                byev = collections.defaultdict(list)
                for e, _, _, v in tr: byev[e].append(v)
                ks = list(byev); rnd = random.Random(6); bs = []
                for _ in range(400):
                    s_ = c_ = 0
                    for kk in (rnd.choice(ks) for _ in ks): s_ += sum(byev[kk]); c_ += len(byev[kk])
                    bs.append(s_ / c_)
                bs.sort()
                print(f"     taker when |pm-px|>{thr}: trades {len(tr)} events {len(ks)} EV/ct {sum(t[3] for t in tr)/len(tr)*100:+.2f}c CI [{bs[10]*100:+.2f},{bs[389]*100:+.2f}]c; yes-side {sum(1 for t in tr if t[1]=='yes')}")
# --- knowable-from-history fractions (ALL settled markets, not only sampled)
print("\n== Outcome knowable from earlier same-series events (deterministic history), ALL settled mention markets")
cnt = collections.Counter(); hit = collections.Counter(); evsn = collections.defaultdict(set)
for m in ms:
    k, n, tk, tn = prior(m["series"], m["close_time"], m["event_ticker"], word(m))
    if n < 3: cls = "n<3 prior same-word"
    elif k == n: cls = "word in ALL (>=3) prior events"
    elif k == 0: cls = "word in NONE (>=3) prior events"
    else: cls = "mixed history (>=3)"
    cnt[cls] += 1; hit[cls] += (m["result"] == "yes"); evsn[cls].add(m["event_ticker"])
tot = sum(cnt.values())
for c in cnt:
    p, a, b = wilson(hit[c], cnt[c]); print(f"  {c}: {cnt[c]} markets ({cnt[c]/tot:.1%}), {len(evsn[c])} events, YES rate {p:.3f} [{a:.3f},{b:.3f}]")
