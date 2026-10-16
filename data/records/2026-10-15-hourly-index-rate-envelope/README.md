# Hourly city index rate envelope — October 15, 2026

Kalshi's hourly temperature contracts settle on its own published city index at a target minute. A strike farther from the latest published reading than the index has ever moved in the time left cannot be reached. `src/weather-index-rate-envelope.mjs` turns that into structural knowledge (kind `index-rate-envelope`), which the forecast-edge lane trades after fees without a forecasting track record.

## The envelope

`scripts/hourly-index-rate-envelope.mjs` reads Kalshi's original `live_data/weather/<city>` minute series, one response per city and UTC day, and records for each horizon the largest rise and fall between any two normal-status readings. `content/config/weather-index-rate-envelope.json` holds the result for 2026-09-01 to 2026-10-14, with every source response's sha256.

Largest rise / fall (F) over 5, 15, 30 and 60 minutes:

| City | 5 min | 15 min | 30 min | 60 min |
|---|---|---|---|---|
| miami | 1.8 / 2.88 | 2.88 / 6.48 | 3.6 / 9.72 | 6.12 / 11.88 |
| chicago | 1.8 / 1.8 | 2.88 / 2.88 | 4.68 / 4.68 | 7.56 / 6.84 |
| nyc | 1.58 / 1.58 | 2.25 / 2.7 | 3.83 / 3.38 | 6.75 / 6.29 |
| la-coastal | 1.8 / 2.52 | 3.24 / 3.6 | 4.68 / 5.04 | 7.92 / 5.76 |

Miami's falls are far larger than its rises (storm outflow). The bound uses each side separately, a 1.5x margin, the smallest tabulated horizon at or above the time left, and an anchor at most 15 minutes old. Its falsifier withdraws the bound for a city whose readings in the last three hours moved beyond the envelope.

## Out-of-sample check

`scripts/hourly-index-rate-envelope-backtest.mjs` fits the envelope on 2026-09-01..09-30 only and replays 2026-10-01..10-14. For every whole-hour target, every decision minute in the hour before it (seeing only readings at least five minutes old, the canonical publication rule) and every integer `greater` strike within 15F of the realized reading, a decided strike is wrong when the realized target reading falls on the other side. `out-of-sample-report.json` holds the full result.

| City | Strike-minutes asked | Decided | Wrong | Decided at 1-5 / 6-15 / 16-30 / 31-60 minutes |
|---|---|---|---|---|
| miami | 625,560 | 211,913 | 0 | 34,205 / 54,473 / 53,435 / 69,800 |
| chicago | 498,360 | 227,180 | 0 | 31,317 / 54,418 / 64,221 / 77,224 |
| nyc | 633,240 | 352,984 | 0 | 38,521 / 72,371 / 94,278 / 147,814 |
| la-coastal | 636,960 | 312,671 | 0 | 39,025 / 70,372 / 84,442 / 118,832 |

The decisions are highly correlated (adjacent strikes and minutes of one target hour), so the evidence is about 1,340 target-hours across four cities with no violation, not a million independent trials.

## What this does not establish

- Whether the book misprices decided strikes often enough, and with enough depth, to pay after fees. That is measured by the desk's own fills and shadow book.
- Behaviour in regimes the window did not contain (fronts in winter, tropical systems). The falsifier is the guard; refit the envelope as the window grows.
- Correctness of the published index itself. Settlement is on Kalshi's published value; a revised or degraded reading changes the anchor, not the rule.

Reproduce: `node scripts/hourly-index-rate-envelope.mjs <cacheDir> 2026-09-01 2026-10-14 content/config/weather-index-rate-envelope.json` and `node scripts/hourly-index-rate-envelope-backtest.mjs <cacheDir> 2026-09-01 2026-09-30 2026-10-01 2026-10-14`.
