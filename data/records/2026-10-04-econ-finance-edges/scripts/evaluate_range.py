"""usage: evaluate_range.py SERIES kind(crypto|idx) [horizon_hours ...]  -> reads results/SERIES_rows.json"""
import sys, json, math, subprocess, numpy as np, collections
from scipy.stats import norm
S = sys.argv[1]; kind = sys.argv[2]; HS = [float(x) for x in sys.argv[3:]]
R = json.load(open(f"data/rows/{S}_rows.json"))
def T_of(r): return r['hb']/(365*24) if kind == 'crypto' else (r['hb'])/(6.5*252)
def pmodel(r, c, base='sd'):
    s = r[base]*c; T = T_of(r)
    return 1-norm.cdf((math.log(r['X']/r['S0'])+0.5*s*s*T)/(s*math.sqrt(T)))
clip = lambda p: min(max(p, 0.01), 0.99)
def ll(p, y): p = clip(p); return -(y*math.log(p)+(1-y)*math.log(1-p))
for H in HS:
    G = [r for r in R if abs(r['hb']-H) < 1e-9 and 0.02 <= r['mid'] <= 0.98 and r['ask']-r['bid'] <= 0.08]
    if not G: continue
    days = sorted(set(r['D'] for r in G)); cut = days[int(len(days)*0.6)]
    tr = [r for r in G if r['D'] <= cut]
    cs = np.arange(0.3, 1.31, 0.05)
    best = min(cs, key=lambda c: np.mean([ll(pmodel(r, c), r['y']) for r in tr]))
    bestr = min(cs, key=lambda c: np.mean([ll(pmodel(r, c, 'rv'), r['y']) for r in tr]))
    print(f"\n===== {S} horizon {H}h: {len(G)} rows (0.02<=mid<=0.98), {len(days)} days, train<= {cut}; fitted vol scale on train: DVOL/VIX x{best:.2f}, RV x{bestr:.2f}")
    # realized dispersion
    evs = {r['ev']: r for r in G}
    zs = np.array([math.log(r['ST']/r['S0'])/(r['sd']*math.sqrt(T_of(r))) for r in evs.values()])
    zr = np.array([math.log(r['ST']/r['S0'])/(r['rv']*math.sqrt(T_of(r))) for r in evs.values()])
    print(f"   realized move / model sd: sd z(implied vol)={zs.std():.2f} z(realized-vol)={zr.std():.2f}  (1.00 = model sd right); events={len(evs)}")
    for r in G:
        r['pc'] = pmodel(r, best); r['ev'] = r['D']; r['pn_raw'] = r['pn']
    # implied-vol ratio from Kalshi mid by moneyness
    print("   Kalshi-implied sigma / model sigma (median) by |z| bin and side; mean(mid-pc) ; freq YES vs mean mid:")
    bins = [(-9, -2), (-2, -1), (-1, -0.5), (-0.5, 0), (0, 0.5), (0.5, 1), (1, 2), (2, 9)]
    for lo, hi in bins:
        g = [r for r in G if lo <= r['z'] < hi]
        if len(g) < 15: continue
        ratios = []
        for r in g:
            if 0.03 < r['mid'] < 0.97 and abs(math.log(r['X']/r['S0'])) > 1e-6:
                zk = norm.ppf(1-r['mid']); L = math.log(r['X']/r['S0']); T = T_of(r)
                if abs(zk) > 0.1 and zk*L > 0: ratios.append(L/(zk*math.sqrt(T))/r['sd'])
        print(f"   z[{lo:+.1f},{hi:+.1f}) n={len(g):4d} impl/DVOL={np.median(ratios) if ratios else float('nan'):.2f}  mean(mid)={np.mean([r['mid'] for r in g]):.3f} mean(model c)={np.mean([r['pc'] for r in g]):.3f} freq={np.mean([r['y'] for r in g]):.3f}")
    json.dump(G, open(f"data/rows/{S}_h{H}_rows.json", "w"))
    for pc in ('pn', 'pc'):
        print(f"--- evaluator vs reference '{pc}' ({'raw implied-vol lognormal' if pc=='pn' else 'vol-scaled lognormal, scale fitted on train'}) ---")
        out = subprocess.run([sys.executable, 'scripts/evaluate_probs.py', f"data/rows/{S}_h{H}_rows.json", cut, pc], capture_output=True, text=True).stdout
        print("\n".join(l for l in out.splitlines() if 'no trades' not in l))
