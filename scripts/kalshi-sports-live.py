#!/usr/bin/env python3
"""(c) Live: ESPN win-probability (home) vs Kalshi 1-min price. Signal at ESPN update wallclock t (observed at t+feed_lag):
 buy side if espn_prob - kalshi_mid(observed minute) > thr; fill = ask of candle at t+feed_lag+order_lag (taker fee). First signal per game.
usage: kalshi-sports-live.py DATA_DIR [feed_lag_s=30] [order_lag_s=60]"""
import sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from kalshi_sports_lib import *
D = sys.argv[1]; FL = int(sys.argv[2]) if len(sys.argv) > 2 else 30; OL = int(sys.argv[3]) if len(sys.argv) > 3 else 60
ONLY = sys.argv[4] if len(sys.argv) > 4 else None
MT = [g for g in json.load(open(D + "/matched.json")) if not ONLY or sport(g["series"]) == ONLY]
need = set()
for g in MT: need.update([g["home"], g["away"]])
C = {t: rows for t, rows in load_candles(D + "/candles.jsonl") if t in need}
games = []
for g in MT:
    wp = [(ts(w[0]), w[1]) for w in g["espn"]["wp"] if w[0] and w[1] is not None]
    if len(wp) < 20 or g["home"] not in C or g["away"] not in C: continue
    games.append((g, sorted(wp)))
print("games with wp+candles:", len(games))
def px(tk, t, ask):
    r = row_at(C[tk], t, after=True)
    if not r or r[0] - t > 180 or r[1] is None or r[2] is None: return None
    return r[2] if ask else (r[1] + r[2]) / 2
for thr in (0.03, 0.05, 0.08, 0.12):
  for persist in (1, 2):
    rows = []
    for g, wp in games:
        done = False; streak = {"home": 0, "away": 0}
        for t, w in wp:
            if done: break
            obs = t + FL
            for side, pw in (("home", w), ("away", 1 - w)):
                tk = g[side]
                mid = px(tk, obs, False)
                if mid is None or mid > 0.97 or mid < 0.03: streak[side] = 0; continue
                if pw - mid > thr: streak[side] += 1
                else: streak[side] = 0
                if streak[side] >= persist:
                    ask = px(tk, obs + OL, True)
                    if ask is None or ask > 0.98: continue
                    win = 1 if g[side + "_res"] == "yes" else 0
                    # only count entries during the game
                    if t < g["start"]: continue
                    rows.append(dict(event=g["kalshi_event"], date=g["espn"]["date"][:10], sport=sport(g["series"]), p=ask, win=win, pnl=win - ask - fee_per_contract(ask, g["series"]), ew=pw))
                    done = True; break
    print("== thr %.2f persist %d feed_lag %ds order_lag %ds ==" % (thr, persist, FL, OL))
    print(report("ALL", rows))
    if rows:
        dts = sorted(set(r["date"] for r in rows)); mid_d = dts[len(dts) // 2]
        print(report("  fit <" + mid_d, [r for r in rows if r["date"] < mid_d])); print(report("  test >=" + mid_d, [r for r in rows if r["date"] >= mid_d]))
        for sp in sorted(set(r["sport"] for r in rows)): print(report("  " + sp, [r for r in rows if r["sport"] == sp]))
        print("  avg espn_prob at entry %.3f vs win rate %.3f" % (sum(r["ew"] for r in rows) / len(rows), sum(r["win"] for r in rows) / len(rows)))
