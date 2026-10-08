# Weather at outdoor venues vs Kalshi sports totals (2026-10-07)

Status: PRE-REGISTRATION. This section was committed before any Kalshi price, ESPN score or weather value was
joined or any statistic computed. Results are appended below it in a later commit.

Question: does game-time weather, known from a forecast available before the game, predict the realised total
beyond Kalshi's own price at start - 60 min?  Read-only public data; no orders.

## Universe
- NFL and NCAAF (FBS): games with start Aug 28 - Oct 6 2026. MLB: Jul 1 - Oct 6 2026.
- Kalshi series KXNFLTOTAL, KXNCAAFTOTAL, KXMLBTOTAL (market ticker suffix N = total >= N, floor_strike N-0.5).
- Outdoor only: ESPN `competitions[0].venue.indoor` false AND, for MLB, venue not a retractable-roof or dome park
  (HOU, ARI, MIA, MIL, SEA, TEX, TOR, TB). Roof status is unknown for those, so they are excluded from the primary
  sample and reported as a sensitivity row.
- Game must have a ladder of >= 3 rungs with two-sided quotes at the entry minute and a settled result.

## Features (tradable)
Open-Meteo previous-runs API, `*_previous_day1` hourly variables (forecast issued about 24 h before the target hour),
units mph / deg F / mm, UTC. Window = mean (wind, gust, temp) and sum (precip) over the hours from the start hour
through start + 3 h (NFL/NCAAF) or start + 2 h (MLB). Venue lat/lon from a static table (city / stadium centre).
The Open-Meteo archive (reanalysis) at the same window is a sanity check only, never used for a rule.

## Market-implied median
At the last candle with end <= start - 60 min (and >= start - 180 min) take each rung's mid (yes_bid + yes_ask)/2
(two-sided only). Enforce monotone non-increasing P(total > strike) in strike (isotonic by running min). Median =
strike where P crosses 0.5, linear interpolation. Dependent variable `resid = actual total - median`.

## Regression (descriptive, per sport)
OLS `resid ~ 1 + wind + gust + precip + temp` and single-feature fits; SEs clustered by game (identical to HC1
since one row per game) and, as a second report, clustered by venue. No selection among specifications: all
reported.

## Trading rules (fixed now; thresholds from physics, not from the data)
Rung = the ladder strike whose mid is closest to 0.5 at the entry minute. Entry price is the ask of the side bought
(NO ask = 1 - yes_bid; YES ask = yes_ask), taken at the same candle, 1 contract, held to settlement. Net P&L per
contract = payout - ask - fee, fee = 0.07 x 1.0 x P(1-P) with P = ask (large-size limit, no cent rounding; fee
multiplier assumed 1.0).
- R1 (NFL and NCAAF separately and pooled): forecast window-mean wind >= 15 mph OR window-mean gust >= 25 mph -> buy NO.
- R2 (MLB): forecast window-mean temperature <= 60 F -> buy NO (cold suppresses fly-ball carry).
- R3 (MLB): forecast window-mean temperature >= 85 F -> buy YES (hot air raises carry).
- R4 (all three sports): forecast window precipitation >= 2 mm -> buy NO.
MLB wind-toward-center-field is NOT used (no verifiable park orientation source), so MLB wind is regression-only.

## Holdout
Rules have no fitted parameters, so every game is out of sample for them. Results are reported per calendar month;
the holdout is the last calendar month with trades (Oct 1-6 for football merged with Sept if Oct has < 10 trades),
the earlier months the "train" side; nothing is tuned on either. Mean net P&L per contract with game-level
standard error (rows are one per game) and a count. A rule is "supported" only if the pooled mean net P&L is > 0 at
2 SE and the holdout mean has the same sign.
