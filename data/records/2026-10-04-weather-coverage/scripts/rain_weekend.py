"""KXRAINWKND (rain on any day of Sat-Sun): NBS P06 over the two climate days -> same logistic as the daily model (weights fit on all daily D-1 15h rows) -> Brier vs mid, edges."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
from scipy.optimize import minimize
from edges import *
daily = pd.read_csv(f'{D}/rain-dataset.csv'); daily = daily[daily.dec == 'D-1 15h']
lg = lambda p: np.log(np.clip(p, 1e-3, 1 - 1e-3) / (1 - np.clip(p, 1e-3, 1 - 1e-3)))
x = np.column_stack([np.ones(len(daily)), lg(daily.pany.values)]); y = daily.y.values.astype(float)
w = minimize(lambda w: -(y * (x @ w) - np.log1p(np.exp(x @ w))).sum(), np.zeros(2), method='BFGS').x
sig = lambda z: 1 / (1 + np.exp(-z))
mk = [json.loads(l) for l in open(f'{D}/settled-KXRAINWKND.ndjson')]
cand = json.load(open(f'{D}/candles-KXRAINWKND.json')); nbs = {}
rows = []
for m in mk:
    code = m['ticker'].split('-')[-1]
    if code not in RAIN_STN: continue
    stn, zone = RAIN_STN[code]
    if stn not in nbs: nbs[stn] = load_nbs(stn)
    g = nbs[stn]
    if g is None: continue
    d = event_date(m['event_ticker']); z = ZoneInfo(zone)
    ws, _ = lst_window(d, zone); _, we = lst_window(d + timedelta(days=1), zone)
    cs = sorted(cand.get(m['ticker']) or [], key=lambda c: c['end_period_ts'])
    for lab, dd, hh in (('Thu 15h', d - timedelta(days=2), 15), ('Fri 15h', d - timedelta(days=1), 15), ('Fri 21h', d - timedelta(days=1), 21), ('Sat 07h', d, 7)):
        t = pd.Timestamp(datetime(dd.year, dd.month, dd.day, hh, tzinfo=z)).tz_convert('UTC')
        if t < pd.Timestamp(m['open_time']) or t > pd.Timestamp(m['close_time']): continue
        runs = g[g.runtime <= t - pd.Timedelta(hours=2)]
        if runs.empty: continue
        rt = runs.runtime.max(); r = g[g.runtime == rt]
        sub = r[(r.ftime - pd.Timedelta(hours=3) > ws) & (r.ftime - pd.Timedelta(hours=3) < we) & r.p06.notna()]
        if len(sub) < 6: continue
        pany = 1 - np.prod(1 - sub.p06.values / 100)
        last = None
        for c in cs:
            if c['end_period_ts'] <= t.timestamp(): last = c
        if last is None: continue
        b = float(last['yes_bid']['close_dollars'] or 0); a = float(last['yes_ask']['close_dollars'] or 1)
        if a <= b: continue
        rows.append(dict(ticker=m['ticker'], date=str(d), dec=lab, t=t.isoformat(), pany=pany, pm=sig(w[0] + w[1] * lg(pany)), bid=b, ask=a, mid=(a + b) / 2, y=int(m['result'] == 'yes')))
df = pd.DataFrame(rows); df.to_csv(f'{D}/rain-wknd-scored.csv', index=False)
out = ['# KXRAINWKND (weekend rain) -- 6 weekends, 133 markets', '', f'Daily-fit logistic weights {np.round(w,3).tolist()} applied to P(any rain) over Sat+Sun from NBS P06. In-sample for the daily model, out-of-sample for the weekend contract.', '']
br = lambda p, y: float(np.mean((p - y) ** 2))
t = []
for dec, g in df.groupby('dec'): t.append(dict(decision=dec, n=len(g), yes_rate=round(g.y.mean(), 3), brier_model=round(br(g.pm, g.y), 4), brier_mid=round(br(g.mid, g.y), 4), brier_pool=round(br(sig(.5 * lg(g.pm) + .5 * lg(g.mid)), g.y), 4)))
out += [md(pd.DataFrame(t), index=False), '']
# tails and favourites
cands = []
for kind, mask in (('tail_sell', (df.pm <= 0.03) & (df.bid >= 0.03) & (df.bid <= 0.10)), ('fav_buy', (df.pm >= 0.97) & (df.ask <= 0.97) & (df.ask > 0.5))):
    c = df[mask].sort_values('t').drop_duplicates('ticker').copy(); c['kind'] = kind; cands.append(c)
allc = pd.concat(cands); allc[['ticker']].drop_duplicates().to_csv(f'{D}/rain-wknd-cand.csv', index=False)
allc.to_csv(f'{D}/rain-wknd-cand-full.csv', index=False)
out.append(f'candidates: tails {len(cands[0])}, favourites {len(cands[1])}')
open(f'{R}/rain-weekend.md', 'w').write('\n'.join(out)); print('\n'.join(out))
