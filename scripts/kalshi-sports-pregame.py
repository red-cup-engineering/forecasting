#!/usr/bin/env python3
"""(b) Pre-game: Kalshi vs de-vigged ESPN pickcenter moneyline. Bet YES on the side whose de-vigged book prob exceeds Kalshi ASK by >thr.
Kalshi price = last candle <= start-lead. usage: kalshi-sports-pregame.py DATA_DIR [lead_minutes=5]"""
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_sports_lib import *
D = sys.argv[1]; lead = int(sys.argv[2]) if len(sys.argv) > 2 else 5
MT = json.load(open(D + "/matched.json"))
need = set()
for g in MT:
    need.update([g["home"], g["away"]] + ([g["tie"]] if g["tie"] else []))
C = {t: rows for t, rows in load_candles(D + "/candles.jsonl") if t in need}
games = []
for g in MT:
    e = g["espn"]
    if not e["odds"]: continue
    o = e["odds"][0]
    try:
        probs = devig(o["home"], o["away"], o["draw"] if g["tie"] else None)
    except Exception: continue
    sides = [("home", g["home"], g["home_res"], probs[0]), ("away", g["away"], g["away_res"], probs[1])]
    if g["tie"]: sides.append(("tie", g["tie"], g["tie_res"], probs[2]))
    obs = []
    for nm, tk, res, bp in sides:
        if tk not in C: continue
        r = row_at(C[tk], g["start"] - lead * 60, after=False)
        if not r or r[1] is None or r[2] is None or g["start"] - r[0] > 1800: continue
        obs.append(dict(side=nm, tk=tk, bid=r[1], ask=r[2], mid=(r[1] + r[2]) / 2, book=bp, win=1 if res == "yes" else 0))
    if len(obs) >= 2: games.append(dict(g=g, obs=obs, date=e["date"][:10], sport=sport(g["series"]), series=g["series"]))
print("games with book odds + kalshi quote:", len(games))
# calibration of Kalshi mid and of book vs outcome (Brier), all sides
def brier(xs): return sum(xs) / len(xs)
bk = [(o["book"] - o["win"]) ** 2 for G in games for o in G["obs"]]
km = [(o["mid"] - o["win"]) ** 2 for G in games for o in G["obs"]]
print("Brier book %.4f  kalshi-mid %.4f  (lower better; n sides=%d)" % (brier(bk), brier(km), len(bk)))
print("mean |book-mid| = %.4f" % (sum(abs(o["book"] - o["mid"]) for G in games for o in G["obs"]) / len(bk)))
dates = sorted(set(G["date"] for G in games)); mid = dates[len(dates) // 2]
for thr in (0.02, 0.03, 0.05):
    rows = []
    for G in games:
        best = max(G["obs"], key=lambda o: o["book"] - o["ask"])
        if best["book"] - best["ask"] > thr:
            fee = fee_per_contract(best["ask"], G["series"])
            rows.append(dict(event=G["g"]["kalshi_event"], date=G["date"], sport=G["sport"], p=best["ask"], win=best["win"], pnl=best["win"] - best["ask"] - fee))
    print("== thr %.2f: bet best side if book_prob - kalshi_ask > thr (taker fee) ==" % thr)
    print(report("ALL", rows)); print(report("  fit <" + mid, [r for r in rows if r["date"] < mid])); print(report("  test >=" + mid, [r for r in rows if r["date"] >= mid]))
    for sp in sorted(set(r["sport"] for r in rows)): print(report("  " + sp, [r for r in rows if r["sport"] == sp]))
    # also: gross (no fee) to see raw edge
    print(report("  gross(no fee)", [dict(r, pnl=r["pnl"] + fee_per_contract(r["p"], "x")) for r in rows]))
