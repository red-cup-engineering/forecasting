#!/usr/bin/env python3
"""Test the weekly edge-scan sports leads at game level with taker and realistic-maker fills.
 L1: all sports, H=120 min before close, YES price (ask) in 81-90c -> buy YES.
 L2: KXNCAAF*, H=60 min before close, NO price in 91-95c (YES bid 5-9c) -> buy NO.
 taker: fill at ask of minute after T. maker: rest a bid at current best bid at T (cents); fills only if a LATER minute's traded
 low (price.low) is strictly < bid (strict) / <= bid (optimistic). Maker fee 0.0175*mult*P(1-P) (series quadratic_with_maker_fees; others 0).
 NOTE: close_time is the early-close time (winner declared) -> 'H before close' is look-ahead; reported as the scan defined it.
usage: kalshi-sports-edge-scan-leads.py DATA_DIR"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_sports_lib import *
D = sys.argv[1]
M = load_markets(D + "/markets.jsonl")
MAKER_FEE_SERIES = {"KXNFLGAME","KXNCAAFGAME","KXMLBGAME","KXWNBAGAME","KXNHLGAME","KXNBAGAME","KXEPLGAME","KXUCLGAME","KXLALIGAGAME","KXBUNDESLIGAGAME","KXSERIEAGAME","KXLIGUE1GAME","KXATPMATCH","KXWTAMATCH"}
def mfee(p, s):
    if s not in MAKER_FEE_SERIES: return 0.0
    return math.ceil(round(0.0175 * FEE_MULT.get(s, 1) * 100 * p * (1 - p) * 100, 6)) / 100 / 100
def run(label, H, filt, side, lo, hi):
    res = {"taker": {}, "maker_strict": {}, "maker_opt": {}, "signals": {}}
    for t, rows in load_candles(D + "/candles-lh.jsonl"):
        m = M[t]
        if not filt(m): continue
        close = ts(m["close_time"]); T = close - H * 60
        pre = [r for r in rows if r[0] <= T and r[1] is not None and r[2] is not None]
        if not pre or T - pre[-1][0] > 600: continue
        r0 = pre[-1]
        post = [r for r in rows if T < r[0] <= close]
        if not post: continue
        yes_win = m["result"] == "yes"
        if side == "yes":
            ask = r0[2]
            if not (lo <= ask <= hi): continue
            win = 1 if yes_win else 0
            tf = post[0][2]
            B = r0[1]
            fills = lambda r, strict: r[5] is not None and (r[5] < B - 1e-9 if strict else r[5] <= B + 1e-9)
            cost_tk = tf
        else:
            noask = round(1 - r0[1], 4)   # buy NO at 1 - yes_bid
            if not (lo <= noask <= hi): continue
            win = 0 if yes_win else 1
            tf = None if post[0][1] is None else round(1 - post[0][1], 4)
            Bno = round(1 - r0[2], 4)       # rest NO bid = 1 - yes_ask
            fills = lambda r, strict: r[6] is not None and (r[6] > r0[2] + 1e-9 if strict else r[6] >= r0[2] - 1e-9)
            B = Bno; cost_tk = tf
        ev = m["event_ticker"]; base = dict(event=ev, date=m["close_time"][:10], sport=sport(m["series"]), win=win)
        if ev in res["signals"]: continue
        res["signals"][ev] = dict(base, p=r0[2] if side == "yes" else noask, pnl=win - (r0[2] if side == "yes" else noask))
        if cost_tk is not None and lo - 0.03 <= cost_tk <= hi + 0.03:
            res["taker"][ev] = dict(base, p=cost_tk, pnl=win - cost_tk - fee_per_contract(cost_tk, m["series"]))
        for key, strict in (("maker_strict", True), ("maker_opt", False)):
            if any(fills(r, strict) for r in post):
                res[key][ev] = dict(base, p=B, pnl=win - B - mfee(B, m["series"]))
    print("#### %s (H=%dmin, %s, price %.2f-%.2f)" % (label, H, side, lo, hi))
    for k in ("signals", "taker", "maker_strict", "maker_opt"):
        R = list(res[k].values())
        if not R: print(k, "none"); continue
        print(report(k + (" (no fee, mid-quote)" if k == "signals" else ""), R))
        if k != "signals":
            ds = sorted(set(r["date"] for r in R)); md = ds[len(ds) // 2]
            print(report("   fit <" + md, [r for r in R if r["date"] < md])); print(report("   test >=" + md, [r for r in R if r["date"] >= md]))
    n = len(res["signals"]); f = len(res["maker_strict"])
    sig = res["signals"]; filled = res["maker_strict"]
    unf = [sig[e] for e in sig if e not in filled]
    print("maker strict fill rate %.2f (%d/%d); adverse selection: win rate filled %.3f vs unfilled %.3f" % (f / n if n else 0, f, n,
          sum(r["win"] for r in filled.values()) / max(1, f), sum(r["win"] for r in unf) / max(1, len(unf))))
    print("   by sport (taker):")
    for sp in sorted(set(r["sport"] for r in res["taker"].values())): print(report("   " + sp, [r for r in res["taker"].values() if r["sport"] == sp]))
run("L1 sports YES 81-90", 120, lambda m: True, "yes", 0.81, 0.90)
run("L1 variant: sports YES 81-90 at 60min", 60, lambda m: True, "yes", 0.81, 0.90)
run("L2 NCAAF NO 91-95", 60, lambda m: m["series"].startswith("KXNCAA"), "no", 0.91, 0.95)
