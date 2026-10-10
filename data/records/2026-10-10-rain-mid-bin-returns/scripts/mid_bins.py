"""Kalshi daily rain (KXRAIN): what taking at each mid-price bin returned, from Kalshi's own settled results.

Inputs are the 2026-10-04 weather-coverage record's public fetches (its scripts/fetch_settled.py and
fetch_candles.py, written to that record's git-ignored data/): settled KXRAIN markets and their hourly candles.
One row per (market, decision time), at the lane's decision times (station-local 15:00 and 21:00 the day before):
the last closed hourly candle's YES bid and ask, the mid, and the settled result. Rows are binned by mid on the
2026-10-04 calibration table's bins.

Per bin: rows, markets, distinct settlement dates (the effective sample: one date's markets share their weather),
the yes rate, the likelihood of the bin given each outcome (P(bin | yes), P(bin | no): what the market game's
conditionMarketForecast takes), and per side the gross and after-fee return of taking at the touch:
  buy YES at the ask; buy NO at 100 - bid (the same as selling YES at the bid).
Gross return is (payout - cost) / cost per contract; net subtracts Kalshi's quadratic taker fee at a 10-lot
(ceil(0.07 x 10 x p(1-p)) cents per order, a tenth of it per contract). Halves split by date show stability.

The record cites its inputs and itself by sha256 (provenance), so the market game can cite it as counted evidence.
Public data only; no account, no orders.
"""
import sys, os, json, hashlib, math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', '..', '2026-10-04-weather-coverage')
sys.path.insert(0, os.path.join(SRC, 'scripts'))
from common import RAIN_STN, event_date, fee_cents  # the 10-04 record's own station map, date parser and fee rule
D = os.path.join(SRC, 'data'); OUT = os.path.join(HERE, '..', 'results')
EDGES = [0.0, 0.02, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.98, 1.0]
STAGES = (('D-1 15h', 15), ('D-1 21h', 21))
sha = lambda path: hashlib.sha256(open(path, 'rb').read()).hexdigest()
settled_path, candles_path = f'{D}/settled-KXRAIN.ndjson', f'{D}/candles-KXRAIN.json'
markets = [json.loads(line) for line in open(settled_path)]
candles = json.load(open(candles_path))

rows = []
for m in markets:
    code = m['ticker'].split('-')[-1]
    if code not in RAIN_STN or m.get('result') not in ('yes', 'no') or not m.get('open_time') or not m.get('close_time'): continue
    zone = RAIN_STN[code][1]; d = event_date(m['event_ticker']); prev = d - timedelta(days=1)
    open_ts = datetime.fromisoformat(m['open_time'].replace('Z', '+00:00')).timestamp()
    close_ts = datetime.fromisoformat(m['close_time'].replace('Z', '+00:00')).timestamp()
    cs = sorted(candles.get(m['ticker']) or [], key=lambda c: c['end_period_ts'])
    for stage, hour in STAGES:
        t = datetime(prev.year, prev.month, prev.day, hour, tzinfo=ZoneInfo(zone)).timestamp()
        if t < open_ts or t > close_ts: continue
        last = None
        for c in cs:
            if c['end_period_ts'] <= t: last = c
        if last is None or not last.get('yes_bid') or not last.get('yes_ask'): continue
        bid = round(float(last['yes_bid'].get('close_dollars') or 0) * 100); ask = round(float(last['yes_ask'].get('close_dollars') or 1) * 100)
        if not (1 <= bid <= ask <= 99): continue
        rows.append(dict(ticker=m['ticker'], date=str(d), stage=stage, bid=bid, ask=ask, mid=(bid + ask) / 200, y=int(m['result'] == 'yes')))

def side_returns(rs, side):
    """Per-contract gross and after-fee returns of taking `side` ('yes' at the ask, 'no' at 100 - bid), as fractions of cost."""
    gross = net = 0.0
    for r in rs:
        price = r['ask'] if side == 'yes' else 100 - r['bid']
        won = r['y'] == 1 if side == 'yes' else r['y'] == 0
        fee = fee_cents(price, 10) / 10
        gross += ((100 if won else 0) - price) / price
        net += ((100 if won else 0) - price - fee) / (price + fee)
    n = len(rs)
    return dict(n=n, gross=gross / n if n else None, net=net / n if n else None)

