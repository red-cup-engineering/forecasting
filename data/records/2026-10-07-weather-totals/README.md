# Weather at outdoor venues vs Kalshi sports totals (2026-10-07)

Status: pre-registration (commit c39c1c1, made before any Kalshi price, ESPN score or weather value was joined or any
statistic computed) followed by results. The pre-registration text is unchanged; results begin at "Data and execution".

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

## Data and execution (added with results)
- Code: `scripts/weather-totals-study.mjs` (subcommands espn, kalshi, match, geocode, wx, candles, analyze), pure helpers
  `src/venue-weather.mjs`, test `test/venue-weather.test.mjs`, venue table `src/venue-coords.json`. Cache is outside the repo.
- ESPN scoreboard (`site.api.espn.com`, nfl / college-football groups=80 / mlb): final games, start time, venue, `indoor`, scores.
  Games flagged indoor (domes AND ESPN-flagged retractable-roof parks) were never priced; the extra roof-list filter removed 1 MLB game.
- Kalshi: settled markets per series; actual total = market `expiration_value` (equals the ESPN score sum for every matched game, the match key);
  1-minute candles for start-180..start-60 min, last two-sided candle at or before start - 60 min, required to be within 60 min of it.
  Kalshi paced at 450 ms; no 429 occurred.
- Event join: ticker date (ET) + total equality + team-name/abbreviation score. Ambiguous or unmatched events (mostly FCS games that Kalshi lists and ESPN
  FBS scoreboard lacks) dropped: NFL 75/80, NCAAF 387/656, MLB 806/814 matched; of those priced and outdoor: NFL 57, NCAAF 377, MLB 589 (590 with roof list).
- Venue coordinates: ESPN venue city/state geocoded with Open-Meteo geocoding (GeoNames), i.e. city centre, not stadium centre (error a few km, below the
  ~10 km model grid); 189 venues, all resolved, table committed in `src/venue-coords.json` with the source tag. No stadium-orientation data (MLB wind-to-CF not used).
- Weather: Open-Meteo previous-runs API `*_previous_day1` (tradable, issued about 24 h before), window mean from the start hour over 3 h (football) or 2 h (MLB);
  Open-Meteo archive as sanity check (forecast vs archive correlation: wind 0.70-0.75, temp 0.92-0.96).
  Implementation note: fees use 0.07 x P(1-P) per contract with multiplier 1.0 and no cent rounding, as pre-registered.
- Entry quote is the last two-sided candle <= start-60 and >= start-120 min; the ladder median is from the same candles.

## Results (raw output of `weather-totals-study.mjs analyze`)
Regression coefficient units: points (football) or runs (MLB) of (actual total - market-implied median) per mph, mm or deg F. Cell format in the rule
table: n / mean net P&L per contract (SE across games). "baseline" = the same side on the nearest-to-50% rung over ALL games of that sport.

## Sample

```
{"nfl":{"matched":75,"indoor":0,"noquote":0,"nomedian":0,"nowx":0,"used":57},"ncaaf":{"matched":387,"indoor":0,"noquote":0,"nomedian":0,"nowx":0,"used":377},"mlb":{"matched":806,"indoor":0,"noquote":0,"nomedian":0,"nowx":0,"used":590}}
```

### Regression nfl: n=57 games, mean resid 0.430 (SE 1.886), sd 14.238

| spec | n | coefficients (SE, game-clustered) | R2 |
|---|---|---|---|
| multi | 57 | wind -1.148 (1.152) t=-1.00; gust 0.303 (0.655) t=0.46; precip -7.423 (4.367) t=-1.70; temp -0.027 (0.211) t=-0.13 | 0.0502 |
| wind | 57 | wind -0.610 (0.571) t=-1.07 | 0.0174 |
| gust | 57 | gust -0.245 (0.338) t=-0.73 | 0.0098 |
| precip | 57 | precip -6.281 (3.330) t=-1.89 | 0.0261 |
| temp | 57 | temp 0.087 (0.189) t=0.46 | 0.0036 |

venue-clustered:
| spec | n | coefficients (SE) | R2 |
|---|---|---|---|
| multi | 57 | wind -1.148 (1.284) t=-0.89; gust 0.303 (0.775) t=0.39; precip -7.423 (4.631) t=-1.60; temp -0.027 (0.225) t=-0.12 | 0.0502 |
| wind | 57 | wind -0.610 (0.560) t=-1.09 | 0.0174 |

