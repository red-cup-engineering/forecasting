"""usage: fetch_range.py SERIES kind(crypto|idx) hours(comma) [days]"""
import sys, json, os, datetime as dt, time
sys.path.insert(0,'scripts')
from kfetch import *
from common import ts, snapshot
S, kind, hours = sys.argv[1], sys.argv[2], [int(h) for h in sys.argv[3].split(',')]
OFFS = [240, 120, 60, 30, 10]
days = int(sys.argv[4]) if len(sys.argv) > 4 else 58
os.makedirs("data/range", exist_ok=True)
out = f"data/range/{S}.json"
res = json.load(open(out)) if os.path.exists(out) else {}
MON = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()
today = dt.date(2026, 10, 3)
for k in range(1, days):
    d = today - dt.timedelta(days=k)
    if kind == 'idx' and d.weekday() >= 5: continue
    for h in hours:
        ev = f"{S}-{d.strftime('%y')}{MON[d.month-1]}{d.day:02d}" + (f"H{h:02d}00" if kind == 'idx' else f"{h:02d}")
        if ev in res: continue
        try: ms = kget("/markets", event_ticker=ev, status="settled", limit=1000)['markets']
        except Exception as e: print('err', ev, e); continue
        if not ms: res[ev] = None; continue
        vals = [float(m['expiration_value']) for m in ms if m.get('expiration_value') not in (None, '')]
        if not vals: res[ev] = None; continue
        ST = vals[0]; ct = ts(ms[0]['close_time'])
        tol = 0.07 if kind == 'crypto' else 0.035
        keep = [m for m in ms if m.get('floor_strike') is not None and abs(m['floor_strike']/ST-1) <= tol]
        candles = {}
        for i in range(0, len(keep), 30):
            ch = keep[i:i+30]
            try:
                r = kget("/markets/candlesticks", market_tickers=",".join(m['ticker'] for m in ch), start_ts=ct-int(4.2*3600), end_ts=ct, period_interval=1)
            except Exception as e: print('cerr', ev, e); continue
            for mk in r.get('markets', []):
                cs = mk['candlesticks']
                candles[mk['market_ticker']] = {str(o): snapshot(cs, ct-o*60, max_age=8*60) for o in OFFS}
        res[ev] = dict(close=ct, ST=ST, markets=[{k: m.get(k) for k in ['ticker', 'floor_strike', 'strike_type', 'result', 'close_time', 'cap_strike']} for m in keep], candles=candles)
        print(ev, len(ms), len(keep), flush=True)
    json.dump(res, open(out, "w"))
json.dump(res, open(out, "w"))
