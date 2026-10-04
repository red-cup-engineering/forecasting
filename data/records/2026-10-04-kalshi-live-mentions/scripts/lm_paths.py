"""Volume / price-path description around the jump for YES markets (cached trade tapes). usage: lm_paths.py CACHE SETS.json"""
import sys, os, json, bisect, statistics as st
CACHE, SETS = sys.argv[1], sys.argv[2]; os.environ['LM_CACHE'] = CACHE
sys.path.insert(0, os.path.dirname(__file__))
import lm_lib as L
evs = {e['event']: e for e in json.load(open('results/events.json'))}
R = []
for cfg in json.load(open(SETS)):
    e = evs[cfg['event']]; close = L.iso(e['close'])
    for m in e['markets']:
        if m['result'] != 'yes' or float(m['volume_fp'] or 0) < 300: continue
        tr = L.get_trades(m['ticker'])
        if len(tr) < 5: continue
        ts = [x[0] for x in tr]; J = None; low = None
        for t, p, c, s in tr:
            if p < 0.8: low = t
            elif p >= 0.9 and low is not None: J = t; break
        if J is None: continue
        tot = sum(c for _, _, c, _ in tr)
        def pr(t):
            i = bisect.bisect_right(ts, t) - 1; return tr[i][1] if i >= 0 else None
        R.append(dict(ev=cfg['event'], tot=tot, pre_frac=sum(c for t, _, c, _ in tr if t < J) / tot, last4h=sum(c for t, _, c, _ in tr if t > close - 4 * 3600) / tot,
                      jump_to_close_min=(close - J) / 60, p_1h=pr(J - 3600), p_10m=pr(J - 600), p_1m=pr(J - 60), n_trades_J60=sum(1 for t, *_ in tr if J - 60 <= t <= J + 60),
                      jump_vol_pm60=sum(c for t, _, c, _ in tr if J - 60 <= t <= J + 60)))
print('n markets', len(R), 'events', len({r['ev'] for r in R}))
for k in ('tot', 'pre_frac', 'last4h', 'jump_to_close_min', 'p_1h', 'p_10m', 'p_1m', 'n_trades_J60', 'jump_vol_pm60'):
    v = sorted(r[k] for r in R if r[k] is not None); q = lambda x: v[min(len(v) - 1, int(x * len(v)))]
    print('%-18s p25 %9.2f median %9.2f p75 %9.2f' % (k, q(.25), q(.5), q(.75)))
