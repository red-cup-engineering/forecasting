# Belief-path laboratory, 2026-10-04

Research only. Public Kalshi data (no credentials), no orders, no policy edits. Realises the program in section 6 of `science-services-section/.../finance-science-services-section/.../2026-10-04-note-on-trading-the-belief-path.md`, building on `../2026-10-04-kalshi-microstructure` (fill model, 5-minute books) and `../2026-10-03-kalshi-sports-edges`.

Layout: `scripts/` (re-runnable), `results/` (JSON per class and test, plus `summary.md` with every table), `data/` (raw candles and market lists, git-ignored via `data/.gitignore`, about 110 MB, regenerable).

Reproduce: `cd scripts; python3 collect_series.py; python3 collect_markets.py CLASS; python3 collect_candles.py CLASS` (CLASS in weather gas sports_game sports_prop mentions econ crypto), then `./run_class.sh CLASS` (martingale with spread cap 5c, overreaction, round-trip scan, longshot), `./run_mart.sh CLASS` (martingale at cap 5c and at all spreads), `python3 maker_candidate.py mentions 10 120`, `python3 books5m.py`, `python3 report.py`. The collectors are rate-limit tolerant (429 backoff, 0.35 s gap).

## Bottom line

1. **No path lane survives costs.** Across 7 market classes, 4 horizons, about 2,450 state-bin cells, every taker round trip (enter at the ask or bid-implied NO price, exit into the later bid, Kalshi fee on both orders, one minute of latency) has a negative mean, and the scan found **0 surviving cells** (fit-half mean > 0 and confirm-half 95% lower bound > 0) in every class. Unconditional 30-minute round trips lose 4.9c (sports games), 5c (crypto), 9c (weather), 12c (econ), 16c (mentions), 28 to 38c (props, gas); their books are wide.
2. **Several classes are not martingales, and the reversion is real on the mid.** After a one-minute jump of >= 5c in a thin book, the mid gives back +2 to +9c by 30 minutes (mentions, gas, weather, props, econ), the same in both date halves. That drift is mostly the book re-centring (quote noise, wide stale spreads). It is paid in spread, not in cash: the taker fade nets -4 to -35c, and the maker version of the same fade is near zero after adverse selection.
3. **One weak lead, not admitted:** a maker-in fade after >= 10c jumps in thin *mention* markets (+0.67c per placement at 2h, event CI [+0.08, +1.37], fill rate 16%). It fails day-clustering ([-0.04, +1.64]), the fit half ([-0.46, +1.60]), and any multiple-comparison correction (about 330 strict-fill maker cells were examined). A zero-risk shadow is the only thing it can justify (section 6).
4. **The tail "theta" is back-loaded and is only collectable at settlement.** Certified weather tails (ask 2-5c) do not decay 24h out and decay about 0.3c/hour in the last 12 hours; selling early and buying back loses 3 to 4c to spread and fees every time. Holding wins because settlement carries no exit spread or fee. The sample (65 events at 12h) cannot exclude a 5% hit rate, so the tail edge itself is not confirmed by this window (section 5).

## Data

1-minute Kalshi candles (`/markets/candlesticks`: yes-bid close, yes-ask close, trade close/low/high, volume, open interest) for markets settled 2026-09-03 to 2026-10-04, event-sampled (seeded) with a cap, only markets that ever traded. Candles exist only for minutes with activity, so the lab forward-fills quotes onto a 1-minute grid per market to the market's close (state persists between candles); after the last minute the contract is worth X in {0,1}.

| class | series | markets | events | close dates | contested-minute obs (stride 3, spread <= 5c) |
|---|---|---|---|---|---|
| weather | KXHIGH/KXLOWT x NY CHI MIA AUS LAX DEN PHIL | 702 | 117 | 09-25..10-03 | 132,841 |
| gas | KXAAAGASD (+CA AZ PA NC GA) | 926 | 48 | 09-26..10-03 | 17,389 |
| sports_game | NFL NCAAF MLB WNBA NHL NBA MLS ATP WTA game-winner | 1,136 | 560 | 09-26..10-04 | 171,542 |
| sports_prop | NFL pass/rec/rush yards, any-TD, MLB hit/Ks/HRR, NHL goal/points | 1,799 | 44 | 09-26..10-04 | 16,106 |
| mentions | all Mentions-category series (earnings calls, speeches) | 1,685 | 92 | 09-20..10-03 | 157,182 |
| econ | CPI, jobs, claims, Fed, GDP series | 187 | 15 | 09-03..10-02 | 33,456 |
| crypto | BTC/ETH/SOL/XRP/DOGE hourly and 15-minute | 1,800 | 338 | 09-30..10-04 | 9,262 |