forecast-vs-archive corr: wind 0.75, temp 0.96; archive-feature sanity regression:
| spec | n | coefficients | R2 |
|---|---|---|---|
| multi | 57 | wind 0.370 (1.249) t=0.30; gust -0.060 (0.666) t=-0.09; precip -3.002 (1.663) t=-1.81; temp -0.005 (0.188) t=-0.03 | 0.0847 |
| wind | 57 | wind 0.049 (0.643) t=0.08 | 0.0001 |

### Regression ncaaf: n=377 games, mean resid 1.212 (SE 0.741), sd 14.380

| spec | n | coefficients (SE, game-clustered) | R2 |
|---|---|---|---|
| multi | 377 | wind -0.622 (0.507) t=-1.23; gust 0.192 (0.276) t=0.69; precip -0.296 (0.314) t=-0.95; temp 0.007 (0.074) t=0.10 | 0.0143 |
| wind | 377 | wind -0.373 (0.249) t=-1.50 | 0.0055 |
| gust | 377 | gust -0.129 (0.132) t=-0.98 | 0.0024 |
| precip | 377 | precip -0.311 (0.309) t=-1.01 | 0.0091 |
| temp | 377 | temp 0.003 (0.071) t=0.04 | 0.0000 |

venue-clustered:
| spec | n | coefficients (SE) | R2 |
|---|---|---|---|
| multi | 377 | wind -0.622 (0.520) t=-1.20; gust 0.192 (0.280) t=0.69; precip -0.296 (0.315) t=-0.94; temp 0.007 (0.077) t=0.09 | 0.0143 |
| wind | 377 | wind -0.373 (0.243) t=-1.54 | 0.0055 |

forecast-vs-archive corr: wind 0.70, temp 0.94; archive-feature sanity regression:
| spec | n | coefficients | R2 |
|---|---|---|---|
| multi | 377 | wind 0.560 (0.659) t=0.85; gust -0.326 (0.317) t=-1.03; precip 0.386 (0.539) t=0.72; temp 0.009 (0.081) t=0.11 | 0.0036 |
| wind | 377 | wind -0.042 (0.274) t=-0.15 | 0.0001 |

### Regression football: n=434 games, mean resid 1.110 (SE 0.689), sd 14.347

| spec | n | coefficients (SE, game-clustered) | R2 |
|---|---|---|---|
| multi | 434 | wind -0.658 (0.459) t=-1.43; gust 0.189 (0.253) t=0.75; precip -0.296 (0.313) t=-0.95; temp 0.019 (0.068) t=0.28 | 0.0146 |
| wind | 434 | wind -0.409 (0.228) t=-1.79 | 0.0068 |
| gust | 434 | gust -0.147 (0.123) t=-1.20 | 0.0031 |
| precip | 434 | precip -0.314 (0.310) t=-1.01 | 0.0081 |
| temp | 434 | temp 0.016 (0.066) t=0.24 | 0.0001 |

venue-clustered:
| spec | n | coefficients (SE) | R2 |
|---|---|---|---|
| multi | 434 | wind -0.658 (0.475) t=-1.38; gust 0.189 (0.261) t=0.72; precip -0.296 (0.314) t=-0.94; temp 0.019 (0.072) t=0.26 | 0.0146 |
| wind | 434 | wind -0.409 (0.222) t=-1.84 | 0.0068 |

forecast-vs-archive corr: wind 0.71, temp 0.94; archive-feature sanity regression:
| spec | n | coefficients | R2 |
|---|---|---|---|
| multi | 434 | wind 0.553 (0.584) t=0.95; gust -0.317 (0.285) t=-1.11; precip -0.023 (0.562) t=-0.04; temp 0.013 (0.074) t=0.17 | 0.0028 |
| wind | 434 | wind -0.023 (0.252) t=-0.09 | 0.0000 |

### Regression mlb: n=589 games, mean resid 0.621 (SE 0.176), sd 4.276

| spec | n | coefficients (SE, game-clustered) | R2 |
|---|---|---|---|
| multi | 589 | wind -0.174 (0.100) t=-1.74; gust 0.069 (0.053) t=1.30; precip -0.191 (0.078) t=-2.45; temp 0.009 (0.019) t=0.49 | 0.0071 |
| wind | 589 | wind -0.072 (0.051) t=-1.40 | 0.0028 |
| gust | 589 | gust -0.015 (0.026) t=-0.59 | 0.0005 |
| precip | 589 | precip -0.193 (0.063) t=-3.06 | 0.0022 |
| temp | 589 | temp 0.009 (0.018) t=0.49 | 0.0004 |

venue-clustered:
| spec | n | coefficients (SE) | R2 |
|---|---|---|---|
| multi | 589 | wind -0.174 (0.101) t=-1.72; gust 0.069 (0.053) t=1.31; precip -0.191 (0.060) t=-3.16; temp 0.009 (0.018) t=0.52 | 0.0071 |
| wind | 589 | wind -0.072 (0.044) t=-1.65 | 0.0028 |

