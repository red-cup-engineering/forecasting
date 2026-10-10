"""Certified temperature tails, counted by settlement day: the tail lane's backtest evidence for the market game.

Re-runs the 2026-10-03 temperature-tail backtest's selection on its own fitted models and counts, per kind (high,
low) and per window (the fit months before 2026-09-04, and the out-of-sample month from it), the certified tails:
quotes, markets, markets that settled yes, distinct settlement days, and days with a loss. The selection is the
production one, read from configuration rather than retyped: a bracket the model puts at or under
temperature-markets.json `tails.maxModelProbability[kind]` (with that model's `biasUncertainty` added to its scale,
tail.py's TAU), quoted at an ask of at most the desk policy's weather-tail-premium `maxAskCents`.

One day's tails share their weather, so the loss record the game reads is counted on days (a design effect):
trials = distinct settlement days, losses = ceil(the market loss rate x days). The record cites every input file and
script by sha256. The inputs (about 1 GB: Kalshi settled markets and candles, IEM NBM guidance and climate reports)
are fetched by the 10-03 record's own scripts into a run directory that is never committed.

Usage: python3 count_tails.py <run dir holding model-high.pkl, model-low.pkl and the fetched inputs>
"""
import sys, os, json, glob, hashlib, pickle, math
HERE = os.path.dirname(os.path.abspath(__file__))
FS = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))           # forecasting-service
SRC = os.path.join(FS, 'data', 'records', '2026-10-03-kalshi-temperature-tail-backtest')
RUN = os.path.abspath(sys.argv[1])
os.chdir(RUN); sys.path.insert(0, RUN)                                          # the run's copy of the 10-03 scripts (common.py opens series.txt from the cwd)
from common import prob, dt                                                    # noqa: E402  (the backtest's own bracket probability)
OUT = os.path.join(HERE, '..', 'results')
sha = lambda path: hashlib.sha256(open(path, 'rb').read()).hexdigest()
markets_cfg = json.load(open(os.path.join(FS, 'content', 'config', 'temperature-markets.json')))
policy = json.load(open(os.path.join(FS, '..', 'kalshi-stake-path-service', 'content', 'config', 'kalshi-desk-policy.json')))
MAX_ASK = policy['lanes']['weather-tail-premium']['config']['pricing']['maxAskCents'] / 100
SPLIT = dt.date(2026, 9, 4)

def count(kind):
    params, samples = pickle.load(open(os.path.join(RUN, f'model-{kind}.pkl'), 'rb'))
    a, s0, s1, nu, bias = params['a'], params['s0'], params['s1'], params['nu'], params['bias']
    tau = markets_cfg['models'][kind]['biasUncertainty']; max_p = markets_cfg['tails']['maxModelProbability'][kind]
    sig = lambda xnd, lead: math.sqrt((a * xnd) ** 2 + (s0 + s1 * max(lead - 12, 0) / 24) ** 2 + tau ** 2)
    rows = []
    for x in samples:
        mu = x['txn'] + bias.get(x['icao'], 0); sg = sig(x['xnd'], x['lead'])
        for q in x['quotes']:
            if not (0 < q['bid'] < q['ask'] < 1) or q['ask'] > MAX_ASK + 1e-9: continue
            if prob(q['m'], mu, sg, nu) > max_p: continue
            rows.append(dict(window='fit' if x['date'] < SPLIT else 'outOfSample', ticker=q['m']['ticker'], date=x['date'].isoformat(), lost=q['out'] == 1))
    out = {}
    for window in ('fit', 'outOfSample'):
        r = [row for row in rows if row['window'] == window]
        markets = {row['ticker'] for row in r}; lost = {row['ticker'] for row in r if row['lost']}
        days = {row['date'] for row in r}; loss_days = {row['date'] for row in r if row['lost']}
        out[window] = dict(quotes=len(r), markets=len(markets), marketsSettledYes=len(lost), days=len(days), daysWithLoss=len(loss_days),
                           dateRange=[min(days), max(days)] if days else None,
                           lossRecord=dict(kind='binary-loss-rate', trials=len(days), losses=math.ceil(len(days) * len(lost) / len(markets) - 1e-12) if markets else 0,
                                           method='design effect: trials = distinct settlement days, losses = ceil(market loss rate x days)'))
    return dict(selection=dict(maxModelProbability=max_p, biasUncertainty=tau, maxAsk=MAX_ASK), **out)

inputs = sorted(glob.glob(os.path.join(RUN, 'markets', '*.json')) + glob.glob(os.path.join(RUN, 'nbs', '*.csv')) + glob.glob(os.path.join(RUN, 'cli', '*.json')) + [os.path.join(RUN, 'candles.json')])
manifest = {os.path.relpath(p, RUN): sha(p) for p in inputs}
scripts = {name: sha(os.path.join(SRC, name)) for name in ('fetch.py', 'fetch_candles.py', 'fetch_iem.py', 'backtest.py', 'common.py', 'tail.py')}
scripts['count_tails.py'] = sha(os.path.abspath(__file__))
record = dict(type='KalshiTemperatureTailDays', version=1, lane='weather-tail-premium',
              question='How many settlement days carried certified temperature tails, and on how many did one settle yes?',
              kinds=dict(high=count('high'), low=count('low')),
              provenance=dict(countedBy='kalshi-engineering-services-section forecasting-service data/records/2026-10-10-temperature-tail-days/scripts/count_tails.py',
                              scripts=scripts, inputs=dict(files=len(manifest), manifest=hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()),
                              fetchedBy='data/records/2026-10-03-kalshi-temperature-tail-backtest fetch.py, fetch_candles.py, fetch_iem.py (public Kalshi API and IEM, no auth); backtest.py high|low fits the models',
                              source='a backtest, kept apart from the desk\'s live shadow scores so the game can weigh the two separately'),
              caveats=['Backtest evidence on one season (August into early October); the out-of-sample window is the month from 2026-09-04.',
                       'The run re-fetches public data; Kalshi listings and IEM archives can change, so the manifest digest identifies the exact inputs counted.'])
os.makedirs(OUT, exist_ok=True)
json.dump(manifest, open(os.path.join(OUT, 'input-manifest.json'), 'w'), indent=1, sort_keys=True)
json.dump(record, open(os.path.join(OUT, 'tail-days.json'), 'w'), indent=1)
print(json.dumps({k: {w: {f: v[w][f] for f in ('markets', 'marketsSettledYes', 'days', 'daysWithLoss')} for w in ('fit', 'outOfSample')} for k, v in record['kinds'].items()}))
