"""Kalshi CPI-family brackets vs Cleveland Fed nowcast (point-in-time, evening before release).
usage: analyze_cpi.py KXCPI cpi | KXCPICORE core"""
import sys, json, re, math, datetime as dt, collections
import numpy as np
from scipy.stats import norm, t as tdist
from common import *
S, KEY = sys.argv[1], sys.argv[2]
mk = load_markets(S); cd = json.load(open(f"data/candles/{S}.json"))
cle = json.load(open("data/ext/cleveland_daily.json"))
MON = {m: i+1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
def target(ev):
    m = re.search(r"-(\d\d)([A-Z]{3})$", ev)
    if not m: return None
    return f"20{m.group(1)}-{MON[m.group(2)]:02d}"
# Cleveland history of errors (actual unrounded minus last nowcast before the release day) -> used for walk-forward sd
def last_nowcast(tm, before):  # before: ISO date string, exclusive
    rec = [r for r in cle.get(tm, []) if r[KEY if KEY!='cpi' else 'cpi'] is not None and r['date'] < before]
    return rec[-1][KEY] if rec else None
def actual(tm):
    a = [r['a'+KEY] for r in cle.get(tm, []) if r['a'+KEY] is not None]
    return a[-1] if a else None
events = collections.defaultdict(list)
for t, m in mk.items():
    if t in cd and m.get('result') in ('yes', 'no') and m.get('strike_type','greater') in ('greater', 'greater_or_equal') and re.search(r'-T-?[0-9.]+$', t): events[m['event_ticker']].append(m)
rows = []; evinfo = {}
for ev, ms in events.items():
    D = ms[0]['close_time'][:10]; tm = target(ev)
    if tm is None: print('skip event',ev); continue
    n = last_nowcast(tm, D)
    if n is None: continue
    try: act = float([m['expiration_value'] for m in ms if m['expiration_value'] not in ('', None)][0])
    except Exception: continue
    evinfo[ev] = dict(D=D, tm=tm, n=n, act=act)
# walk-forward error sd: all Cleveland-history months strictly before the event's release (errors of nowcast vs unrounded actual)
hist = []
for tm in sorted(cle):
    a = actual(tm)
    rec = [r for r in cle[tm] if r[KEY] is not None]
    if a is not None and rec:
        # release date unknown here: take nowcast on the last day before the actual first appears
        first_act = [r['date'] for r in cle[tm] if r['a'+KEY] is not None]
        before = first_act[0] if first_act else '9999'
        pre = [r for r in rec if r['date'] < before]
        if pre: hist.append((tm, pre[-1][KEY], a))
print("cleveland history months:", len(hist), "overall RMSE", np.sqrt(np.mean([(a-n)**2 for _, n, a in hist])))
def sd_for(tm, K=48):
    e = [a-n for t, n, a in hist if t < tm][-K:]
    if len(e) < 12: return 0.12
    return max(0.06, float(np.sqrt(np.mean(np.square(e)))))
def rsd_for(tm, K=48):
    e = np.array([a-n for t, n, a in hist if t < tm][-K:])
    if len(e) < 12: return 0.10
    return max(0.05, float(1.4826*np.median(np.abs(e-np.median(e)))))
def bias_for(tm, K=48):
    e = [a-n for t, n, a in hist if t < tm][-K:]
    return float(np.mean(e)) if len(e) >= 12 else 0.0
TENTH = 0.05
for ev, ms in events.items():
    if ev not in evinfo: continue
    I = evinfo[ev]; D = I['D']
    entry = ts(D+"T00:00:00") - 3*3600  # 21:00Z the evening before
    sd = sd_for(I['tm']); mu = I['n'] + bias_for(I['tm'])
    for m in ms:
        s = snapshot(cd[m['ticker']], entry)
        if not s or s['bid'] is None or s['ask'] is None: continue
        X = m['floor_strike'] if m.get('floor_strike') is not None else float(re.search(r'-T(-?[0-9.]+)$', m['ticker']).group(1))
        m.setdefault('strike_type','greater')
        cut = X if m['strike_type'] == 'greater_or_equal' else X + TENTH   # print>X  <=> true>=X+0.05 (single-decimal rounding)
        if m['strike_type'] == 'greater_or_equal': cut = X - TENTH
        pn = 1 - norm.cdf((cut - mu)/sd)
        rs = rsd_for(I['tm']); pr = 1 - norm.cdf((cut - mu)/rs)
        pt = 1 - tdist.cdf((cut - mu)/(sd*math.sqrt(3/5)), 5)  # t5 scaled to same variance
        rows.append(dict(ev=ev, D=D, tk=m['ticker'], X=X, y=int(m['result'] == 'yes'), bid=s['bid'], ask=s['ask'], mid=(s['bid']+s['ask'])/2, pn=pn, pt=pt, pr=pr, vol=s['vol'], act=I['act'], nc=I['n'], sd=sd))
print("events", len(set(r['ev'] for r in rows)), "markets", len(rows))
json.dump(rows, open(f"data/rows/{S}_rows.json", "w"))