Also the microstructure collector's 5-minute books (`books5m.py`; 4,784 snapshots, 439 tickers, 16 sweeps over 1.3 hours, so n = 610 to 872 pairs).
Not available: CPI settled markets (series listed none in the window), CPI/jobs as a clean release-day sample (the econ class is 15 events, mostly long-dated with few releases, so its CIs are wide); NBA/NHL props (out of season or thin).

## Method (what was done, and the traps avoided)

- **Observations.** Minute `t` with a two-sided book (bid >= 1c, ask <= 99c, ask > bid), mid in 5-95c, and (for the headline martingale tables) quoted spread <= 5c, so the mid is a price and not the midpoint of a 1c bid and a 99c ask (gas and weather ladders are full of those; the all-spreads variant is reported beside). Every third minute is used.
- **Look-ahead.** Sports `close_time` is set when the winner is declared, so any "hours to close" for sports is look-ahead (the sports-edges record found this). Sports use hours since scheduled start for the time feature and for calibration buckets. Tail cohorts for sports likewise. Other classes' close times are scheduled in advance (mentions is the one to treat with care: some close with the event).
- **Targets.** `d_mid(h)` = mid(t+h) - mid(t) in cents, `d_bid(h)` likewise; past the market's end the price is the settlement value X. Horizons 1, 5, 30, 120 minutes, and to resolution (calibration X - mid, and executable hold-to-settlement).
- **Tests.** Mean drift; variance ratio VR(h) = Var(d_h)/(h Var(d_1)); autocorrelation of consecutive h-minute moves; OLS of `d_mid` and `d_bid` on eight state features (log hours, mid - 0.5, distance to edge, spread, 5-minute trade-flow imbalance, log 5-minute volume, last 1-minute move, last 5-minute move), standardised on the fit half; out-of-sample gain over the zero (martingale) forecast. **Held-out split by date**: fit on the first half of dates, confirm on the second. A feature "survives" only if |t| >= 3 in the fit half, |t| >= 2 in the test half with the same sign (cluster-robust).
- **Clustering.** Bootstrap and OLS standard errors cluster by **event**; the table also gives **day** clusters for drift (events on one day share weather, price and news shocks; weather has only 9 days, crypto 5, so day CIs are the honest ones there).
- **Round trips (`rt.py`).** YES-long: pay the ask at t+L, sell into the bid at t+L+h (or collect X at settlement, no fee). NO-long: pay 1 - bid, exit at 1 - ask. Fee = ceil-to-cent of 0.07 C P (1-P) per order (C = 1 and 10), both legs; settlement exits pay no fee. A missing exit quote is charged as worthless (the conservative reading). L = 0 and 1 minute reported (L = 1 is the realistic one for a polling process; candle closes are the earliest we can act on). Maker-in variant: join the touch on the fade side, **strict fill** (a trade prints through our price within 10 minutes), taker exit h minutes after the fill, maker fee 0 (series with `quadratic_with_maker_fees` charged), EV per placement counts unfilled placements as 0. Strict fills already embed the adverse selection the microstructure study found (fills come when price moves through you); queue position is not modelled (the 1-minute candles carry no depth), so maker EVs are an upper bound.
- **Caveats on the proxies.** Candles carry no taker side, so "flow imbalance" is the sign of (last trade price - previous mid) weighted by volume. "Incentive presence" is constant within a class (gas ladders carry LIP programs, weather does not), so it is a class contrast, not a regressor; gas shows the largest non-martingale effects and the widest books, consistent with farmers pinning static quotes. The order-book features (depth imbalance, micro-price) come only from the small books sample.

## Results

Full tables (every class, horizon, bucket, with CIs and fit/test halves) are in `results/summary.md`. Condensed:

### Martingale tests, class x horizon (mid, spread <= 5c)

MG = not rejected. "not MG" lists what rejected it (drift: event and day CIs both exclude 0; VR: variance-ratio CI excludes 1; feat: a feature confirmed out of sample). Effect is the mean drift over the horizon in cents with the event CI, and the sd of the move.

