"""Repricing-lag measurement on settled events. For each (event, video): YES markets' first jump to >=0.90 (trade tape)
vs caption-timed utterance. Video t0 wall = release_timestamp - P (P measured from HLS PROGRAM-DATE-TIME on a live stream = 6.09 s).
usage: lm_lag.py CACHE SETS.json P_seconds OUT_PREFIX"""
import sys, os, json, random, statistics as st, csv
CACHE, SETS, P, OUT = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
os.environ['LM_CACHE'] = CACHE
sys.path.insert(0, os.path.dirname(__file__))
import lm_lib as L, re, bisect
evs = {e['event']: e for e in json.load(open('results/events.json'))}
OFFS = [-10, -5, 0, 5, 10, 15, 30, 60]
def strike(m):
    c = m['custom_strike']; return c.get('Word') if isinstance(c, dict) else str(c)
def px_at(tr, ts, t):  # last trade price at or before t
    i = bisect.bisect_right(ts, t) - 1
    return tr[i][1] if i >= 0 else None
def avail(tr, ts, t, w=5.0, cap=0.95):  # contracts bought by YES-takers at <=cap in [t, t+w]
    lo = bisect.bisect_left(ts, t); hi = bisect.bisect_right(ts, t + w)
    return sum(c for _, p, c, s in tr[lo:hi] if s == 'yes' and p <= cap)
rows = []
for cfg in json.load(open(SETS)):
    e = evs[cfg['event']]; vid = cfg['vid']; d = f'{CACHE}/v_{vid}'
    info = json.load(open(d + '.info.json')); rel = info['release_timestamp']; p_off = cfg.get('P', P)
    t0 = rel - p_off; words = L.words_from_json3(d + '.en.json3')
    for m in e['markets']:
        if m['result'] != 'yes' or float(m['volume_fp'] or 0) < 300: continue
        s = strike(m)
        if re.search(r'\(\d+\+', s): continue
        tr = L.get_trades(m['ticker']); ts = [x[0] for x in tr]
        if len(tr) < 5: continue
        # jump: first trade >=0.90 after an earlier trade <0.80, and event window only
        J = None; low = None
        for t, p, c, sd in tr:
            if p < 0.80: low = t
            elif p >= 0.90 and low is not None: J = t; break
        if J is None: continue
        pre = px_at(tr, ts, J - 90)
        u = [t0 + x for x in L.find_utterances(words, s)]
        near = [x for x in u if -90 < J - x < 90]
        if not near: rows.append(dict(event=cfg['event'], vid=vid, ticker=m['ticker'], word=s, matched=0, pre=pre)); continue
        ux = min(near, key=lambda x: abs(J - x))     # utterance best explaining the jump (optimistic: biases lag toward 0)
        r = dict(event=cfg['event'], vid=vid, ticker=m['ticker'], word=s, matched=1, pre=pre, lag=J - ux, n_cand=len(u), vol=float(m['volume_fp']))
        for o in OFFS:
            r[f'p{o}'] = px_at(tr, ts, ux + o); r[f'q{o}'] = avail(tr, ts, ux + o)
        rows.append(r)
json.dump(rows, open(OUT + '_rows.json', 'w'))
M = [r for r in rows if r['matched']]
print('YES markets with jump:', len(rows), 'matched to caption hit:', len(M), 'events', len({r['event'] for r in rows}))
def boot(vals_by_ev, f, B=2000):
    keys = list(vals_by_ev); out = []
    for _ in range(B):
        samp = [x for k in random.choices(keys, k=len(keys)) for x in vals_by_ev[k]]
        out.append(f(samp))
    out.sort(); return out[int(.025 * B)], out[int(.975 * B)]
tradable = [r for r in M if r['pre'] is not None and r['pre'] < 0.8]
print('with pre-jump price<0.80 (a tradable edge existed):', len(tradable))
lags = sorted(r['lag'] for r in tradable)
if lags:
    q = lambda p: lags[min(len(lags) - 1, int(p * len(lags)))]
    print('lag J-u (s) [P=%.1f]: p10 %.1f p25 %.1f median %.1f p75 %.1f p90 %.1f max %.1f' % (P, q(.1), q(.25), q(.5), q(.75), q(.9), lags[-1]))
byev = {}
for r in tradable: byev.setdefault(r['event'], []).append(r)
print('| latency s | n | median price | share <=0.95 | share <=0.90 | EV/ct (pi=1) after fee, mean [event-boot 95%] | EV/ct pi=.9 | filled>=100 share |')
for o in OFFS:
    xs = [(r[f'p{o}'], r[f'q{o}'], r['event']) for r in tradable if r[f'p{o}'] is not None]
    if not xs: continue
    def ev(p, pi=1.0): return pi * (1 - p) - (1 - pi) * p - L.fee(p, 1) if p < 1 else -0.0
    grp = {}
    for p, q_, e_ in xs: grp.setdefault(e_, []).append(ev(p) if p <= 0.97 else 0.0)  # no trade taken above .97
    allv = [v for l in grp.values() for v in l]
    lo, hi = boot(grp, lambda s: sum(s) / len(s))
    ev9 = sum(ev(p, .9) if p <= .97 else 0 for p, _, _ in xs) / len(xs)
    sh95 = sum(p <= .95 for p, _, _ in xs) / len(xs); sh90 = sum(p <= .90 for p, _, _ in xs) / len(xs)
    fill = sum(q_ >= 100 and p <= .95 for p, q_, _ in xs) / len(xs)
    print('| %+d | %d | %.2f | %.2f | %.2f | %+.4f [%+.4f,%+.4f] | %+.4f | %.2f |' % (o, len(xs), st.median(p for p, _, _ in xs), sh95, sh90, sum(allv) / len(allv), lo, hi, ev9, fill))
with open(OUT + '_rows.csv', 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=sorted({k for r in rows for k in r})); w.writeheader(); w.writerows(rows)
