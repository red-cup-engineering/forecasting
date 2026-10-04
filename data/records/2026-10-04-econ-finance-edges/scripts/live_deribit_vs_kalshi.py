"""One live snapshot: Deribit option smile -> risk-neutral P(S_T>K) at Kalshi's settle time vs Kalshi books. usage: live_deribit_vs_kalshi.py BTC|ETH [event_ticker]"""
import sys, json, time, math, re, datetime as dt, urllib.request, urllib.parse
import numpy as np
from math import log, sqrt
from scipy.stats import norm
sys.path.insert(0, 'scripts')
from kfetch import kget
cur = sys.argv[1]; series = {'BTC': 'KXBTCD', 'ETH': 'KXETHD'}[cur]
def dget(m, **q):
    u = "https://www.deribit.com/api/v2/public/"+m+"?"+urllib.parse.urlencode(q)
    return json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "research-561"}), timeout=40).read())['result']
now = time.time()
if len(sys.argv) > 2: ev = sys.argv[2]
else:
    # next 17:00 EDT (21:00Z) close
    d = dt.datetime.utcfromtimestamp(now)
    tgt = d.replace(hour=21, minute=0, second=0, microsecond=0)
    if tgt.timestamp() < now+1800: tgt += dt.timedelta(days=1)
    edt = tgt-dt.timedelta(hours=4)
    ev = f"{series}-{edt.strftime('%y')}{edt.strftime('%b').upper()}{edt.day:02d}{edt.hour:02d}"
mk = kget("/markets", event_ticker=ev, status="open", limit=1000)['markets']
close = dt.datetime.strptime(mk[0]['close_time'][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=dt.timezone.utc).timestamp()
print("event", ev, "markets", len(mk), "to close (h)", round((close-now)/3600, 2))
summ = dget("get_book_summary_by_currency", currency=cur, kind="option")
S0 = summ[0]['underlying_price'] if False else None
byexp = {}
MON = {m: i+1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
for s in summ:
    m = re.match(rf"{cur}-(\d+)([A-Z]{{3}})(\d\d)-(\d+)-([CP])", s['instrument_name'])
    if not m or not s.get('mark_iv'): continue
    d_, mo, yy, K, cp = m.groups()
    exp = dt.datetime(2000+int(yy), MON[mo], int(d_), 8, tzinfo=dt.timezone.utc).timestamp()
    byexp.setdefault(exp, []).append((float(K), cp, s['mark_iv']/100, s['underlying_price'], s.get('open_interest', 0)))
exps = sorted(e for e in byexp if e > now)
lo = [e for e in exps if e <= close][-1:]; hi = [e for e in exps if e > close][:1]
print("bracketing expiries", [dt.datetime.utcfromtimestamp(e).isoformat() for e in lo+hi])
idx = dget("get_index_price", index_name=f"{cur.lower()}_usd")['index_price']
def smile(e):
    pts = {}
    for K, cp, iv, F, oi in byexp[e]:
        # use OTM options only
        if (cp == 'C' and K >= F) or (cp == 'P' and K < F): pts[K] = (iv, F)
    Ks = np.array(sorted(pts)); ivs = np.array([pts[k][0] for k in Ks]); F = np.median([pts[k][1] for k in Ks])
    k = np.log(Ks/F); m = (np.abs(k) < 0.25)
    co = np.polyfit(k[m], ivs[m], 4)
    return F, co
def tv(e, kk, F, co):  # total variance at log-moneyness kk (relative to that expiry's forward)
    iv = np.polyval(co, np.clip(kk, -0.25, 0.25)); T = (e-now)/(365*86400)
    return iv*iv*T, iv
rows = []
sm = {e: smile(e) for e in lo+hi}
for m in mk:
    K = m['floor_strike']; 
    # interpolate total variance in time at fixed log-strike relative to spot idx
    def w_at(e):
        F, co = sm[e]; return tv(e, math.log(K/F), F, co)[0], e
    ws = [w_at(e) for e in lo+hi]
    if len(ws) == 2:
        (w1, e1), (w2, e2) = ws; a = (close-e1)/(e2-e1); w = w1*(1-a)+w2*a
    else: w = ws[0][0]*((close-now)/(ws[0][1]-now))
    # digital via finite difference on call prices in strike with smile at this maturity
    def call(KK):
        ww = None
        vals = []
        for e in lo+hi:
            F, co = sm[e]; vals.append((tv(e, math.log(KK/F), F, co)[0], e))
        if len(vals) == 2:
            a = (close-vals[0][1])/(vals[1][1]-vals[0][1]); ww = vals[0][0]*(1-a)+vals[1][0]*a
        else: ww = vals[0][0]*((close-now)/(vals[0][1]-now))
        F = idx; sdv = sqrt(ww)
        d1 = (log(F/KK)+0.5*ww)/sdv; d2 = d1-sdv
        return F*norm.cdf(d1)-KK*norm.cdf(d2)
    h = K*0.0015
    p_rn = -(call(K+h)-call(K-h))/(2*h)/1.0
    sdv = sqrt(w); d2 = (log(idx/K)-0.5*w)/sdv; p_bs = norm.cdf(d2)
    b, a = float(m['yes_bid_dollars']), float(m['yes_ask_dollars'])
    rows.append(dict(tk=m['ticker'], K=K, bid=b, ask=a, bsz=float(m['yes_bid_size_fp']), asz=float(m['yes_ask_size_fp']), p_rn=p_rn, p_flat=p_bs, z=log(K/idx)/sdv))
rows.sort(key=lambda r: r['K'])
print(f"index {idx:.1f}")
print("   K        z     bid  ask  | Deribit RN(smile)  flat-ATM | mid-RN  edgeBuy  edgeSell")
for r in rows:
    if 0.02 < (r['bid']+r['ask'])/2 < 0.98:
        mid = (r['bid']+r['ask'])/2
        print(f"{r['K']:9.0f} {r['z']:+5.2f}  {r['bid']:.2f} {r['ask']:.2f} |   {r['p_rn']:.3f}      {r['p_flat']:.3f}   | {mid-r['p_rn']:+.3f}  {r['p_rn']-r['ask']:+.3f}  {r['bid']-r['p_rn']:+.3f}")
json.dump(rows, open(f"results/live_{cur}_{ev}_{int(now)}.json", "w"))