| class | 1 min | 5 min | 30 min | 2 h |
|---|---|---|---|---|
| weather | not MG (feat): -0.00c, sd 0.9 | not MG (feat): -0.01c, sd 1.9 | not MG (drift, feat): +0.06c [+0.03,+0.09], sd 4.5 | not MG (drift): +0.38c [+0.28,+0.48], sd 8.7 |
| gas | not MG (feat): +0.00c, sd 2.1 | not MG (VR 0.84, feat): sd 4.3 | not MG (VR 0.53, feat): -0.47c [-1.00,+0.22], sd 8.3 | not MG (drift, VR 0.37, feat): -1.67c [-3.04,-0.08], sd 13.5 |
| sports_game | MG: -0.00c, sd 1.8 | not MG (drift, VR 1.11): -0.01c, sd 4.0 | not MG (VR 1.10): sd 9.4 | not MG (VR 0.91): +0.01c [-0.01,+0.03], sd 18 |
| sports_prop | not MG (drift, feat): +0.37c [+0.14,+0.55], sd 3.9 | not MG (VR 0.58, feat): sd 6.4 | not MG (drift, VR 0.44, feat): -1.84c [-3.65,-0.32], sd 13 | not MG (drift, VR 0.48): -4.35c [-9.54,-0.44], sd 32 |
| mentions | not MG (drift): -0.01c, sd 0.9 | not MG (drift, feat): -0.05c, sd 1.9 | not MG (drift, feat): -0.31c [-0.44,-0.21], sd 4.6 | not MG (drift, VR 1.70): -0.77c [-1.22,-0.29], sd 11 |
| econ | MG: -0.01c [-0.02,+0.01], sd 0.6 | MG: -0.00c, sd 1.1 | not MG (feat): -0.01c, sd 2.8 | MG: +0.08c [-0.20,+0.40], sd 6.2 |
| crypto | MG: +0.19c [-0.02,+0.44], sd 5.8 | not MG (VR 0.82): sd 11 | not MG (VR 0.70): sd 28 | not MG (VR 0.28): sd 34 |

Reading it honestly:

- **Effect sizes are small next to costs.** The weather 2h drift is +0.38c on an 8.7c sd; the weather 30-minute drift is +0.06c. Variance ratios below 1 (crypto 0.28, props 0.5, gas 0.4 at 2h) mean mean-reverting noise in the mid (quotes stepping around stale or one-sided books), not a tradable swing. Sports game mids are the closest to martingales (VR 1.1 to 0.9, drift ~0), crypto and econ are martingales at 1 minute and their longer horizons are noise-dominated.
- **Confirmed state features (fit and test, same sign):** 5-minute flow imbalance predicts the next 30 minutes in weather (+0.27c per sd), mentions (+0.19c) and gas (+0.47c, all-spreads); the last 5-minute move **reverses** at 30 minutes (gas -1.3c per sd, props -0.9c, econ -0.3c, weather -0.3c all-spreads); in sports props the mid drifts toward the extremes less than it should (mid - 0.5 coefficient -6.8c per sd at 30 minutes). Out-of-sample gain over the zero forecast is 0.3% to 15% of squared move (gas 5-minute 7.2% [0.6, 12.8], props 30-minute 14.9% [3.1, 20.2]), and falls to zero or negative for crypto and econ.
- **On the bid** the confirmed features are mostly `spread` and `volume`: the bid rises when the spread is wide (the book re-centres) and when volume is high. That is mechanical, and it is not an edge: you entered at the ask, `ask - bid` higher than the bid's rise.
- **To resolution (calibration, the settlement game).** Gas mids are badly calibrated in the 20-80c range (E[X - mid] = -35c to +29c by bucket), and sports props overprice YES in the last hours (-6 to -19c), but both come from one-sided, farmer-pinned books where the mid is not a price; executed at the ask or bid they leave only **1 net-positive hold cell of 37 for gas** (favourites at 90-99c, 1 to 3h before close, +2.4c C=1 [+1.4, +3.1], fit +1.3 / test +3.2, 47 events), 1 of 39 for sports games (pre-game 70-90c, lower bound only at C=10) and 4 of 23 for econ from only 8 to 14 events (not trustworthy). Weather, mentions, props and crypto have none. These are settlement lanes, not path lanes.

### Overreaction (section 6.4): after |d mid| >= k cents in one minute

First trigger per market per 30 minutes; thin = spread >= 4c or less than 5 contracts in the last hour. `rev` = reversion of the mid toward the pre-move level in cents (positive = fading works on the mid). `taker fade` = executable round trip, fees both legs, L = 1 minute.

