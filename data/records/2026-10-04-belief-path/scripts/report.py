#!/usr/bin/env python3
"""Assemble results/*.json into results/summary.md (tables for the README)."""
import json, os, glob
from bp_common import RES
CL = ["weather", "gas", "sports_game", "sports_prop", "mentions", "econ", "crypto"]
def load(kind, c):
    p = os.path.join(RES, f"{kind}-{c}.json")
    return json.load(open(p)) if os.path.exists(p) else None
def ci(v, d=2): return f"{v[0]:.{d}f} [{v[1]:.{d}f}, {v[2]:.{d}f}]"
L = []
def surv(r):
    s = []
    for f, c in (r.get("coef") or {}).items():
        if abs(c["t_train"]) >= 3 and abs(c["t_test"]) >= 2 and c["b_train"] * c["b_test"] > 0:
            s.append(f"{f}({c['b_test']:+.2f}c/sd)")
    return ", ".join(s) or "-"
# 0. verdict table
V = ["## 0. Verdicts: class x horizon (mid, spread <= 5c)\n", "Martingale rejected if the drift CI excludes 0 under event AND day clustering, or the VR CI excludes 1, or a state feature is confirmed out of sample (|t_fit|>=3, |t_test|>=2, same sign). Effect = drift in cents per observation over the horizon, sd of the move in brackets. A rejection is not an edge: section 2 and 3 price it through the spread.\n", "| class | 1m | 5m | 30m | 2h | to resolution |", "|---|---|---|---|---|---|"]
for c in CL:
    d = load("martingale", c)
    if not d: continue
    cells = []
    for h in (1, 5, 30, 120):
        rm = d["rows"].get(f"mid_{h}")
        if not rm: cells.append("n/a"); continue
        ev, dy, vr = rm["mean_event"], rm["mean_day"], rm["vr_event"]
        why = []
        if (ev[1] > 0 or ev[2] < 0) and (dy[1] > 0 or dy[2] < 0): why.append("drift")
        if h > 1 and (vr[1] > 1 or vr[2] < 1): why.append(f"VR {vr[0]:.2f}")
        s = surv(rm)
        if s != "-": why.append("feat")
        cells.append(("**not MG** (" + ", ".join(why) + ")" if why else "MG") + f" {ev[0]:+.2f}c [{ev[1]:+.2f},{ev[2]:+.2f}] (sd {rm['sd_c']:.1f})")
    ex = d.get("to_resolution_exec", {})
    pos = [k for k, v in ex.items() if v["C10"][1] > 0 and v["fit"] is not None and v["test"] is not None and v["fit"] > 0 and v["test"] > 0]
    cells.append(f"{len(pos)} hold-to-settlement cells net+ (of {len(ex)})")
    V.append(f"| {c} | " + " | ".join(cells) + " |")
L.extend(V); L.append("")
# 1. martingale table
L.append("## 1. Martingale tests (class x horizon)\n")
L.append("Observations are minutes with a two-sided book whose spread is at most 5c (so the mid is a price, not the midpoint of a 1c bid and a 99c ask) and a mid in 5-95c; the all-spreads variant is in the second table. Drift = mean change of mid in cents per observation; VR = variance ratio vs 1-minute; AC = autocorrelation of consecutive h-minute moves; CIs are event-cluster bootstrap. `day-CI` = drift CI clustered by day. `feat` = features significant in the fit half (|t|>=3) and confirmed in the test half (same sign, |t|>=2), on the mid target / on the bid target (spread and volume rows on the bid target are mechanical). OOS = out-of-sample gain over the zero forecast, fraction of sum of squares.\n")
L.append("| class | h(min) | n | sd(c) | drift c [event CI] | day-CI | VR [CI] | AC [CI] | OOS gain [CI] | feat mid | feat bid |")
L.append("|---|---|---|---|---|---|---|---|---|---|---|")
verdict_rows = []
for c in CL:
    d = load("martingale", c)
    if not d: continue
    for h in (1, 5, 30, 120):
        rm, rb = d["rows"].get(f"mid_{h}"), d["rows"].get(f"bid_{h}")
        if not rm: continue
        dayci = rm["mean_day"]
        oos = ci(rm["oos_r2"], 4) if "oos_r2" in rm else "n/a"
        L.append(f"| {c} | {h} | {rm['n']} | {rm['sd_c']:.2f} | {ci(rm['mean_event'], 3)} | [{dayci[1]:.3f}, {dayci[2]:.3f}] | {ci(rm['vr_event'])} | {ci(rm['ac_event'], 3)} | {oos} | {surv(rm)} | {surv(rb) if rb else '-'} |")