forecast-vs-archive corr: wind 0.70, temp 0.92; archive-feature sanity regression:
| spec | n | coefficients | R2 |
|---|---|---|---|
| multi | 589 | wind 0.193 (0.123) t=1.57; gust -0.096 (0.059) t=-1.64; precip -0.162 (0.096) t=-1.69; temp 0.013 (0.022) t=0.58 | 0.0065 |
| wind | 589 | wind 0.005 (0.059) t=0.08 | 0.0000 |

### Regression mlb incl roof parks: n=590 games, mean resid 0.616 (SE 0.176), sd 4.274

| spec | n | coefficients (SE, game-clustered) | R2 |
|---|---|---|---|
| multi | 590 | wind -0.169 (0.099) t=-1.70; gust 0.067 (0.053) t=1.25; precip -0.190 (0.077) t=-2.45; temp 0.010 (0.019) t=0.51 | 0.0070 |
| wind | 590 | wind -0.071 (0.051) t=-1.39 | 0.0027 |
| gust | 590 | gust -0.016 (0.026) t=-0.61 | 0.0005 |
| precip | 590 | precip -0.193 (0.063) t=-3.05 | 0.0021 |
| temp | 590 | temp 0.009 (0.018) t=0.52 | 0.0004 |

venue-clustered:
| spec | n | coefficients (SE) | R2 |
|---|---|---|---|
| multi | 590 | wind -0.169 (0.101) t=-1.68; gust 0.067 (0.052) t=1.27; precip -0.190 (0.060) t=-3.17; temp 0.010 (0.018) t=0.54 | 0.0070 |
| wind | 590 | wind -0.071 (0.043) t=-1.64 | 0.0027 |

forecast-vs-archive corr: wind 0.70, temp 0.92; archive-feature sanity regression:
| spec | n | coefficients | R2 |
|---|---|---|---|
| multi | 590 | wind 0.194 (0.123) t=1.58; gust -0.096 (0.059) t=-1.64; precip -0.161 (0.096) t=-1.68; temp 0.013 (0.022) t=0.61 | 0.0065 |
| wind | 590 | wind 0.004 (0.059) t=0.07 | 0.0000 |

## Rules (cell = n / mean net P&L per contract (SE))

