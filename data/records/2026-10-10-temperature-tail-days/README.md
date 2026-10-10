# Temperature tails by settlement day, 2026-10-10

The weather-tail-premium lane's loss record, counted in settlement days rather than markets,
from a re-run of the 2026-10-03 temperature backtest. Tails on one day share that day's
weather, so the market count (0 of 502 out of sample on this run; 0 of 467 in the 10-03 README)
overstates the independent trials. This record gives the market-game `binary-loss-rate` form a count it can bound
honestly: trials are distinct settlement days, and losses are the market loss rate scaled to
those days, rounded up.

This is backtest evidence, separate from the live shadow scores. Whether the game may pool
the two is a game-side rule; nothing here pools them.

## Selection

The desk's own thresholds, read from the committed config when the count runs:
`temperature-markets.json` (`biasUncertainty` 0.6; `tails.maxModelProbability` 0.01 high,
0.005 low) and the desk policy's tail lane `pricing.maxAskCents` (5).

## Result (`results/tail-days.json`)

| kind | window | markets | settled yes | days | days with a loss | loss record |
| --- | --- | --- | --- | --- | --- | --- |
| high | fit, 08-04..09-03 | 150 | 0 | 31 | 0 | 0 of 31 |
| high | out of sample, 09-04..10-05 | 298 | 0 | 32 | 0 | 0 of 32 |
| low | fit, 08-04..09-03 | 253 | 1 | 31 | 1 | 1 of 31 |
| low | out of sample, 09-04..10-05 | 204 | 0 | 32 | 0 | 0 of 32 |

The fit window reproduces the 2026-10-03 README exactly (150/0 and 253/1). The out-of-sample
window runs three days later than that README's (10-05, not 10-02), because the markets were
re-fetched on 10-10, so it holds more markets (298 against 272 high, 204 against 195 low).
The 10-03 `tail.py`, run on the same inputs, agrees with these counts.

At the one-sided 95% Clopper-Pearson bound, 0 of 32 days is about 8.9%, against 0 of 298
markets at about 1.0%. Counted by day, the evidence is thin; it does not by itself admit the
tail lane.

## Reproducing

Only the derived counts and the inputs' sha256 digests are committed
(`results/input-manifest.json`, cited by digest in `tail-days.json`). The inputs (about
370 MB) are re-fetched with the 10-03 record's scripts into a run directory:
`fetch.py`, `fetch_candles.py` (run separately; this run's `fetch.py` copy skipped the
per-series candles), `fetch_iem.py`, then `backtest.py high` and `backtest.py low`. Then:

    python3 scripts/count_tails.py <run-dir>

Kalshi listings and IEM archives can change; the manifest identifies the inputs counted here.