| class | k | liquidity | triggers (events) | rev 30 min [CI] | rev 2 h [CI] | taker fade 2 h | maker-in strict, EV/placement 2 h |
|---|---|---|---|---|---|---|---|
| mentions | 10 | thin | 3,067 (88) | +4.1 [+3.1, +4.9] | +6.5 [+5.2, +8.0] | -19.6c | +0.69 [+0.13, +1.43] |
| gas | 10 | thin | 1,687 (48) | +8.9 [+7.3, +10.5] | +10.8 [+8.4, +13.4] | -29.9c | -0.22 [-0.54, +0.09] |
| weather | 10 | thin | 592 (94) | +3.9 [+2.7, +4.7] | +4.2 [+2.4, +5.8] | -15.4c | +0.42 [-0.52, +1.44] |
| sports_prop | 10 | thin | 2,725 (44) | +13.0 [+10.7, +14.8] | +12.9 [+10.8, +14.6] | -17.9c | -0.25 [-0.66, +0.13] |
| econ | 10 | thin | 138 (12) | +11.0 [+8.0, +14.8] | +12.2 [+9.2, +16.0] | -15.4c | -0.00 [-0.04, +0.03] |
| sports_game | 10 | thin | 413 (195) | -0.1 [-2.6, +2.4] | +2.5 [-1.2, +6.7] | -4.6c | -2.52 [-6.33, +1.22] |
| crypto | 10 | thin | 785 (308) | -0.9 [-3.8, +2.8] | -0.9 [-4.4, +2.7] | -5.6c | -4.36 [-6.95, -1.60] |
| weather | 5 | thick | 679 (101) | +1.1 [+0.2, +1.9] | +0.7 [-1.1, +2.1] | -5.6c | -1.62 [-3.12, -0.20] |
| gas | 5 | thick | 261 (20) | +2.7 [+1.3, +4.1] | +3.9 [+2.0, +5.7] | -1.7c | -0.19 [-1.15, +0.64] |
| mentions | 5 | thick | 304 (70) | +2.8 [+1.4, +4.3] | +3.9 [+0.7, +7.6] | -4.4c | +0.34 [-2.31, +2.69] |

- The hypothesis behind 6.4 holds for the **mid** in thin books of weather, gas, props, econ and mentions (the reversion is the same in both date halves, e.g. mentions k = 10 at 30 minutes fit +3.8 / test +4.3). It does **not** hold in sports games or crypto, where large jumps are news (no reversion, slight continuation).
- **It does not hold for money.** Thin means a 4c+ spread and a 1c+ fee on each leg, so the fade costs 15 to 35c; the best taker fade anywhere (thick gas, k >= 5, 2 hours) is -1.7c [-3.5, -0.2]. Crossing the spread on the way out is what kills it; a market maker who already holds the touch is the only party that earns the reversion, and for us strict-fill adverse selection (fills come when the move continues; EV given fill is -4 to -7c in weather for k <= 5) takes it back.
- Maker-in cells with a positive event-CI lower bound: only mentions k = 10 thin at 2h (+0.69c; checked in section 6) in the whole grid; every other class and cell has a lower bound at or below zero.

### Round-trip scan over state bins

For every class and horizon (5, 30, 120 minutes), both sides, all/tight-spread (<= 2c) books, 5 quantile bins of each feature plus unconditional: 285 to 426 cells per class, `fit-half mean > 0`: weather 0, gas 3, sports_game 0, sports_prop 0, mentions 0, econ 0, crypto 4; **surviving (also confirm-half lower bound > 0): 0 in every class.** The best cells by confirm-half lower bound are tight-spread bins that still lose about 3c (weather -3.1c, sports -3.3c, mentions -3.4c), which is a fee plus a half spread on each leg. Details and the unconditional rows are in `results/summary.md` section 3 and `results/rtscan-*.json`.

### Order-book features (5-minute books)

Depth imbalance, micro-price, top-of-book imbalance, spread, size: no coefficient has |t| > 1.7 for the 5/10/15-minute change of mid or bid (n = 610 to 872 pairs). The sample (1.3 hours) is far too short to conclude; the collector should keep running and `books5m.py` should be rerun on a multi-day book tape.

## 5. Longshot decay: what the tail lane collects

Cohort: first minute at or after a fixed time before close (24, 12, 6, 3, 1 h; sports: hours since start) with ask 2-5c and bid >= 1c. Followed to settlement. (`results/longshot-*.json`, `summary.md` section 4.) Settlement rate CI is Wilson with the number of independent events as the sample, because a bootstrap is degenerate when no tail hits.

| cohort | n (events) | entry ask/bid | YES rate | mean mid at entry, +30m, +2h | held to settlement (taker, C=1) | resting-at-ask gross if it fills |
|---|---|---|---|---|---|---|
| weather 24 h | 154 (94) | 3.1 / 1.8c | 0.6% [0.1, 5.1] | 2.46, 2.42, 2.33 | +0.14c | +2.47c |
| weather 12 h | 87 (65) | 3.2 / 1.7c | 0 [0, 5.6] | 2.44, 2.12, 1.77 | +0.70c | +3.17c |
| weather 6 h | 32 (25) | 3.2 / 1.4c | 0 [0, 13] | 2.33, 2.08, 2.00 | +0.44c | +3.22c |
| gas 6 h | 121 (43) | 2.6 / 1.3c | 0 [0, 8.2] | 1.97, 2.02, 1.96 | +0.31c | +2.63c |
| mentions 24 h | 45 (14) | 3.6 / 2.0c | 0 [0, 21] | 2.78, 2.84, 2.42 | +0.98c | +3.58c |