L.append("")
L.append("### Same tests with every two-sided book (spread up to 98c): drift and variance ratio only\n")
L.append("| class | h | n | drift c [CI] | VR [CI] | feat mid |")
L.append("|---|---|---|---|---|---|")
for c in CL:
    p = os.path.join(RES, f"martingale-{c}-all.json")
    if not os.path.exists(p): continue
    d = json.load(open(p))
    for h in (1, 5, 30, 120):
        rm = d["rows"].get(f"mid_{h}")
        if rm: L.append(f"| {c} | {h} | {rm['n']} | {ci(rm['mean_event'], 3)} | {ci(rm['vr_event'])} | {surv(rm)} |")
L.append("")
L.append("### To-resolution (settlement) calibration: mean of X - mid, cents, by time to close and price bucket (event CI, n)\n")
L.append("| class | time axis (sports: hours since start; others: hours to close) | mid bucket | E[X-mid] c [CI] | n |")
L.append("|---|---|---|---|---|")
for c in CL:
    d = load("martingale", c)
    if not d: continue
    for k, v in d["to_resolution"].items():
        t, b = k.split("_mid")
        L.append(f"| {c} | {t} | {b} | {ci(v[:3], 1)} | {v[3]} |")
L.append("")
L.append("### Executable hold-to-settlement value (settlement game, for reference): taker entry at the ask (YES) or bid-implied NO price, net of entry fee, cents per contract\n")
L.append("Cells where the event-CI lower bound is above 0 and both date halves are positive.\n")
L.append("| class | time axis | side | entry price | net c C=1 [CI] | net c C=10 [CI] | fit / test half | n (events) |")
L.append("|---|---|---|---|---|---|---|---|")
for c in CL:
    d = load("martingale", c)
    if not d or "to_resolution_exec" not in d: continue
    for k, v in d["to_resolution_exec"].items():
        t, side, b = k.split("_")
        if v["C10"][1] > 0 and v["fit"] is not None and v["test"] is not None and v["fit"] > 0 and v["test"] > 0:
            L.append(f"| {c} | {t} | {side} | {b} | {ci(v['C1'])} | {ci(v['C10'])} | {v['fit']:.2f} / {v['test']:.2f} | {v['n']} ({v['n_events']}) |")
L.append("")
# 2. overreaction
L.append("## 2. Overreaction (|d mid| >= k c in one minute; first trigger per 30 min per market)\n")
L.append("`rev` = reversion of the mid toward the pre-move level (cents, positive = fade works on the mid). `fade net` = executable taker round trip, 1-minute latency, fees both legs, event CI. thin = spread >= 4c or trailing-hour volume < 5.\n")
L.append("| class | k | liquidity | n trig (events) | h | rev mid c [CI] | fade net c (L=1) [CI] | maker-in strict EV/placement [CI] (fill) |")
L.append("|---|---|---|---|---|---|---|---|")
best = []
for c in CL:
    d = load("overreaction", c)
    if not d: continue
    for k in (2, 5, 10):
        for liq in ("thin", "thick"):
            cell = d["cells"].get(f"k{k}_{liq}")
            if not cell or "h30" not in cell: continue
            for h in (5, 30, 120):
                x = cell[f"h{h}"]
                if "rev_mid_c" not in x or "net_L1" not in x: continue
                mk = x.get("maker_strict_ev_per_placement")
                L.append(f"| {c} | {k} | {liq} | {cell['n']} ({cell['n_events']}) | {h} | {ci(x['rev_mid_c'])} | {ci(x['net_L1'][:3])} | {ci(mk) + ' (' + format(x['maker_strict_fill_rate'], '.0%') + ')' if mk else '-'} |")
                best.append((x["net_L1"][1], c, k, liq, h, x["net_L1"][:3], cell["n"]))
                if mk: best.append((mk[1], c, k, liq + " maker", h, mk, cell["n"]))
