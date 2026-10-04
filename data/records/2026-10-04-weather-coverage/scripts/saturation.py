"""Saturation capital: every certified ticket across the covered weather families on each of the last 14 settled days, its executable depth, the desk's Kelly sizing at several bankrolls, and expected $/day.
Families: temperature tails (production model, desk windows), rain tails (sell YES, NBS-P06 model p<=0.02), rain favourites (buy YES, p>=0.97), weekend-rain tails/favourites (history too short: Kelly gate fails).
Sizing = tail-premium-policy.mjs: full Kelly per ticket on max(model p, loss floor), per-date budget 0.75, per-event 0.5, open 1.0 of bankroll (previous date still open while the next date is entered)."""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))
from edges import *
FIRST, LAST = '2026-09-19', '2026-10-02'
HORIZON = 4.0
FLOOR = {'temp_high': 0.01, 'temp_low': 0.012, 'rain_tail': 0.014, 'rain_fav': 0.055, 'wknd_tail': 0.094, 'wknd_fav': 0.13}   # 95% upper bounds (rule of three on the backtest n)
STOCK_MED = {'temp': 55.0, 'rain': 55.0, 'wknd': 108.0}      # live-book stock of bids >=3c (or asks <=97c) on a tail/favourite market, median (live-books.ndjson 2026-10-04 05:11Z); rain has no tail market quoted in the snapshot so it borrows temperature's
STOCK_MEAN = {'temp': 213.0, 'rain': 213.0, 'wknd': 108.0}
BANKROLLS = [25, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000]
def kelly(win, b): return max(0.0, (b * win - (1 - win)) / b)
# ---------- tickets
T = []
tt = pd.read_json(f'{D}/temp-cert.ndjson', lines=True)
tt = tt[(((tt.kind == 'high') & (tt.p <= 0.01)) | ((tt.kind == 'low') & (tt.p <= 0.005))) & (tt.bid >= 0.03) & (tt.bid <= 0.06) & (tt.date.astype(str) >= FIRST) & (tt.date.astype(str) <= LAST)]
tt = tt.sort_values('t').drop_duplicates('ticker')
for r in tt.itertuples(): T.append(dict(day=str(r.date)[:10], ticker=r.ticker, event=r.ticker.rsplit('-', 1)[0], fam='temp', fl='temp_' + r.kind, side='tail', p=r.p, bid=r.bid, ask=r.ask, y=r.y, t=r.t))
rd = pd.read_csv(f'{D}/rain-scored.csv'); rd = rd[(rd.date >= FIRST) & (rd.date <= LAST)]
x = rd[(rd.pm_pany <= 0.02) & (rd.bid >= 0.03) & (rd.bid <= 0.10)].sort_values('t').drop_duplicates('ticker')
for r in x.itertuples(): T.append(dict(day=r.date, ticker=r.ticker, event=r.ticker.rsplit('-', 1)[0], fam='rain', fl='rain_tail', side='tail', p=r.pm_pany, bid=r.bid, ask=r.ask, y=r.y, t=r.t))
x = rd[(rd.pm_pany >= 0.97) & (rd.ask <= 0.97) & (rd.ask > 0.5)].sort_values('t').drop_duplicates('ticker')
for r in x.itertuples(): T.append(dict(day=r.date, ticker=r.ticker, event=r.ticker.rsplit('-', 1)[0], fam='rain', fl='rain_fav', side='fav', p=r.pm_pany, bid=r.bid, ask=r.ask, y=r.y, t=r.t))
wk = pd.read_csv(f'{D}/rain-wknd-cand-full.csv'); wk = wk[(wk.date >= FIRST) & (wk.date <= LAST)]
for r in wk.itertuples(): T.append(dict(day=r.date, ticker=r.ticker, event=r.ticker.rsplit('-', 1)[0], fam='wknd', fl='wknd_tail' if r.kind == 'tail_sell' else 'wknd_fav', side='tail' if r.kind == 'tail_sell' else 'fav', p=r.pm, bid=r.bid, ask=r.ask, y=r.y, t=r.t))
tk = pd.DataFrame(T)
# ---------- execution facts from the tape
tapes = {}
for nm in ('rain', 'temp', 'rainwknd'):
    p = f'{D}/trades-{nm}.ndjson'
    if os.path.exists(p): tapes.update(load_tape(p))
