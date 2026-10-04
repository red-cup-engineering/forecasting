"""One row per (KXRAIN market, decision time): NBS rain features from the newest run issued >=2h before, Kalshi bid/ask at that time, settled result.
Decision times (local clock): day-before 15:00, day-before 21:00, day-of 07:00."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from common import *
LAG = pd.Timedelta(hours=2)
nbs = {}
mk = [json.loads(l) for l in open(f'{D}/settled-KXRAIN.ndjson')]
cand = json.load(open(f'{D}/candles-KXRAIN.json'))
rows = []
for m in mk:
    code = m['ticker'].split('-')[-1]
    if code not in RAIN_STN: continue
    stn, zone = RAIN_STN[code]
    if stn not in nbs: nbs[stn] = load_nbs(stn)
    g = nbs[stn]
    if g is None: continue
    d = event_date(m['event_ticker']); z = ZoneInfo(zone)
    ws, we = lst_window(d, zone)
    cs = cand.get(m['ticker']) or []
    cs = sorted(cs, key=lambda c: c['end_period_ts'])
    for lab, dd, hh in (('D-1 15h', d - timedelta(days=1), 15), ('D-1 21h', d - timedelta(days=1), 21), ('D 07h', d, 7)):
        t = pd.Timestamp(datetime(dd.year, dd.month, dd.day, hh, tzinfo=z)).tz_convert('UTC')
        if t < pd.Timestamp(m['open_time']) or t > pd.Timestamp(m['close_time']): continue
        runs = g[g.runtime <= t - LAG]
        if runs.empty: continue
        rt = runs.runtime.max()
        if t - rt > pd.Timedelta(hours=12): continue
        r = g[g.runtime == rt]
        # 6h periods ending e, covering (e-6h, e], whose midpoint lies in the climate day
        sub = r[(r.ftime - pd.Timedelta(hours=3) > ws) & (r.ftime - pd.Timedelta(hours=3) < we) & r.p06.notna()]
        if len(sub) < 3: continue
        p = sub.p06.values / 100; q = sub.q06.fillna(0).values
        # prior hours of the day already elapsed at t (D 07h) are in the past: keep them, the run still reports them as forecast hours of its own horizon
        # candle at decision time
        last = None
        for c in cs:
            if c['end_period_ts'] <= t.timestamp(): last = c
        if last is None: continue
        b = float(last['yes_bid']['close_dollars'] or 0) if last['yes_bid'] else 0; a = float(last['yes_ask']['close_dollars'] or 1) if last['yes_ask'] else 1
        rows.append(dict(ticker=m['ticker'], code=code, stn=stn, date=str(d), dec=lab, t=t.isoformat(), run=rt.isoformat(), n_per=len(sub), pmax=p.max(), pany=1 - np.prod(1 - p), psum=p.sum(), qsum=q.sum(), qmax=q.max(), bid=b, ask=a, y=int(m['result'] == 'yes'), close=m['close_time'], vol=float(m['volume_fp'] or 0)))
df = pd.DataFrame(rows); df.to_csv(f'{D}/rain-dataset.csv', index=False)
print(len(df), df.dec.value_counts().to_dict(), df.y.mean())
