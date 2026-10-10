# All-weather coverage and saturation capital, 2026-10-04

Research and paper only: public Kalshi market data (no auth, no orders) and public weather data (IEM's archive of NWS/NBM NBS guidance and NWS climate reports). Everything is re-runnable (`scripts/analyze.sh`); raw data lives in `data/` (git-ignored by its own `.gitignore`), tables in `results/`.

Question: can the desk cover all Kalshi weather, and how much capital does it take to hold every ticket we want, every day?

## 1. Census (results/census.md, census.csv)

417 series in Climate and Weather; 145 have open markets. By family (24h volume in contracts; depth is top-of-book only in the census, full ladders in section 4):

| family | series open | open markets | vol24h | open interest | settled history |
|---|---|---|---|---|---|
| temperature, daily high/low (the 48 desk series plus a few) | 49 | 577 | 1,541,689 | 1,180,726 | ~400 markets/series since 07-28 |
| **rain, daily (KXRAIN, ~30 cities, 2 events open)** | 3 | 88 | **882,236** | 478,493 | 1,529 markets, 07-27..10-03 |
| rain, weekend (KXRAINWKND, 23 cities) | 2 | 27 | 36,567 | 59,822 | 133 markets, 6 weekends |
| rain, monthly/custom (KXRAIN*M, 14 series) | 14 | 194 | 16,432 | 36,981 | 21-34 markets per series, Aug and Sep only |
| temperature, hourly directional (KXTEMP*H/HS, Synoptic or Kalshi source) | 4 | 40 | 12,905 | 10,407 | ~5,500-11,800 per series, ~57% yes |
| snow (monthly/season, 14 series) | 14 | 86 | 10,220 | 63,564 | none settled (season starts in November) |
| hurricane / tropical (NOAA/NHC) | 12 | 287 | 10,133 | 747,305 | 68 KXHURCAT, others few |
| temperature, weekly average (KXAVGTK*, 10 cities) | 10 | 50 | 7,497 | 9,179 | 6 weeks x 5 markets x 10 cities |
| climate/other, earthquake, ski-opening | ~37 | ~187 | ~10,000 | ~550,000 | not weather forecasting |
| weekly high (KXWEEKHT NYC/LAX/MIA/LAS/PHX), Death Valley (KXDVHIGH), KXRAIND, KXRAINNYCW | 0 open | 0 | 0 | 0 | none (no market is listed now; no settled history) |

Settlement source is The Weather Company (weather.com/kalshi, "trace counts as 0") for all rain, snow monthly, KXAVGTK and KXHIGHT/LOWT series; NWS climate report for a few (KXRAINNYCM, Death Valley); Synoptic Data for hourly directional; NASA/NOAA/NCEI for annual and monthly climate.

KXRAIN is the biggest single weather book by volume (882k contracts/24h, 60 markets open, 2 events) and is ~57% of the temperature lane's volume; KXRAIN alone out-trades every single temperature series (KXHIGHLAX, the largest, is 469k). Daily rain contract: "total precipitation at CLIxxx strictly greater than 0 inches" for the local day, trace counts as 0, and it closes early (resolves yes) when rain occurs.

## 2. Edge verdicts, per family

Cheapest credible model, tested out of sample against Kalshi's own results, with the 2026-10-04 microstructure queue-aware fill rule (`scripts/fills.py`: fill iff a taker sweeps through the level or cumulative taker volume at the price exceeds the queue ahead; queue ahead = measured median at the touch) and Kalshi's quadratic taker fee (0.07 x n x p(1-p), rounded up per order, evaluated at a 10-lot).

**Daily rain (KXRAIN): EDGE, two-sided.** Model: logistic of settled yes on NBS P06 (P(any rain) = 1 - prod(1 - P06) over the 6-hour periods inside the climate day), two-fold cross-fit by date, so every row is out-of-sample (`results/rain-model.md`). Decision times: day before 15h and 21h local, same day 07h; newest NBS run issued at least 2h before; quote = last hourly candle.
- Calibration: the model is about as good as Kalshi's mid the day before (OOF Brier 0.0885 vs 0.0903 at D-1 15h; 0.0854 vs 0.0848 at D-1 21h) and a 50/50 pool is better than either (0.0863, 0.0820). On the day itself the market is much better (0.0670 vs 0.0810: it sees the weather), so same-day entries are weaker.
- The market has a long-shot bias at both ends: mids of 2-5c settle yes 1-3% of the time; mids of 86-96% settle yes 92-100% (`results/rain-model.md`, calibration tables).
- **Certified tail sell** (model p <= 2%, bid >= 3c, day-before): 221 markets, 1 settled yes (KXRAIN-26SEP30-BOS, model 0.4%), +3.3c/contract taking after fee, +5.0c at bid >= 4c (110 markets, 0 yes). Resting at the ask fills 42% of the time (queue-aware, 4h, 62 clean fills) for +2.0c per placed contract. At p <= 0.5%: 103 markets, 1 yes, +2.5c taking. Same day 07h: 86 markets, 1 yes, +3.3c taking.
- **Near-certain favourite buy** (model p >= 97%, ask <= 97c, day-before): 54 markets, 0 settled no, +7.4c/contract taking after fee (+8.4c at ask <= 96c); resting the bid fills 46% for +4.9c per placed contract. Observed rate 0 of 54; the desk's rule-of-three bound is 5.5%, which is what the sizing below uses.
- The edge per contract is bigger than the temperature tails' (+1.2c taking), but the flow into these prices is thin: median 4h bid-side flow at the tail bid is 2-10 contracts, favourites about 30-50 (`rain-edges.csv`, `median_flow`).

**Weekend rain (KXRAINWKND): signal, insufficient history.** Same logistic on P(any rain Sat+Sun). Six weekends: model Brier 0.106/0.109/0.092 (Fri 15h/Fri 21h/Sat 07h) vs mid 0.115/0.113/0.121; 0 of 32 tail sells wrong (+4.7c taking), 0 of 23 favourites wrong (+12.3c taking); resting fills 31% and 22%; median flow into the touch is 0 over 4h (`results/rain-weekend.md`). With n = 6 independent weekends the rule-of-three loss bounds are 9-13%, the Kelly gate fails for all but the cheapest favourites, so the desk would size them to ~0. Keep as a shadow lane until about 12 more weekends settle.

**Weekly average temperature (KXAVGTK*, 10 cities): NO EDGE.** "At least N consecutive days with daily average > 90F" composed from the daily NBS highs and lows (house station biases and scale, AR(1) day-to-day error, Monte Carlo run length), with the elapsed days taken from IEM climate reports at Wednesday and Friday 15h. Brier 0.041/0.027 vs the market's 0.026/0.011: the market beats the composition at both times; favourites at p >= 0.97 were wrong 2 of 2; the only tails priced >= 3c on the bid number 2. NBS in the IEM archive reaches only ~3.7 days, so Sunday-start forecasts are impossible with this source (NBE would be needed). Not tradeable on this evidence (`results/avg-temp.md`).

**Snow (monthly/season): NO HISTORY.** 14 series, none settled; the season starts in November. NBS carries S06/SLV; revisit after the first snowfall month. **Monthly rain (KXRAIN*M): NO HISTORY** beyond Aug and Sep (21-34 markets per city, one outcome per city-month) -- too short to calibrate any model. **Hourly directional temperature:** coin-flip contracts on Synoptic observations (57% yes pooled, one outcome per hour): no external forecast beats the market at a one-hour horizon by a margin the fee allows, and I did not model them. **Hurricane / tropical:** NHC-driven, thin history (68 KXHURCAT, mostly 1c-99c longshots), no cheap public model in this slice. **Weekly high, Death Valley, KXRAIND, KXRAINNYCW:** nothing listed. **Daily high/low temperature:** the existing lane (0 of 422 high and 1 of 448 low certified tails settled yes; the replay below finds 0 of 302 qualifying candidate rows, 71 markets in 16 days).

## 3. Method for the saturation numbers

Window: event dates 2026-09-19..2026-10-02 (14 settled days). Tickets per day, deduplicated to the first qualifying decision per market:
- **temp_high / temp_low**: the production model (`src/temperature-market-model.mjs`, run in node over IEM NBS archives) at every in-window hour of the desk's windows, with a candle bid of 3-6c and certification p <= 1% (high) / 0.5% (low). 41 + 14 tickets (3.9 a day).
- **rain_tail**: sell YES, model p <= 2%, bid 3-10c. 42 tickets (3.0 a day), 1 settled yes.
- **rain_fav**: buy YES, model p >= 97%, ask <= 97c. 26 tickets (1.9 a day), 0 settled no. Only 11 have positive Kelly under the 5.5% loss floor.
- Weekend rain is excluded from the headline (`*-with-weekend.csv` has it).

Sizing is the desk's (`tail-premium-policy.mjs`): full Kelly per ticket on max(model p, loss floor) with floors 1.0% (high), 1.2% (low), 1.4% (rain tail, rule of three on 3/221), 5.5% (rain favourite, 3/54); per-date budget 0.75, per-event 0.5, open 1.0 of bankroll, with the previous date still open when the next is entered; tickets in a date's budget scale proportionally.

Execution: take into the bid (or lift the ask) up to the **executable depth**, rest the remainder at the touch with the queue-aware rule (a filled resting order is credited min(remainder, flow beyond the queue ahead)). Depth is the weak point, because historical books are not archived. Three scenarios: `depth_low` = the median live-book stock of bids 3-10c (55 contracts; temperature markets, 2026-10-04 05:11Z, 52 books; weekend 108; rain has no tail quoted in that overnight snapshot, so it borrows temperature's); `depth_base` = max(that median, the realised 4h taker flow into bids at or above our price from the tape); `depth_high` = the mean live stock (213) plus that flow.

$/day is reported two ways: **realised** (actual Kalshi outcomes) and **pessimistic** (every ticket loses at its loss-rate floor: the expected value if the true loss rate were the 95% upper bound), both after the taker fee.

## 4. Saturation-capital curve (excluding weekend rain; `results/saturation-curve.csv`)

Capital to hold every wanted ticket, depth-limited, no Kelly cap (`saturation-hold-all.csv`): mean/peak risk per day $407/$844 (depth_low), $1,798/$8,342 (depth_base), $3,126/$10,167 (depth_high); two adjacent dates open at once (peak): $1.1k / $10.0k / $13.1k. The heavy tail comes from a few big-flow rain days.

Expected $/day, pessimistic (realised in brackets), depth_base:

| bankroll | tickets/day sized | deployed $/day | depth-bound share | $/day pessimistic | ($/day realised) | $/day, depth_low | $/day, depth_high |
|---|---|---|---|---|---|---|---|
| $25 | 5.4 | 10 | 0% | 0.24 | (0.38) | 0.24 | 0.24 |
| $100 | 7.3 | 48 | 0% | 1.17 | (1.69) | 1.17 | 1.17 |
| $250 | 7.6 | 123 | 1% | 3.09 | (4.32) | 3.09 | 3.10 |
| $500 | 7.6 | 227 | 17% | 5.73 | (7.87) | 5.69 | 6.27 |
| $1,000 | 7.6 | 374 | 31% | 9.41 | (12.66) | 9.69 | 12.60 |
| $2,500 | 7.6 | 612 | 74% | 16.11 | (21.00) | 18.66 | 27.01 |
| $5,000 | 7.6 | 889 | 86% | 25.37 | (34.54) | 30.81 | 41.24 |
| $10,000 | 7.6 | 1,290 | 89% | 41.61 | (57.15) | 48.39 | 60.18 |
| $25,000 | 7.6 | 2,131 | 94% | 82.24 | (111.01) | 85.36 | 104.66 |
| $50,000 | 7.6 | 2,935 | 97% | 121.99 | (164.45) | 112.04 | 147.02 |

By family at $1,000 (realised $/day, depth_base): temperature high 6.8, rain tail 2.4, rain favourite 1.8, temperature low 1.7 (see `saturation-curve.csv`).

**(a) Where depth, not bankroll, binds.** Half of the sized tickets hit their depth cap at about **$1,000-1,500 bankroll** with the conservative stock (depth_low: 44% at $1,000, 89% at $2,500), about **$1,500-2,500** with flow added (depth_base: 31% at $1,000, 74% at $2,500), and **$5,000-10,000** at the mean live stock (depth_high: 50% at $5,000, 79% at $10,000). Past that, extra bankroll only buys larger resting remainders and the few big-flow days (the curve keeps rising slowly: the marginal pessimistic return on bankroll falls from 1.1%/day (25 to 100) to 0.7%/day (500 to 1,000), 0.5%/day (1,000 to 2,500), 0.3%/day from $5,000 to $10,000, falling to 0.16%/day above $25,000).

**(b) $/day.** Pessimistic after fees and queue-aware fills, depth_base: $0.24 at $25, $1.2 at $100, $3.1 at $250, $5.7 at $500, $9.4 at $1,000, $16 at $2,500. The loss-at-floor assumption is conservative for tails (1 settled-yes among 97 tail tickets in the window; the floors imply about 1.2) and very conservative for favourites (0 of 26 against a 5.5% floor), so the truth sits between the two columns, nearer the realised one if the backtest rates hold.

**Recommended bankroll: $1,000**, up to $2,500 once live books confirm >= 200 contracts of stock at 3c+ on rain and temperature tails. At $1,000 the desk deploys about $370 a day, 7.6 tickets a day, ~$9-13 a day (about 1%/day on bankroll, 2.5-3.4%/day on deployed capital), and it is near the depth knee, so it neither starves nor runs into the book. $25 yields $0.24-0.38 a day. Apply a 0.5 haircut for live-versus-replay (below) if you want a planning figure: about $5-6 a day at $1,000.

## Caveats (read these)

- **Depth is an assumption.** No archive of historical books exists; the live-book sample is one overnight snapshot of 659 books and contains no quoted rain tail. The three depth scenarios bracket it; depth_low is the number to trust until the collector runs through a rain day. Taking at the hourly-candle bid presumes the bid was there when the desk looked; the 2026-10-04 microstructure study found quiet markets have bids >= 3c in only ~22% of snapshots, which this replay does not model beyond the candle close. The candle sample (an hour-end quote) is optimistic about how often a >= 3c bid coincides with a decision.
- Samples are small and clustered: 56 temperature tickets, 42 rain tail, 26 rain favourite tickets in 14 days; rain outcomes within a date are strongly correlated (same weather systems), so effective n is smaller than the counts. The rain tails lost 1 of 42 in the window (BOS 09-30, model 0.4%), which against the desk's falsifier (3 certified-tail losses in 30 days) uses a third of the budget in one 14-day window.
- The rain model was cross-fit on the same 68 days it is scored on (two folds); the favourite and tail thresholds (p <= 0.02, >= 0.97) were set after seeing the calibration table, not before. Treat the +3-8c/contract as an upper estimate until a held-forward month confirms it.
- Rain depends on one settlement source (weather.com/kalshi, trace = 0, closes early on first rain); the model is fit to Kalshi's results, not to the climate report, so settlement-source errors are inside the data, not corrected.
- Kelly on a 5.5% favourite floor and a thin tail history is deliberately timid; the desk's own falsifier halt should cover the rain lanes before they trade.
- Not done: snow, monthly rain, hourly directional, hurricane modelling; the 2026-10-03 and 10-04 events (unsettled).

## Files

`scripts/`: `kalshi.py` (public GET), `census.py`, `settled_counts.py`, `census_report.py`, `fetch_settled.py`, `fetch_candles.py`, `fetch_iem.py`, `fetch_trades.py`, `rain_dataset.py`, `rain_model.py`, `rain_edges.py`, `rain_weekend.py`, `rain_weekend_edges.py`, `avg_temp.py`, `temp_fetch.py`, `temp_certify.mjs` (imports the production model), `live_books.py`, `fills.py`, `edges.py`, `saturation.py`, `analyze.sh`. `results/`: `census.md`, `rain-model.md`, `rain-edges.md`, `rain-weekend.md`, `avg-temp.md`, `saturation-curve.csv`, `saturation-hold-all.csv`, `saturation-families.csv`, `saturation-tickets.csv` (and `-with-weekend` variants).

## Forward test: daily-rain lane (added 2026-10-04)

The rain edge above is in-sample in two ways: the thresholds (p <= 2%, p >= 97%) were chosen after the calibration table, and the logistic was cross-fit on the same 68 days it is scored on. The only evidence that counts for capital is a forward one. The model is frozen (`forecasting-service/content/config/rain-markets.json`, `src/rain-market-model.mjs`: one logistic per decision time, fit on all 1,504/1,509 rows; the two cross-fit halves are kept for audit) and the desk runs it as the lane `daily-rain` (`kalshi-stake-path-service/src/lanes/daily-rain.mjs`). Every ten-minute cycle the lane prices each open KXRAIN market on the day before (15:00-23:59 station-local, D-1 15h then D-1 21h weights; nothing is priced on the day itself, where the market beats the model), and every certified opportunity is appended to the shadow book and graded after settlement by `src/shadow-score.mjs`:

- tail: model p <= 2%, best YES bid 3-10c; sell YES by taking the bid (loss floor 1.4%).
- favourite: model p >= 97%, best YES ask 85-97c; buy YES by lifting the ask (loss floor 5.5%; the 85c floor is a guard, not from this record).
- scored per opportunity at its first sighting: gross P&L at that taker price less Kalshi's fee for a 10-lot, per contract. Nothing is rested and nothing is queued; shadow has no depth, no impact and no capital.

Correlation is handled in two places: the allocator sizes the cities of one region on one date as one joint bet and shares one per-event budget (`KXRAIN-<date>:<region>`; regions in `rain-markets.json`), and the daily review counts losses by settlement day, because every rain outcome on a date shares weather systems. Settlement is The Weather Company's `CLIxxx` value with trace counted as 0, and a KXRAIN market closes (resolves yes) the moment rain occurs, so a tail's loss arrives early and the scorer waits for the market's status, not its nominal close.

**Admission.** The lane trades at its policy fraction because its evidence meets the founder's strategy criteria (`kalshi-stake-path-service/src/strategy-admission.mjs`, `content/config/kalshi-strategy-criteria.json`, policy v11): public information only, no liability beyond the stake, risk capital only, an out-of-sample edge after the fee (the 221 tails and 54 favourites above), and a named falsifier (three lane positions settled against the held side in thirty days pause the lane). Each side is sized on its record's upper-bound loss rate. Shadow scoring continues beside the live lane (`node scripts/shadow-score.mjs`, read-only, with the desk's `KALSHI_DESK_STATE_DIR`), and the daily review moves the fraction on live and shadow evidence.