mp = os.path.join(D, '../../2026-10-04-kalshi-microstructure/data/tape-history.ndjson')
facts = []
for r in tk.itertuples():
    tp = tapes.get(r.ticker); t0 = pd.Timestamp(r.t)
    if r.side == 'tail':
        take_px = round(r.bid * 100); rest_px = round(r.ask * 100); fl = flow(tp, 'no', ge_p=take_px, t0=t0, horizon_h=HORIZON); rside = 'sell'
        rflow = flow(tp, 'yes', ge_p=rest_px, t0=t0, horizon_h=HORIZON)
    else:
        take_px = round(r.ask * 100); rest_px = round(r.bid * 100); fl = flow(tp, 'yes', le_p=take_px, t0=t0, horizon_h=HORIZON); rside = 'buy'
        rflow = flow(tp, 'no', le_p=rest_px, t0=t0, horizon_h=HORIZON)
    q = Q0_SELL_TOUCH.get(rest_px if r.side == 'tail' else 100 - rest_px, 60)
    ft, ch = first_fill(tp, rside, rest_px, t0, HORIZON, q) if rest_px > 0 else (None, None)
    st_med, st_mean = STOCK_MED[r.fam], STOCK_MEAN[r.fam]
    facts.append(dict(take_px=take_px, rest_px=rest_px, flow=fl, rest_flow=rflow, rest_fill=ft is not None, rest_q=q, has_tape=tp is not None and not tp.empty, depth_low=st_med, depth_base=max(st_med, fl), depth_high=st_mean + fl))