L.append("")
best.sort(reverse=True)
L.append("Best five fade round trips by lower confidence bound (any liquidity):\n")
for b in best[:5]: L.append(f"- {b[1]} k={b[2]} {b[3]} h={b[4]}: {ci(b[5])} c, n={b[6]}")
L.append("")
# 3. rtscan
L.append("## 3. Round-trip scan over state bins (taker in/out, fees, L=1)\n")
L.append("| class | cells tested | fit-half mean > 0 | survive (fit mean > 0 and test lower bound > 0) | best cell by test lower bound |")
L.append("|---|---|---|---|---|")
for c in CL:
    d = load("rtscan", c)
    if not d: continue
    t = d["top"][0] if d["top"] else None
    ts = f"{t['side']} h{t['h']} {t['sub']} {t['feature']} {t['bin']}: fit {ci(t['fit'][:3])} (n={t['fit'][3]}), test {ci(t['test'][:3])} (n={t['test'][3]})" if t else "-"
    L.append(f"| {c} | {d['n_cells']} | {d['n_pos_fit']} | {d['n_survive']} | {ts} |")
L.append("")
L.append("Unconditional taker round trips (all contested observations), net c per contract [event CI]:\n")
L.append("| class | side | h | net c |")
L.append("|---|---|---|---|")
for c in CL:
    d = load("rtscan", c)
    if not d: continue
    for k, v in d["unconditional"].items():
        L.append(f"| {c} | {k.split('_')[0]} | {k.split('_h')[1]} | {ci(v['test'][:3])} (test half) |")
L.append("")
# 4. longshot
L.append("## 4. Longshot decay: certified tail (ask 2-5c, bid >= 1c) cohorts\n")
L.append("`yes%` = settlement rate; `hold` = long NO (short the tail) hit at the bid and held to settlement, per contract net of the entry fee (C=1 / C=10); `resting` = the same if a resting sell at the entry ask fills (maker fee 0, fill and adverse selection not modelled); mid path = mean mid in cents at +h minutes (settled markets count at X); `sell early` = buy NO now, sell back at +h, fees both legs.\n")
L.append("| class | entry | n (events) | ask/bid c | yes% [CI] | hold net C1 [CI] | hold net C10 [CI] | resting-at-ask gross | mid c: entry, +30m, +2h | sell-early net at +30m / +2h |")
L.append("|---|---|---|---|---|---|---|---|---|---|")
for c in CL:
    d = load("longshot", c)
    if not d: continue
    for k, v in d["cohorts"].items():
        if "path" not in v: continue
        p30, p120 = v["path"]["+30m"], v["path"]["+120m"]
        L.append(f"| {c} | {k[1:]}h {'since start' if c.startswith('sports') else 'to close'} | {v['n']} ({v['n_events']}) | {v['entry_ask_c']:.1f}/{v['entry_bid_c']:.1f} | {ci(v['yes_rate_pct'], 1)} | {ci(v['hold_net_C1'])} | {ci(v['hold_net_C10'])} | {ci(v['resting_at_ask_gross_c'])} | {v['implied_mid_pct']:.2f}, {p30['mid_c']:.2f}, {p120['mid_c']:.2f} | {p30['roundtrip_net_c'][0]:.2f} / {p120['roundtrip_net_c'][0]:.2f} |")
L.append("")
b = load("books5m", "") if False else (json.load(open(os.path.join(RES, "books5m.json"))) if os.path.exists(os.path.join(RES, "books5m.json")) else None)
if b:
    L.append("## 5. Order-book features (microstructure collector, 5-minute books)\n")
    L.append(f"{b['n_snapshots']} book snapshots, {b['n_tickers']} tickers, {b['n_times']} sweeps. Coefficients in cents per 1 sd, t-stat (event-clustered).\n")
    L.append("| target | n (events) | mean c | imb3 | micro-price | imb1 | spread | log size |")
    L.append("|---|---|---|---|---|---|---|---|")
    for k, v in b["results"].items():
        cf = v["coef"]
        L.append(f"| {k} | {v['n']} ({v['n_events']}) | {v['mean_c']:.2f} | " + " | ".join(f"{cf[f][0]:+.2f} (t {cf[f][1]:.1f})" for f in ("imb3", "micro", "imb1", "spread", "lq")) + " |")
open(os.path.join(RES, "summary.md"), "w").write("\n".join(L) + "\n")
print(len(L), "lines")