- **The curve.** Weather tails entered 24 hours out do not decay at all (ask 3.12c, 3.12c four hours later). Tails entered 12 hours out lose 0.44c of ask by +1h and 1.30c [-1.63, -0.89] by +4h; at settlement they fall to 0. Decay is back-loaded and the average ask drops by about 0.3c an hour inside the last 12 hours (gas and mentions are flatter at these ages). The premium itself (ask minus the realised hit rate) is about 2.5 to 3.2c on rates of 0 to 0.6%.
- **Why holding wins.** Selling the tail now and buying it back at +30 minutes, +2 hours or +4 hours loses 2.9 to 4.3c in weather (the entry-side spread, the exit spread and a fee on each leg), so the path version of the tail lane is strictly worse. A resting sell at the ask collects ~3.1c at settlement if it fills; a taker hitting the bid collects the bid (1.3 to 2.0c) less a 1c fee at C = 1 (about +0.3 to +1.0c; C = 10 gives +1.1 to +1.8c).
- **What the window cannot say.** With 65 events at 12 hours and no YES, the 95% upper bound on the hit rate is 5.6%, which is larger than the premium (3c), so this sample alone cannot confirm the tail edge; the earlier 2026-10-03 backtest and the desk's live settlements carry that claim, not this record. Mentions, crypto and sports tails entered 1 to 3 hours before close or at game start show YES rates of 4.6 to 12% (fewer than 20 events in several cells) and negative hold EVs, which supports keeping the lane to certified far tails rather than any 2-5c price.

## 6. Does any path lane deserve a shadow?

- **Taker path lanes (trend, reversion, overreaction fade, flow, state bins): no.** 0 of ~2,450 cells survive; the best are about -3c. Do not build a shadow.
- **Maker fade after large jumps in thin mention markets: shadow only, and only because shadows are free.** Cell: |d mid| >= 10c in one minute, spread >= 4c or trailing-hour volume < 5, rest at the touch on the fade side, 2h exit by crossing. Evidence: +0.67c per placement, event CI [+0.08, +1.37]; day CI [-0.04, +1.64]; fit half +0.54 [-0.46, +1.60], test half +0.79 [+0.03, +1.60]; fills 16%, +4.3c given fill; splits: exits at a real bid +0.32c [-0.09, +0.74], exits at settlement +0.36c [-0.15, +0.89]; **placebo** (same placements, fill window shifted 60 minutes) -1.06c [-1.47, -0.70] and the **momentum** side -1.28c [-1.86, -0.65], so the sign is not generic. Against it: about 330 strict-fill maker cells were examined (Bonferroni makes a 95% bound meaningless), 88 events over 14 days, queue is not modelled, and mention markets may close with the event (look-ahead risk on the exit-at-settlement half). Pre-registered bar for admission: >= 300 shadow fills across >= 40 new events, day-clustered lower bound > 0 after fees, and EV given fill at least 2c after queue-aware fills.
- **Market making (route c)** is not tested here beyond the maker-in cells; their negative EV given fill in weather (-4 to -7c at k <= 5) says the touch is toxic in the same moments the mid overshoots.
- **Settlement-game cells that came out of the by-product table** (gas favourites 90-99c at 1-3 hours: +2.4c [+1.4, +3.1]; sports pre-game 70-90c) are leads for the existing hold lanes, not path lanes; they need the queue-aware gas fill model (gas bids behind 1,000-3,400 contracts mostly do not fill) before a shadow.

## Limits of this study

Window: 2026-09-03 to 2026-10-04 (mostly the last 9 to 14 days), one early-season slice (NFL/NCAAF/MLB playoff race, tennis hard courts, no NBA). Event counts are small for props (44), econ (15) and crypto day clusters (5). 1-minute candle closes are not tick data: bid/ask closes miss intra-minute moves and a 1-minute latency is optimistic for a human and pessimistic for a co-located bot. No queue or depth in candles. Selected only markets with volume >= 1 contract. The first-trigger-per-30-minutes rule and the 5-95c contested filter shape the samples (stated, not tuned). No parameter was tuned on the test half.
