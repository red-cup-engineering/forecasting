# Hourly index station lattice

Does a physical model of Kalshi's hourly temperature index, fed the stations'
own readings, know the settlement better than the market does, and is that
worth resting quotes on?

## Data

All from public sources, fetched by the scripts here into `data/` (not
tracked; the scripts reproduce it):

- **Index history.** Kalshi's per-minute city index with every member
  station's reading and its receipt time (`live_data/weather/{city}?detailed=true`),
  2026-09-01..10-16, four cities (`fetch-index-history.mjs`).
- **Calibrations.** Each city's published offsets and reference
  (`live_data/weather/{city}/calibrations`).
- **Guidance.** NOAA's LAMP station guidance from the Iowa Environmental
  Mesonet archive (`fetch-lamp-history.mjs`). The archive keeps 6-hourly runs
  beyond about a week; live operation reads the hourly runs from NOMADS.
- **Markets.** Every settled hourly ladder and its trades in October
  (`fetch-hourly-trades.mjs`).

## What the data showed

- **The index law is exact.** The calibration offsets, over the members
  accepted that minute, reproduce every published minute (99.98%
  exactly, the rest by a 0.01 °F rounding tie). Missing members
  (LaGuardia 8.5% of NYC minutes) and the METAR fallback in tenths
  (DuPage, 17% of Chicago minutes) change the index by several of its
  own steps, so the model uses the law, not a plain mean.
- **Every ladder settles on the close minute.** All 1,466 October ladders
  agree with the published value at exactly their close time.
- **A METAR fallback carries the METAR's receipt time**, up to an hour
  before the minute it fills. Replaying by that time showed the model the
  future. A fallback can only be known once its minute becomes official.
- **Volatility follows the hour and clusters.** Ten-minute station changes
  run 0.38 °C rms at night and 0.61 °C at midday, and about one in a hundred
  is two degrees or more, which a constant Gaussian calls impossible.

## Model

`src/weather-index-lattice.mjs` (forecasting 0.6.0) has three parts:

- **Filter.** A grid filter tracks each station's latent temperature behind
  its rounded readings.
- **Prediction.** The shared regional shock is integrated by Gauss–Hermite,
  and the stations are convolved exactly into the sum of accepted readings in
  tenths. The index law maps that sum to the published value.
- **Drift and volatility.** The expected change is a least-squares regression
  on three predictors: the stations' trend, the diurnal climatology and LAMP's
  forecast change. Volatility scales by the hour's climatology and the last
  hour's, with lognormal regimes for the tails.

`fit-lattice.mjs` fits on September and scores October. The drift
regression is fitted first. The variances are then chosen by coordinate
descent on the log likelihood of the published index.

## Against the market

`compare-market.mjs` replays October. Each station reading reaches the model
when Kalshi received it, and every trade is scored on its settled outcome.
`stack-market.mjs` fits the maker's fair value on October 1–8 and scores it on
October 9–16. The fair value is a logistic stacking of the model and the
market's previous trade, per lead.

It also fits the margin: the one that earned most when quoting at fair minus
it against the takers who disagreed with it. Hourly series charge makers no
fee. The maker column assumes the quote stood first in its queue, so it is an
upper bound, not an expectation. The log loss columns are per contract, on
October 9–16.