def summarize(rs):
    yes_total = sum(r['y'] for r in rs); no_total = len(rs) - yes_total
    bins = []
    for lo, hi in zip(EDGES, EDGES[1:]):
        b = [r for r in rs if lo < r['mid'] <= hi] if lo > 0 else [r for r in rs if r['mid'] <= hi]
        yes = sum(r['y'] for r in b)
        bins.append(dict(lower=lo, upper=hi, rows=len(b), markets=len({r['ticker'] for r in b}), dates=len({r['date'] for r in b}),
                         settledYes=yes, yesRate=yes / len(b) if b else None, meanMid=sum(r['mid'] for r in b) / len(b) if b else None,
                         likelihoods=dict(yes=yes / yes_total if yes_total else None, no=(len(b) - yes) / no_total if no_total else None),
                         takeYes=side_returns(b, 'yes'), takeNo=side_returns(b, 'no')))
    return dict(rows=len(rs), markets=len({r['ticker'] for r in rs}), dates=len({r['date'] for r in rs}), settledYes=yes_total, bins=bins)

dates = sorted({r['date'] for r in rows}); split = dates[len(dates) // 2] if dates else None
record = dict(
    type='KalshiRainMidBinReturns', version=1,
    question='What did taking each side of a daily-rain market return, by the mid at the lane\'s day-before decision times, on Kalshi\'s own settled results?',
    series='KXRAIN', decisionTimes=[s for s, _ in STAGES], bins=[[lo, hi] for lo, hi in zip(EDGES, EDGES[1:])],
    feeRule='Kalshi quadratic taker fee: ceil(0.07 x 10 x p(1-p)) cents per 10-lot order, a tenth per contract',
    provenance=dict(countedBy='kalshi-engineering-services-section forecasting-service data/records/2026-10-10-rain-mid-bin-returns/scripts/mid_bins.py',
                    script=sha(os.path.abspath(__file__)), inputs=dict(settled=sha(settled_path), candles=sha(candles_path)),
                    fetchedBy='data/records/2026-10-04-weather-coverage/scripts/fetch_settled.py, fetch_candles.py (public Kalshi API, no auth)',
                    dateRange=[dates[0], dates[-1]] if dates else None),
    all=summarize(rows),
    halves=dict(splitDate=split, early=summarize([r for r in rows if r['date'] < split]), late=summarize([r for r in rows if r['date'] >= split])) if split else None,
    caveats=['A row is a (market, decision time): one market enters up to twice; one date\'s markets share their weather. The effective sample of a bin is its distinct dates, not its rows.',
             'Taking at the touch assumes the displayed size was there; depth is not read. Returns are per contract, unweighted by size.',
             'Descriptive, not a forecast: a bin\'s return is what was earned on these dates.'])
# The record in the market game's own form (market-game conditionMarketForecast / planMarket): per side, a
# scenario-likelihood-model over the mid, whose scenarios are the market's settlement (yes, no), with each bin's
# scored gross return and its effective sample (distinct dates, never rows).
def game_model(side):
    key = 'takeYes' if side == 'yes' else 'takeNo'
    return dict(kind='scenario-likelihood-model', side=side, source='urn:kalshi:KXRAIN:mid', path=['mid'],
                bins=[dict(lower=b['lower'], upper=b['upper'] + (1e-9 if b['upper'] == 1.0 else 0), likelihoods=b['likelihoods']) for b in record['all']['bins']],
                expectedReturns=[dict(trainingSamples=b['dates'], rows=b['rows'], gross=b[key]['gross'], net=b[key]['net']) for b in record['all']['bins']])
record['gameModels'] = dict(takeYes=game_model('yes'), takeNo=game_model('no'))
os.makedirs(OUT, exist_ok=True)
body = json.dumps(record, indent=1, sort_keys=False)
open(f'{OUT}/mid-bin-returns.json', 'w').write(body + '\n')
pct = lambda v: '' if v is None else f'{100 * v:.1f}%'
lines = ['| mid bin | rows | markets | dates | yes rate | P(bin|yes) | P(bin|no) | YES taker gross | YES taker net | NO taker gross | NO taker net |', '|---|---|---|---|---|---|---|---|---|---|---|']
for b in record['all']['bins']:
    lines.append(f"| ({b['lower']}, {b['upper']}] | {b['rows']} | {b['markets']} | {b['dates']} | {pct(b['yesRate'])} | {pct(b['likelihoods']['yes'])} | {pct(b['likelihoods']['no'])} | {pct(b['takeYes']['gross'])} | {pct(b['takeYes']['net'])} | {pct(b['takeNo']['gross'])} | {pct(b['takeNo']['net'])} |")
open(f'{OUT}/mid-bin-returns.md', 'w').write(f"# KXRAIN mid-bin returns ({record['provenance']['dateRange']}, {record['all']['rows']} rows, {record['all']['markets']} markets, {record['all']['dates']} dates)\n\nGenerated by scripts/mid_bins.py; the JSON beside this is the record (inputs and script cited by sha256).\n\n" + '\n'.join(lines) + '\n')
print(json.dumps(dict(rows=record['all']['rows'], markets=record['all']['markets'], dates=record['all']['dates'], range=record['provenance']['dateRange'])))