| rule | slice | net | gross | mean ask |
|---|---|---|---|---|
| R1 nfl | all (pooled) | 1 / 0.482 (NA) | 1 / 0.500 (NA) | 0.50 |
| R1 nfl | holdout (2026-09) | 1 / 0.482 (NA) | 1 / 0.500 (NA) | 0.50 |
| R1 nfl | train (-) | 0 | 0 | NA |
| R1 nfl | 2026-07 | 0 | 0 | NA |
| R1 nfl | 2026-08 | 0 | 0 | NA |
| R1 nfl | 2026-09 | 1 / 0.482 (NA) | 1 / 0.500 (NA) | 0.50 |
| R1 nfl | 2026-10 | 0 | 0 | NA |
| R1 nfl | baseline: same NO rung rule, ALL games | 57 / 0.002 (0.067) | 57 / 0.019 (0.067) | 0.51 |
| R1 ncaaf | all (pooled) | 10 / -0.016 (0.162) | 10 / 0.001 (0.162) | 0.50 |
| R1 ncaaf | holdout (2026-09+2026-10) | 10 / -0.016 (0.162) | 10 / 0.001 (0.162) | 0.50 |
| R1 ncaaf | train (-) | 0 | 0 | NA |
| R1 ncaaf | 2026-07 | 0 | 0 | NA |
| R1 ncaaf | 2026-08 | 0 | 0 | NA |
| R1 ncaaf | 2026-09 | 9 / -0.072 (0.171) | 9 / -0.054 (0.171) | 0.50 |
| R1 ncaaf | 2026-10 | 1 / 0.482 (NA) | 1 / 0.500 (NA) | 0.50 |
| R1 ncaaf | baseline: same NO rung rule, ALL games | 377 / -0.077 (0.026) | 377 / -0.060 (0.026) | 0.51 |
| R1 football | all (pooled) | 11 / 0.029 (0.154) | 11 / 0.046 (0.154) | 0.50 |
| R1 football | holdout (2026-09+2026-10) | 11 / 0.029 (0.154) | 11 / 0.046 (0.154) | 0.50 |
| R1 football | train (-) | 0 | 0 | NA |
| R1 football | 2026-07 | 0 | 0 | NA |
| R1 football | 2026-08 | 0 | 0 | NA |
| R1 football | 2026-09 | 10 / -0.016 (0.162) | 10 / 0.001 (0.162) | 0.50 |
| R1 football | 2026-10 | 1 / 0.482 (NA) | 1 / 0.500 (NA) | 0.50 |
| R1 football | baseline: same NO rung rule, ALL games | 434 / -0.067 (0.024) | 434 / -0.050 (0.024) | 0.51 |
| R2 mlb | all (pooled) | 19 / -0.054 (0.115) | 19 / -0.037 (0.115) | 0.51 |
| R2 mlb | holdout (2026-09+2026-10) | 17 / -0.113 (0.120) | 17 / -0.096 (0.120) | 0.51 |
| R2 mlb | train (2026-08) | 2 / 0.448 (0.015) | 2 / 0.465 (0.015) | 0.54 |
| R2 mlb | 2026-07 | 0 | 0 | NA |
| R2 mlb | 2026-08 | 2 / 0.448 (0.015) | 2 / 0.465 (0.015) | 0.54 |
| R2 mlb | 2026-09 | 16 / -0.089 (0.126) | 16 / -0.072 (0.126) | 0.51 |
| R2 mlb | 2026-10 | 1 / -0.497 (NA) | 1 / -0.480 (NA) | 0.48 |
| R2 mlb | baseline: same NO rung rule, ALL games | 589 / -0.057 (0.021) | 589 / -0.039 (0.021) | 0.51 |
| R3 mlb | all (pooled) | 145 / 0.040 (0.041) | 145 / 0.058 (0.041) | 0.50 |
| R3 mlb | holdout (2026-09+2026-10) | 53 / 0.046 (0.068) | 53 / 0.063 (0.068) | 0.50 |
| R3 mlb | train (2026-07+2026-08) | 92 / 0.037 (0.052) | 92 / 0.054 (0.052) | 0.50 |
| R3 mlb | 2026-07 | 2 / -0.007 (0.460) | 2 / 0.010 (0.460) | 0.49 |
| R3 mlb | 2026-08 | 90 / 0.038 (0.052) | 90 / 0.055 (0.052) | 0.50 |
| R3 mlb | 2026-09 | 51 / 0.068 (0.069) | 51 / 0.086 (0.069) | 0.50 |
| R3 mlb | 2026-10 | 2 / -0.532 (0.025) | 2 / -0.515 (0.025) | 0.52 |
| R3 mlb | baseline: same YES rung rule, ALL games | 589 / 0.012 (0.021) | 589 / 0.029 (0.021) | 0.50 |
| R4 nfl | all (pooled) | 1 / 0.473 (NA) | 1 / 0.490 (NA) | 0.51 |
| R4 nfl | holdout (2026-09) | 1 / 0.473 (NA) | 1 / 0.490 (NA) | 0.51 |
| R4 nfl | train (-) | 0 | 0 | NA |
| R4 nfl | 2026-07 | 0 | 0 | NA |
| R4 nfl | 2026-08 | 0 | 0 | NA |
| R4 nfl | 2026-09 | 1 / 0.473 (NA) | 1 / 0.490 (NA) | 0.51 |
| R4 nfl | 2026-10 | 0 | 0 | NA |
| R4 nfl | baseline: same NO rung rule, ALL games | 57 / 0.002 (0.067) | 57 / 0.019 (0.067) | 0.51 |
| R4 ncaaf | all (pooled) | 11 / -0.077 (0.158) | 11 / -0.060 (0.158) | 0.51 |
| R4 ncaaf | holdout (2026-09+2026-10) | 11 / -0.077 (0.158) | 11 / -0.060 (0.158) | 0.51 |
| R4 ncaaf | train (-) | 0 | 0 | NA |
| R4 ncaaf | 2026-07 | 0 | 0 | NA |
| R4 ncaaf | 2026-08 | 0 | 0 | NA |
| R4 ncaaf | 2026-09 | 10 / -0.029 (0.167) | 10 / -0.012 (0.167) | 0.51 |
| R4 ncaaf | 2026-10 | 1 / -0.557 (NA) | 1 / -0.540 (NA) | 0.54 |
| R4 ncaaf | baseline: same NO rung rule, ALL games | 377 / -0.077 (0.026) | 377 / -0.060 (0.026) | 0.51 |
| R4 football | all (pooled) | 12 / -0.032 (0.152) | 12 / -0.014 (0.152) | 0.51 |
| R4 football | holdout (2026-09+2026-10) | 12 / -0.032 (0.152) | 12 / -0.014 (0.152) | 0.51 |
| R4 football | train (-) | 0 | 0 | NA |
| R4 football | 2026-07 | 0 | 0 | NA |
| R4 football | 2026-08 | 0 | 0 | NA |
| R4 football | 2026-09 | 11 / 0.016 (0.158) | 11 / 0.034 (0.158) | 0.51 |
| R4 football | 2026-10 | 1 / -0.557 (NA) | 1 / -0.540 (NA) | 0.54 |
| R4 football | baseline: same NO rung rule, ALL games | 434 / -0.067 (0.024) | 434 / -0.050 (0.024) | 0.51 |
| R4 mlb | all (pooled) | 8 / 0.226 (0.163) | 8 / 0.244 (0.163) | 0.51 |
| R4 mlb | holdout (2026-08+2026-09) | 8 / 0.226 (0.163) | 8 / 0.244 (0.163) | 0.51 |
| R4 mlb | train (-) | 0 | 0 | NA |
| R4 mlb | 2026-07 | 0 | 0 | NA |
| R4 mlb | 2026-08 | 4 / 0.245 (0.238) | 4 / 0.263 (0.238) | 0.49 |
| R4 mlb | 2026-09 | 4 / 0.208 (0.259) | 4 / 0.225 (0.259) | 0.53 |
| R4 mlb | 2026-10 | 0 | 0 | NA |
| R4 mlb | baseline: same NO rung rule, ALL games | 589 / -0.057 (0.021) | 589 / -0.039 (0.021) | 0.51 |

