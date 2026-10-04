from ladder import *
L=json.load(open("../data/ext/ll2_spacex.json"))['results']
L=[r for r in L if r['status']['abbrev']=='Success']
times=sorted((ts(r['net']),r['name']) for r in L)
M=json.load(open("../data/markets/KXSPACEXCOUNT.json")); C=json.load(open("../data/candles/KXSPACEXCOUNT.json"))
out=[]
for m in M:
    mo=m['ticker'].split('-')[1]; N=int(m['ticker'].split('-')[2])
    if mo=='26JUL': continue  # LL2 window starts 07-25
    y,mm=2026,{'AUG':8,'SEP':9}[mo[2:]]
    t0=calendar.timegm((y,mm,1,0,0,0)); t1=calendar.timegm((y,mm+1,1,0,0,0))
    ls=[t for t,_ in times if t0<=t<t1]
    # first time running count > N (launch time + 0)
    if len(ls)<=N: out.append((m['ticker'],'never',len(ls),m['result'])); continue
    tl=ls[N]  # (N+1)th launch
    cs=C[m['ticker']]
    after=[c for c in cs if c['end_period_ts']>tl]
    row=[]
    for c in after[:6]:
        b=fl((c.get('yes_bid') or {}).get('close_dollars')); a=fl((c.get('yes_ask') or {}).get('close_dollars'))
        row.append((round((c['end_period_ts']-tl)/3600,1),b,a))
    out.append((m['ticker'],'decided_at',time.strftime('%m-%d %H:%MZ',time.gmtime(tl)),m['result'],row))
for o in out: print(o)
