"""Historical-tier KXBTCD/KXETHD hour-17 events (before 2026-08-05) with compact snapshots. usage: fetch_range_hist.py SERIES days_back_from_2026_08_05 [hour]"""
import sys, json, os, datetime as dt
sys.path.insert(0,'scripts')
from kfetch import *
from common import ts, snapshot
S = sys.argv[1]; NB = int(sys.argv[2]); H = int(sys.argv[3]) if len(sys.argv) > 3 else 17
OFFS = [240, 120, 60, 30, 10]
out = f"data/range/{S}.hist.json"
res = json.load(open(out)) if os.path.exists(out) else {}
MON = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split()
for k in range(0, NB):
    d = dt.date(2026, 8, 5)-dt.timedelta(days=k)
    ev = f"{S}-{d.strftime('%y')}{MON[d.month-1]}{d.day:02d}{H:02d}"
    if ev in res: continue
    try: ms = kget("/historical/markets", event_ticker=ev, limit=1000).get('markets', [])
    except Exception as e: print('err', ev, e); continue
    ms = [m for m in ms if m.get('result') in ('yes', 'no')]
    if not ms: res[ev] = None; continue
    vals = [float(m['expiration_value']) for m in ms if m.get('expiration_value') not in (None, '')]
    if not vals: res[ev] = None; continue
    ST = vals[0]; ct = ts(ms[0]['close_time'])
    keep = [m for m in ms if m.get('floor_strike') is not None and abs(m['floor_strike']/ST-1) <= 0.07]
    candles = {}
    for m in keep:
        try:
            c = kget("/historical/markets/%s/candlesticks" % m['ticker'], start_ts=ct-int(4.2*3600), end_ts=ct, period_interval=1).get('candlesticks', [])
        except Exception as e: continue
        candles[m['ticker']] = {str(o): snapshot(c, ct-o*60, max_age=45*60) for o in OFFS}
    res[ev] = dict(close=ct, ST=ST, markets=[{kk: m.get(kk) for kk in ['ticker', 'floor_strike', 'strike_type', 'result', 'close_time']} for m in keep], candles=candles)
    print(ev, len(ms), len(keep), flush=True)
    if k % 5 == 0: json.dump(res, open(out, "w"))
json.dump(res, open(out, "w"))
