"""KXAVGTK<city>: 'at least N consecutive days in the Sun-Sat week with daily average temp (high+low)/2 > 90F'.
Cheapest model: NBS TXN highs and lows -> daily average with the house's station biases, sd from the house's temperature model scale (spreadScale*XND, floor, bias uncertainty), AR(1) day-to-day error, Monte Carlo run-length probability. Compared with Kalshi's mid, and tails/favourites scored."""
import sys, os, re
sys.path.insert(0, os.path.dirname(__file__))
from edges import *
cfg = json.load(open(os.path.join(D, '../../../../content/config/temperature-markets.json')))['models']
TKS = {'SAN':'KSAN','PHX':'KPHX','LAS':'KLAS','IAH':'KIAH','DEN':'KDEN','SAT':'KSAT','DFW':'KDFW','AUS':'KAUS','MSY':'KMSY','OKC':'KOKC'}
rng = np.random.default_rng(7)
OBS = {}
def obs(stn):
    if stn not in OBS:
        OBS[stn] = {r['valid']: (r['high'] + r['low']) / 2 for r in json.load(open(f'{D}/cli/{stn}.json'))['results'] if isinstance(r.get('high'), (int, float)) and isinstance(r.get('low'), (int, float))}
    return OBS[stn]
def day_stats(g, run, d, kind):
    ft = pd.Timestamp(datetime(d.year, d.month, d.day, tzinfo=timezone.utc)) + pd.Timedelta(hours=24 if kind == 'high' else 12)
    r = g[(g.runtime == run) & (g.ftime == ft) & g.txn.notna()]
    if r.empty: return None
    m = cfg[kind]; xnd = r.xnd.iloc[0] if pd.notna(r.xnd.iloc[0]) else 2.0
    return r.txn.iloc[0], math.sqrt((m['spreadScale'] * xnd) ** 2 + m['scaleFloor'] ** 2 + m['biasUncertainty'] ** 2)
def runlen_prob(mu, sd, thr, N, rho=0.5, sims=4000):
    z = np.zeros((sims, len(mu))); e = rng.standard_normal(sims)
    for i in range(len(mu)):
        e = rho * e + math.sqrt(1 - rho ** 2) * rng.standard_normal(sims) if i else e
        z[:, i] = mu[i] + sd[i] * e
    hot = z > thr
    run = np.zeros(sims); best = np.zeros(sims)
    for i in range(len(mu)):
        run = np.where(hot[:, i], run + 1, 0); best = np.maximum(best, run)
    return float((best >= N).mean())
rows = []
for tk, stn in TKS.items():
    g = load_nbs(stn); cs_all = json.load(open(f'{D}/candles-KXAVGTK{tk}.json'))
    for l in open(f'{D}/settled-KXAVGTK{tk}.ndjson'):
        m = json.loads(l); d0 = event_date(m['event_ticker']) - timedelta(days=6); N = int(m['floor_strike'])
        thr = float(re.search(r'strictly greater than (\d+)', m['rules_primary']).group(1))
        zone = RAIN_STN.get(tk, (None, 'America/Chicago'))[1]
        zone = {'SAN':'America/Los_Angeles','PHX':'America/Phoenix','LAS':'America/Los_Angeles','IAH':'America/Chicago','DEN':'America/Denver','SAT':'America/Chicago','DFW':'America/Chicago','AUS':'America/Chicago','MSY':'America/Chicago','OKC':'America/Chicago'}[tk]
        z = ZoneInfo(zone); cs = sorted(cs_all.get(m['ticker']) or [], key=lambda c: c['end_period_ts'])
        for lab, dd, hh in (('Wed 15h', d0 + timedelta(days=3), 15), ('Fri 15h', d0 + timedelta(days=5), 15)):
            t = pd.Timestamp(datetime(dd.year, dd.month, dd.day, hh, tzinfo=z)).tz_convert('UTC')
            if t < pd.Timestamp(m['open_time']) or t > pd.Timestamp(m['close_time']): continue
            runs = g[g.runtime <= t - pd.Timedelta(hours=2)]
            if runs.empty: continue
            rt = runs.runtime.max(); mu = []; sd = []; ok = True
            ld = dd  # local decision date; days before it are observed
            for k in range(7):
                d = d0 + timedelta(days=k)
                if d < ld:
                    o = obs(stn).get(str(d))
                    if o is None: ok = False; break
                    mu.append(o); sd.append(0.3); continue
                h = day_stats(g, rt, d, 'high'); lo = day_stats(g, rt, d, 'low')
                if h is None or lo is None:
                    if not mu: ok = False; break
                    mu.append(float(np.mean(mu[-3:]))); sd.append(3.5); continue
                mu.append((h[0] + cfg['high']['stationBias'].get(stn, 0) + lo[0] + cfg['low']['stationBias'].get(stn, 0)) / 2)
                sd.append(0.5 * math.sqrt(h[1] ** 2 + lo[1] ** 2 + 2 * 0.3 * h[1] * lo[1]))
            if not ok: continue
            p = runlen_prob(np.array(mu), np.array(sd), thr, N)
            last = None
            for c in cs:
                if c['end_period_ts'] <= t.timestamp(): last = c
            if last is None: continue
            b = float(last['yes_bid']['close_dollars'] or 0); a = float(last['yes_ask']['close_dollars'] or 1)
            if a <= b: continue
            rows.append(dict(ticker=m['ticker'], city=tk, week=str(d0), N=N, dec=lab, t=t.isoformat(), p=p, bid=b, ask=a, mid=(a + b) / 2, y=int(m['result'] == 'yes')))
df = pd.DataFrame(rows); df.to_csv(f'{D}/avgt-scored.csv', index=False)
br = lambda p, y: float(np.mean((p - y) ** 2))
t = []
for dec, gg in df.groupby('dec'): t.append(dict(decision=dec, n=len(gg), yes_rate=round(gg.y.mean(), 3), brier_model=round(br(gg.p, gg.y), 4), brier_mid=round(br(gg.mid, gg.y), 4)))
out = ['# KXAVGTK* weekly average temperature (>= N consecutive days with (hi+lo)/2 > 90F) -- 10 cities, 6 weeks; decisions Wed/Fri 15h with the elapsed days observed (IEM climate reports) and NBS (reaches ~3.7 days) for the rest', '', md(pd.DataFrame(t), index=False), '']
cal = df.assign(bin=pd.cut(df.p, [-.01, .02, .1, .3, .6, .9, 1.0])).groupby('bin', observed=True).agg(n=('y', 'size'), model=('p', 'mean'), mid=('mid', 'mean'), yes=('y', 'mean')).round(3)
out += [md(cal), '']
cands = []
for kind, mask in (('tail_sell', (df.p <= 0.02) & (df.bid >= 0.03) & (df.bid <= 0.10)), ('fav_buy', (df.p >= 0.97) & (df.ask <= 0.97) & (df.ask > 0.5))):
    c = df[mask].sort_values('t').drop_duplicates('ticker').copy(); c['kind'] = kind; cands.append(c)
allc = pd.concat(cands); allc.to_csv(f'{D}/avgt-cand-full.csv', index=False); allc[['ticker']].drop_duplicates().to_csv(f'{D}/avgt-cand.csv', index=False)
out.append(f'candidates: tails {len(cands[0])} (wrong {int(cands[0].y.sum())}), favourites {len(cands[1])} (wrong {int((1-cands[1].y).sum())})')
open(f'{R}/avg-temp.md', 'w').write('\n'.join(out)); print('\n'.join(out))