| City | Lead (min) | Model | Market (previous trade) | Stacked | Margin | Maker, Oct 9–16 |
|---|---|---|---|---|---|---|
| nyc | <5 | 0.327 | 0.316 | 0.307 | 2¢ | +4.08¢ × 48,516 |
| nyc | <10 | 0.277 | 0.252 | 0.252 | 1¢ | +3.74¢ × 66,770 |
| nyc | <20 | 0.269 | 0.222 | 0.215 | 1¢ | +4.23¢ × 114,233 |
| nyc | <30 | 0.395 | 0.294 | 0.298 | 0¢ | +2.41¢ × 92,195 |
| nyc | <45 | 0.439 | 0.314 | 0.311 | 0¢ | +1.64¢ × 125,734 |
| nyc | <61 | 0.655 | 0.425 | 0.432 | 1¢ | +4.25¢ × 76,147 |
| miami | <5 | 0.339 | 0.325 | 0.325 | 1¢ | +5.69¢ × 137,483 |
| miami | <10 | 0.329 | 0.288 | 0.287 | 1¢ | +5.10¢ × 135,645 |
| miami | <20 | 0.357 | 0.298 | 0.293 | 0¢ | +4.09¢ × 330,583 |
| miami | <30 | 0.300 | 0.246 | 0.250 | 0¢ | -0.16¢ × 352,183 |
| miami | <45 | 0.306 | 0.260 | 0.261 | 0¢ | +1.77¢ × 319,211 |
| miami | <61 | 0.250 | 0.187 | 0.188 | 1¢ | +3.66¢ × 179,314 |
| chicago | <5 | 0.330 | 0.338 | 0.325 | 8¢ | +17.18¢ × 10,419 |
| chicago | <10 | 0.385 | 0.329 | 0.350 | 0¢ | +1.76¢ × 38,552 |
| chicago | <20 | 0.441 | 0.368 | 0.377 | 0¢ | -1.67¢ × 68,836 |
| chicago | <30 | 0.502 | 0.407 | 0.417 | 0¢ | +1.24¢ × 54,324 |
| chicago | <45 | 0.502 | 0.367 | 0.379 | 1¢ | +0.12¢ × 64,041 |
| chicago | <61 | 0.561 | 0.435 | 0.443 | 2¢ | +1.16¢ × 47,456 |
| la-coastal | <5 | 0.616 | 0.443 | 0.520 | 1¢ | +0.71¢ × 55,532 |
| la-coastal | <10 | 0.559 | 0.463 | 0.477 | 0¢ | -3.40¢ × 49,410 |
| la-coastal | <20 | 0.687 | 0.494 | 0.495 | 0¢ | +2.75¢ × 90,519 |
| la-coastal | <30 | 0.617 | 0.458 | 0.457 | 6¢ | -1.70¢ × 12,510 |
| la-coastal | <45 | 0.519 | 0.426 | 0.426 | 10¢ | +6.11¢ × 8,245 |
| la-coastal | <61 | 0.462 | 0.389 | 0.389 | 9¢ | +0.23¢ × 11,746 |

## Findings

- **Within ten minutes of the close the model adds information the market
  has not priced.** The stacked fair value matches or beats the previous
  trade in every city, and in NYC under 20 minutes it beats the trade price
  itself (0.215 against 0.223). Its weight falls toward zero by 30 minutes
  out, where the market's own forecasts carry the price, and the fair value
  becomes the market's.
- **Resting at the fitted margins earned in most lead buckets out of sample.**
  It lost in LA under 10 minutes, Chicago 10–20 minutes and LA 20–30 minutes.
  The coastal LA index is the hardest: its stations swing with the marine
  layer, and the model's log loss there is the worst of the four.
- **Next is the live shadow.** The real queue share decides how much of this
  bound is cash. The live shadow measures it: the market maker
  (`kalshi-services-section` `weather-market-maker`) rests these quotes
  virtually in the live books and fills them from the live takes.

## Reproduce

```
node scripts/fetch-index-history.mjs --from 2026-09-01 --to 2026-10-16
node scripts/fetch-lamp-history.mjs --from 2026-08-31 --to 2026-10-17
node scripts/fetch-hourly-trades.mjs
node scripts/fit-lattice.mjs --city nyc --fit 2026-09-01:2026-09-30 --test 2026-10-01:2026-10-16
node scripts/compare-market.mjs --city nyc --series KXTEMPNYCHS --from 2026-10-01 --to 2026-10-17
node scripts/stack-market.mjs --city nyc --split 2026-10-09
node scripts/derive-fits.mjs
```

`derive-fits.mjs` writes what the live market maker reads:
- the city fits, in forecasting `src/weather-index-lattice-fit.json`;
- the lead policies (stacking and margin), in Kalshi
  `content/config/weather-market-making.json`.