tk = pd.concat([tk, pd.DataFrame(facts)], axis=1)
tk['floor'] = tk.fl.map(FLOOR)
tk['lossrate'] = np.where(tk.side == 'tail', np.maximum(tk.p, tk.floor), np.maximum(1 - tk.p, tk.floor))
tk['risk_c'] = np.where(tk.side == 'tail', 100 - tk.take_px, tk.take_px)
tk['kelly'] = [kelly(1 - r.lossrate, r.take_px / (100 - r.take_px)) if r.side == 'tail' else kelly(1 - r.lossrate, (100 - r.take_px) / r.take_px) for r in tk.itertuples()]
tk['edge'] = np.where(tk.side == 'tail', tk.take_px / 100 - tk.p, tk.p - tk.take_px / 100)
tk.to_csv(f'{D}/saturation-tickets.csv', index=False)
tk.drop(columns=['t']).to_csv(f'{R}/saturation-tickets.csv', index=False)
WK = os.environ.get('INCLUDE_WKND') == '1'; SUF = '-with-weekend' if WK else ''
if not WK: tk = tk[tk.fam != 'wknd'].reset_index(drop=True)
# ---------- sizing + EV
def allocate(day_rows, cap, prev_open):
    wants = []
    for r in day_rows.itertuples():
        if r.kelly <= 0: continue
        wants.append([r, int(math.floor(r.kelly * cap))])
    budget = int(math.floor(0.75 * cap)); budget = min(budget, int(cap - prev_open))
    tot = sum(w for _, w in wants)
    sc = max(0.0, min(1.0, budget / tot)) if tot > 0 else 0.0
    used_ev, used = {}, 0; out = []
    for r, w in sorted(wants, key=lambda a: -a[0].edge):
        w = int(math.floor(w * sc))
        room = min(w, int(0.5 * cap) - used_ev.get(r.event, 0), int(cap - prev_open - used))
        n = int(room // r.risk_c)
        if n < 1: continue
        out.append((r, n)); used_ev[r.event] = used_ev.get(r.event, 0) + n * r.risk_c; used += n * r.risk_c
    return out, used
def execute(r, n, depth_col):
    """take up to depth, rest the remainder (queue-aware); returns dict of contracts and pnl cents (realised y, and pessimistic expected at the loss floor)."""
    d = getattr(r, depth_col); take = int(min(n, math.floor(d))); rem = n - take
    fee = fee_cents(r.take_px, take) if take > 0 else 0
    rest = int(min(rem, max(0.0, r.rest_flow - r.rest_q))) if r.rest_fill else 0     # filled quantity: flow beyond the queue ahead, only if the queue-aware rule filled it
    if r.side == 'tail':
        real = take * (r.take_px - 100 * r.y) - fee + rest * (r.rest_px - 100 * r.y)
        pess = take * (r.take_px - 100 * r.floor) - fee + rest * (r.rest_px - 100 * r.floor)
        risk_t = take * (100 - r.take_px); risk_r = rest * (100 - r.rest_px)
    else:
        real = take * (100 * r.y - r.take_px) - fee + rest * (100 * r.y - r.rest_px)
        pess = take * (100 * (1 - r.floor) - r.take_px) - fee + rest * (100 * (1 - r.floor) - r.rest_px)
        risk_t = take * r.take_px; risk_r = rest * r.rest_px
    return dict(take=take, rest=rest, real=real, pess=pess, risk=risk_t + risk_r, depth_bound=n >= d)
days = sorted(tk.day.unique())
allrows = []; summary = []
for depth_col in ('depth_low', 'depth_base', 'depth_high'):
    for C in BANKROLLS:
        cap = C * 100; prev = 0; tot = dict(real=0, pess=0, risk=0, n=0, bound=0, cnt=0)
        fams = {}
        for d in days:
            rows = tk[tk.day == d]; alloc, used = allocate(rows, cap, prev); prev = used
            for r, n in alloc:
                e = execute(r, n, depth_col)
                tot['real'] += e['real']; tot['pess'] += e['pess']; tot['risk'] += e['risk']; tot['n'] += 1; tot['bound'] += e['depth_bound']
                f = fams.setdefault(r.fl, dict(real=0, pess=0, n=0)); f['real'] += e['real']; f['pess'] += e['pess']; f['n'] += 1
                allrows.append(dict(depth=depth_col, bankroll=C, day=d, ticker=r.ticker, fl=r.fl, count=n, take=e['take'], rest=e['rest'], real_c=e['real'], pess_c=e['pess'], risk_c=e['risk']))
        nd = len(days)
        summary.append(dict(depth=depth_col, bankroll=C, tickets_per_day=round(tot['n'] / nd, 2), deployed_usd_per_day=round(tot['risk'] / 100 / nd, 2), depth_bound_share=round(tot['bound'] / max(tot['n'], 1), 2), usd_per_day_realised=round(tot['real'] / 100 / nd, 3), usd_per_day_pessimistic=round(tot['pess'] / 100 / nd, 3), roi_per_day_pess=round(tot['pess'] / max(tot['risk'], 1), 4), **{f'real_{k}': round(v['real'] / 100 / nd, 3) for k, v in fams.items()}))
S = pd.DataFrame(summary); S.to_csv(f'{R}/saturation-curve{SUF}.csv', index=False)
pd.DataFrame(allrows).to_csv(f'{D}/saturation-allocations.csv', index=False)
# ---------- capital to hold every wanted ticket (depth-limited, no Kelly cap): peak concurrent risk over adjacent dates
H = []
for depth_col in ('depth_low', 'depth_base', 'depth_high'):
    risk_by_day = {}
    for r in tk.itertuples():
        if r.kelly <= 0: continue
        n = int(math.floor(getattr(r, depth_col)))
        risk_by_day[r.day] = risk_by_day.get(r.day, 0) + n * r.risk_c
    ds = sorted(risk_by_day); conc = [risk_by_day[d] + (risk_by_day.get(ds[i - 1], 0) if i else 0) for i, d in enumerate(ds)]
    H.append(dict(depth=depth_col, mean_risk_per_day_usd=round(np.mean([risk_by_day[d] for d in ds]) / 100, 1), peak_day_usd=round(max(risk_by_day.values()) / 100, 1), peak_two_day_usd=round(max(conc) / 100, 1), mean_two_day_usd=round(np.mean(conc) / 100, 1)))
pd.DataFrame(H).to_csv(f'{R}/saturation-hold-all{SUF}.csv', index=False)
fam_counts = tk.groupby('fl').agg(tickets=('ticker', 'size'), per_day=('ticker', lambda s: round(len(s) / len(days), 2)), kelly_gt0=('kelly', lambda s: int((s > 0).sum())), median_price_c=('take_px', 'median'), median_depth_flow=('flow', 'median'), losses=('y', lambda s: 0)).reset_index()
fam_counts['wrong'] = [int((tk[tk.fl == f].y == (1 if tk[tk.fl == f].side.iloc[0] == 'tail' else 0)).sum()) for f in fam_counts.fl]
fam_counts.drop(columns='losses').to_csv(f'{R}/saturation-families{SUF}.csv', index=False)
print(days[0], days[-1], len(days), 'days;', len(tk), 'tickets'); print(fam_counts.drop(columns='losses').to_string()); print(md(S, index=False)); print(md(pd.DataFrame(H), index=False))
