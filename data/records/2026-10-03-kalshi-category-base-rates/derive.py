"""Derive content/config/kalshi-category-base-rates.json from the 2026-10-03 survey.

Inputs (not kept here; about 60 MB; re-fetched by the survey scripts named in README.md):
  settled-sample.json   stratified sample (<=1500 per category) of settled, mve-excluded Kalshi markets that
                        closed 2026-09-29..2026-10-03 with volume >= 10, each with hourly candlesticks
  gas-rows.json         every settled AAA/diesel daily-series market, quotes at 1/2/4/8/16h before close
Usage: python3 derive.py <survey-dir> <out.json>
"""
import json, math, sys, collections

survey, out = sys.argv[1], sys.argv[2]
S = json.load(open(f"{survey}/settled-sample.json"))
G = json.load(open(f"{survey}/gas-rows.json"))

def wilson(k, n, z=1.96):
    if n == 0: return [None, None]
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d; h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(max(0, c - h), 4), round(min(1, c + h), 4)]

def quote(m, h):
    t = m["close"] - h * 3600
    cs = [c for c in m["candles"] if c["end_period_ts"] <= t]
    if not cs: return None
    c = cs[-1]
    b = float(c["yes_bid"]["close_dollars"] or 0); a = float(c["yes_ask"]["close_dollars"] or 0)
    if not (0 < b < a < 1) or a - b > 0.1: return None
    return b, a

def band(rows):
    n = len(rows); k = sum(r[2] for r in rows)
    return {"n": n, "yesCount": k, "yesRate": round(k / n, 4) if n else None, "yesRate95": wilson(k, n),
            "avgYesAsk": round(sum(r[1] for r in rows) / n, 4) if n else None}

categories = {}
for H in (24, 6, 2):
    by = collections.defaultdict(list)
    for m in S:
        q = quote(m, H)
        if q: by[m["cat"]].append((q[0], q[1], 1 if m["result"] == "yes" else 0))
    for cat, R in by.items():
        mid = [(b + a) / 2 for b, a, _ in R]
        brier = sum((p - y) ** 2 for p, (_, _, y) in zip(mid, R)) / len(R)
        categories.setdefault(cat, {})[str(H)] = {
            "markets": len(R), "brierOfMid": round(brier, 4),
            "longshot": band([r for r in R if r[1] <= 0.05]),     # YES ask <= 5c
            "favorite": band([r for r in R if r[1] >= 0.95]),     # YES ask >= 95c
        }

families = {}
fam = collections.defaultdict(list)
for r in G:
    fam["KXAAAGASD*" if r["s"].startswith("KXAAAGASD") else r["s"] + "*" if r["s"].startswith("KXDIESEL") else r["s"]].append(r)
for name, R in fam.items():
    for H in (1, 2, 4, 8, 16):
        rows = [r for r in R if r["H"] == H]
        fav = [(r["b"], r["a"], r["y"]) for r in rows if 0.94 <= r["b"] <= 0.98]
        lng = [(r["b"], r["a"], r["y"]) for r in rows if 0.02 <= r["a"] <= 0.06]
        if len(fav) + len(lng) < 30: continue
        families.setdefault(name, {})[str(H)] = {
            "favorite": {**band(fav), "avgYesBid": round(sum(x[0] for x in fav) / len(fav), 4) if fav else None},
            "longshot": band(lng)}

json.dump({
    "description": "Base rates by Kalshi category: how often a near-close longshot (YES ask <= 5c) settles YES and a near-close favorite (YES ask >= 95c) settles YES, from settled markets, at 24/6/2 hours before close.",
    "derivedAt": "2026-10-03",
    "window": ["2026-09-29", "2026-10-03"],
    "method": "category sample: settled-sample.json (stratified, volume >= 10, two-sided quote with spread <= 10c at the horizon); family sample: every settled market of the named daily published-series family, favorite = YES bid 94-98c, longshot = YES ask 2-6c. yesRate95 is a Wilson interval.",
    "caveat": "Four days of settlement (family sample: Aug 2026 through Sep 30) is one regime. Small n bands are leads, not facts; the Mentions favorite band (85.7% at 24h, n=14) is the one persistent miss, longshots there are UNDERpriced at near-close (16.7% at 6h, n=6).",
    "categories": categories,
    "families": families,
}, open(out, "w"), indent=2)
print("categories", len(categories), "families", list(families))