## Sensitivity: MLB including roof parks (R2,R3 pooled)

| rule | slice | net | gross | mean ask |
|---|---|---|---|---|
| R2 mlb | all (pooled) | 19 / -0.054 (0.115) | 19 / -0.037 (0.115) | 0.51 |
| R3 mlb | all (pooled) | 145 / 0.040 (0.041) | 145 / 0.058 (0.041) | 0.50 |
| R4 mlb | all (pooled) | 8 / 0.226 (0.163) | 8 / 0.244 (0.163) | 0.51 |

Feature distribution (forecast window): nfl: wind p50 6.0 p90 10.8, gust p90 18.2, temp p10 62 p90 87, precip>=2mm 1 | ncaaf: wind p50 6.4 p90 10.4, gust p90 18.6, temp p10 65 p90 93, precip>=2mm 11 | mlb: wind p50 7.2 p90 11.6, gust p90 20.8, temp p10 66 p90 91, precip>=2mm 8


## Verdict
- Regressions: no coefficient on wind, gust, precipitation or temperature is distinguishable from zero for NFL or NCAAF (best: football wind alone
  -0.41 points/mph, SE 0.23, t=-1.8; sign as physics predicts, magnitude 3.7 points at 15 mph vs the 6 mph median if real). The MLB precipitation coefficient is the
  only |t|>2 result (-0.19 runs/mm, SE 0.06, t=-3.1, 8 games with >=2 mm; it is one of ~20 coefficients tested, no multiplicity correction, and the
  archive version has t=-1.7); MLB wind -0.07 runs/mph (SE 0.05) and temperature +0.009 runs/F (SE 0.018) show no effect. The archive-reanalysis sanity regressions show
  no wind effect at all, so the marginal football-wind sign is not corroborated.
- Pre-registered rules: the thresholds fired seldom because Aug 28-Oct 6 is calm (forecast wind p90 about 11 mph, only 11 football games met R1, 19 MLB games R2,
  8 MLB games R4). R1 football n=11, net +0.029 (SE 0.154); R2 MLB n=19, net -0.054 (SE 0.115) (holdout Sep+Oct n=17, -0.113); R3 MLB (hot, buy YES) n=145,
  net +0.040 (SE 0.041), holdout Sep+Oct +0.046 (SE 0.068), train +0.037 (SE 0.052); R4 MLB n=8, +0.226 (SE 0.163). No rule reaches 2 SE pooled. Per the
  pre-registered criterion no rule is supported.
- Side finding (not pre-registered, unconditioned): buying NO on the nearest-to-50% rung of every NCAAF game lost -0.077 per contract (SE 0.026) net, NFL
  +0.002 (0.067), because the realised total ran about 1.1 points above the market median in football (SE 0.69); that is a level effect, not a weather effect.
- Plain answer: in this sample the weather forecast does not add measurable information beyond Kalshi's start-60 price for football totals, and in MLB only
  rain shows a total-reducing signal, too rare (8 games) to trade. The test is underpowered for the windy tail (the cases that matter): to detect 3 points
  at 15 mph needs the NFL/NCAAF November-December windy games, which this window lacks. Rerun the same script after the season supplies windy and cold games;
  nothing here needs to change in the rules.
