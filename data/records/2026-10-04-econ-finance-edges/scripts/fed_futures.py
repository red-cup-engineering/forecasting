"""Fed-funds-futures implied hike/cut probabilities (Yahoo ZQ contracts, free) vs Kalshi KXFEDDECISION. Live snapshot + the one resolved meeting with free data (Sep 2026)."""
import json, time, datetime as dt, calendar, numpy as np
zq = json.load(open('data/ext/zq.json'))
def px(code, day):  # last close on or before day (ISO)
    r = [(t, v) for t, v in zq[code] if time.strftime('%Y-%m-%d', time.gmtime(t)) <= day]
    return r[-1][1] if r else None
def dim(y, m): return calendar.monthrange(y, m)[1]
def implied_after(meeting, day, r_pre, prev_cum_months=None):
    """meeting: date; uses contract of meeting month if >=8 days remain after meeting, else next month's. Returns implied post-meeting rate (%)."""
    y, m = meeting.year, meeting.month; N = dim(y, m); d = meeting.day  # new rate effective day d+1
    post_days = N-d
    code = f"ZQ{'FGHJKMNQUVXZ'[m-1]}{str(y)[2:]}.CBT"
    if post_days >= 8 and code in zq:
        p = px(code, day); avg = 100-p
        return (avg*N - r_pre*d)/post_days
    y2, m2 = (y, m+1) if m < 12 else (y+1, 1)
    code2 = f"ZQ{'FGHJKMNQUVXZ'[m2-1]}{str(y2)[2:]}.CBT"
    return 100-px(code2, day)
def pm(r_pre, r_post):  # map expected change onto adjacent 25bp grid
    delta = (r_post-r_pre)/0.25
    k = int(np.floor(delta)); f = delta-k
    out = {k: 1-f, k+1: f}
    return out
if __name__ == '__main__':
    # Sep 16 2026 meeting, as of Sep 15 close. EFFR pre = 3.63? read from NY Fed file
    effr = {r['effectiveDate']: r['percentRate'] for r in json.load(open('data/ext/effr.json'))['refRates']}
    for meeting, day in [(dt.date(2026, 9, 16), '2026-09-15'), (dt.date(2026, 10, 28), '2026-10-02'), (dt.date(2026, 12, 9), '2026-10-02')]:
        pre = effr.get(day) or sorted(effr.items())[-1][1]
        r_pre_for = pre
        if meeting.month == 12:   # Oct and Nov effective rate after Oct meeting: use Nov contract (no Nov meeting) as the pre-Dec rate
            r_pre_for = 100-px('ZQX26.CBT', day)
        post = implied_after(meeting, day, r_pre_for)
        dist = pm(r_pre_for, post)
        print(f"{meeting}: EFFR/pre {r_pre_for:.3f} implied post {post:.3f} change {(post-r_pre_for)*100:+.1f}bp -> grid {{{', '.join(f'{k*25:+d}bp:{v:.2f}' for k,v in sorted(dist.items()))}}}")
