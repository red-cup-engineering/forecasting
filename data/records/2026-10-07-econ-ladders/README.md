# Economic-release ladders on Kalshi: calibration, coherence, tail rule (2026-10-07)

Script: `services/forecasting-service/scripts/econ-ladder-study.mjs` (`collect`, then `analyze`). Read-only public API, 450 ms pacing, 429 backoff 5-20 s; no order was placed. Cache (resume-safe): `/tmp/claude-1000/-home-emsenn-info/bfd39b66-66a8-4bd1-abf7-8a75503c9632/scratchpad/econ-cache/`.

## Verdict

1. Tails are not overpriced the way Kalshi weather tails are. Markets with mid in [0.03, 0.12) at 24 h: mean mid 0.064, realised 0.049, realised - mid = -0.015 (jackknife SE 0.012, t -1.3; 325 markets, 236 events). Per series the sign differs: payrolls tails are underpriced (+0.085 at 24 h, +0.124 at 1 h, t 1.6 and 2.0); CPI, core CPI, unemployment, GDP, ISM and claims tails are 2-6 points rich, claims at 1 h is t -2.9. GDP and ISM show t of -10 to -15 only because no tail in those bands hit (SE collapses to price dispersion on 15-20 markets).
2. One miscalibration is large and significant: weekly initial jobless claims thresholds with mid in [0.12, 0.7) resolve YES 10-18 points less often than priced (24 h: [0.12,0.3) -0.131, t -4.4; [0.3,0.7) -0.161, t -2.8; 1 h: -0.100 t -2.6 and -0.178 t -3.1). All 58 claims events are 2025-26, so there is no earlier half to confirm it. CPI [0.12,0.3) at 24 h is -0.143 (t -3.3) but -0.114 (t -1.9) at 1 h. The ~75 band x series cells tested make a few |t| > 2 expected; claims is the only one that repeats across both bands and both horizons.
3. Ladders cohere. The gluing LP over top-of-book [bid, ask] intervals fails in 0 of 284 ladders at 24 h and 0 of 271 at 1 h, so there is no Dutch book, with or without fees, at unit depth (candles carry no sizes). Mids alone are non-monotone or off-partition in 7-9 % of ladders (claims 11 % at 24 h, 27 % at 1 h; retail and ISM higher on tiny n); the spread covers every one of them.
4. Projecting mids onto the coherent set (`brierProjection`, exact) lowers pooled Brier from 0.1178 to 0.1176 at 24 h (gain 0.00025 per market, SE 0.00011) and 0.1200 to 0.1197 at 1 h (0.00028, SE 0.00014): about 0.2 % of the Brier. The ladders are already coherent; the projection is worth nothing here.
5. The pre-registered tail rule fails. Net of fee (0.4 c per contract):
   - R1 (24 h): pooled -1.4 c per contract (SE 1.5 c, 328 contracts, 235 events, 24 YES hits). 2023-24 -7.8 c (SE 3.5 c, t -2.2); 2025-26 +1.4 c (SE 1.5 c, t 0.9).
   - R2 (1 h): pooled -3.2 c (SE 2.0 c, 280 contracts, 25 hits). 2023-24 -10.9 c (SE 4.6 c, t -2.4); 2025-26 +0.4 c (SE 2.0 c, t 0.2).
   - The verdict criterion (positive in both halves with t > 2) is not met by either rule. Selling payroll tails loses outright (R1 -12.1 c, t -2.0; R2 -18.3 c, t -2.2). Per-series 2025-26 rows with t above 8 (core CPI, unemployment, GDP, ISM, core PCE) have zero tail hits, so their jackknife SE is price dispersion only; they carry no evidence. The 2025-26 pooled gross of +1.8 c exceeds the fee but is not distinguishable from zero, and 2023-24 reverses it.
6. Cleveland Fed nowcast (column below): the CPI and core CPI m/m nowcast history is downloadable as JSON (`https://www.clevelandfed.org/-/media/files/webcharts/inflationnowcasting/nowcast_month.json`, 7.6 MB, robots.txt allows it). A Gaussian around the last nowcast before release day (leave-one-event-out bias and sd) scores Brier 0.1430 on KXCPI thresholds against the market mid's 0.0972 (difference +0.046, SE 0.015), and 0.1231 against 0.0916 on core CPI (+0.031, SE 0.018). A 50/50 blend is worse than the mid on both (+0.011, SE 0.006; +0.004, SE 0.007). The market already contains the nowcast; it supplies no edge.

Net: these ladders are calibrated to within noise except claims thresholds, coherent to within spread, and no fee-surviving tail rule exists in 2023-26 data.

## Data and limits

- Series (all `fee_multiplier` 1 from `GET /series/{t}`): KXCPI, KXCPICORE, KXU3, KXPAYROLLS, KXFED, KXFEDDECISION, KXGDP, KXPCECORE, KXJOBLESSCLAIMS, KXUSRETAIL, KXISMPMI. 351 settled events from 2023 on, 3121 settled binary markets. Event counts per series are in the Coverage table.
- Not collected: KXCPIYOY, KXCPICOREYOY (same releases as the m/m ladders), KXJOBLESS (no events after 2022), KXPCEHEAD and KXRETAIL (one event each). The 429 rate (about 30 % of calls, other jobs share the IP) set the budget.
- Settled-event markets come from `GET /historical/markets?event_ticker=` (events before the 2026-08-08 historical cutoff) or the nested events payload. Prices come from `/historical/markets/{t}/candlesticks` (live path for post-cutoff events), 1-minute period over the 72 h before `close_time`, quote = last candle at or before close - 24 h / close - 1 h. Candles are quote changes, so "age" is time since the book last moved (median in the Coverage table); a long age is an unchanged quote. Time halves are by event year: 2023-24 vs 2025-26; KXPCECORE has 3 events in 2023-24 and claims, retail and ISM have none.
- Candles carry no sizes: Dutch-book tests use unit depth at top of book, which makes the 0 count a statement about price, not depth.
- Calibration uses two-sided quotes only (bid > 0 and ask < 1), so the extreme tails with no bid sit outside the [0, 0.03) and [0.97, 1) rows, which are mechanical (t values there are meaningless: realised is 0 or 1 by construction). R1/R2 need only a bid in [0.03, 0.12].
- SE is a delete-one-event jackknife (an event's brackets are one cluster). With 0 tail hits the SE reduces to price dispersion; read the "YES hits" column next to the t value.
- Fee per contract = 0.07 x fee_multiplier x P x (1 - P), P = 1 - bid, unrounded, taker.

## Pre-registered rules (written in the script header before any price was fetched; commit 25046f6)

R1: at 24 h before close, buy NO at 1 - bid on every market with yes bid in [0.03, 0.12], hold to settlement. R2: same at 1 h. Net of taker fee. Split 2023-24 vs 2025-26. Works only if both halves have positive net mean with jackknife t > 2.

## Tables (generated by `analyze`)

### Coverage
| series | title | events | 2023-24 | 2025-26 | markets | with q24 | with q1 | median quote age 24h / 1h (min) | fee_mult |
|---|---|---|---|---|---|---|---|---|---|
| KXCPI | CPI | 44 | 24 | 20 | 375 | 302 | 334 | 24 / 408 | 1 |
| KXCPICORE | CPI core | 44 | 24 | 20 | 391 | 279 | 322 | 31 / 455 | 1 |
| KXU3 | Unemployment | 45 | 24 | 21 | 485 | 379 | 390 | 30 / 428 | 1 |
| KXPAYROLLS | Jobs numbers | 43 | 22 | 21 | 396 | 388 | 391 | 13 / 24 | 1 |
| KXFED | Fed funds rate | 30 | 16 | 14 | 335 | 191 | 213 | 33 / 28 | 1 |
| KXFEDDECISION | Fed meeting | 28 | 14 | 14 | 140 | 118 | 122 | 7 / 6 | 1 |
| KXGDP | US GDP growth | 15 | 8 | 7 | 164 | 136 | 149 | 84 / 249 | 1 |
| KXPCECORE | US Core PCE inflation | 23 | 3 | 20 | 115 | 103 | 112 | 45 / 86 | 1 |
| KXJOBLESSCLAIMS | Weekly initial jobless claims | 58 | 0 | 58 | 557 | 553 | 556 | 15 / 16 | 1 |
| KXUSRETAIL | US retail sales MoM | 7 | 0 | 7 | 58 | 58 | 58 | 17 / 24 | 1 |
| KXISMPMI | ISM PMI | 14 | 0 | 14 | 105 | 101 | 101 | 6 / 20 | 1 |

### Calibration by mid band, 24 h before close (two-sided quotes; realised - mid, jackknife SE by event)
| series | band | n | events | mean mid | realised | realised - mid | SE | t |
|---|---|---|---|---|---|---|---|---|
| KXCPI | [0,0.03) | 16 | 16 | 0.0200 | 0.0000 | -0.0200 | 0.0012 | -16.6 |
| KXCPI | [0.03,0.12) | 41 | 35 | 0.0649 | 0.0732 | 0.0083 | 0.0409 | 0.2 |
| KXCPI | [0.12,0.3) | 23 | 23 | 0.1865 | 0.0435 | -0.1430 | 0.0438 | -3.3 |
| KXCPI | [0.3,0.7) | 41 | 39 | 0.5028 | 0.4634 | -0.0394 | 0.0733 | -0.5 |
| KXCPI | [0.7,0.88) | 21 | 20 | 0.7919 | 0.7619 | -0.0300 | 0.0982 | -0.3 |
| KXCPI | [0.88,0.97) | 36 | 32 | 0.9292 | 0.9444 | 0.0153 | 0.0390 | 0.4 |
| KXCPI | [0.97,1) | 20 | 20 | 0.9775 | 1.0000 | 0.0225 | 0.0014 | 16.3 |
| KXCPICORE | [0,0.03) | 9 | 8 | 0.0211 | 0.0000 | -0.0211 | 0.0021 | -10.3 |
| KXCPICORE | [0.03,0.12) | 34 | 29 | 0.0651 | 0.0294 | -0.0357 | 0.0292 | -1.2 |
| KXCPICORE | [0.12,0.3) | 25 | 25 | 0.1904 | 0.1200 | -0.0704 | 0.0672 | -1.0 |
| KXCPICORE | [0.3,0.7) | 38 | 36 | 0.5120 | 0.5000 | -0.0120 | 0.0769 | -0.2 |
| KXCPICORE | [0.7,0.88) | 17 | 17 | 0.8088 | 0.7059 | -0.1029 | 0.1192 | -0.9 |
| KXCPICORE | [0.88,0.97) | 34 | 31 | 0.9282 | 0.9706 | 0.0424 | 0.0298 | 1.4 |
| KXU3 | [0,0.03) | 17 | 15 | 0.0188 | 0.0000 | -0.0188 | 0.0013 | -14.7 |
| KXU3 | [0.03,0.12) | 47 | 40 | 0.0622 | 0.0213 | -0.0410 | 0.0214 | -1.9 |
| KXU3 | [0.12,0.3) | 38 | 36 | 0.1983 | 0.1316 | -0.0667 | 0.0574 | -1.2 |
| KXU3 | [0.3,0.7) | 63 | 42 | 0.5115 | 0.4921 | -0.0194 | 0.0713 | -0.3 |
| KXU3 | [0.7,0.88) | 34 | 33 | 0.7931 | 0.7353 | -0.0578 | 0.0760 | -0.8 |
| KXU3 | [0.88,0.97) | 40 | 33 | 0.9319 | 0.9500 | 0.0181 | 0.0344 | 0.5 |
| KXU3 | [0.97,1) | 20 | 17 | 0.9788 | 1.0000 | 0.0213 | 0.0010 | 21.5 |
| KXPAYROLLS | [0,0.03) | 8 | 8 | 0.0200 | 0.0000 | -0.0200 | 0.0013 | -15.0 |
| KXPAYROLLS | [0.03,0.12) | 41 | 29 | 0.0615 | 0.1463 | 0.0849 | 0.0541 | 1.6 |
| KXPAYROLLS | [0.12,0.3) | 52 | 36 | 0.1964 | 0.4038 | 0.2074 | 0.1024 | 2.0 |
| KXPAYROLLS | [0.3,0.7) | 110 | 40 | 0.5053 | 0.5364 | 0.0310 | 0.0961 | 0.3 |
| KXPAYROLLS | [0.7,0.88) | 75 | 38 | 0.7991 | 0.7600 | -0.0391 | 0.0756 | -0.5 |
| KXPAYROLLS | [0.88,0.97) | 45 | 30 | 0.9281 | 0.8667 | -0.0614 | 0.0635 | -1.0 |
| KXPAYROLLS | [0.97,1) | 22 | 21 | 0.9768 | 1.0000 | 0.0232 | 0.0011 | 21.4 |
| KXFED | [0.97,1) | 10 | 10 | 0.9820 | 1.0000 | 0.0180 | 0.0015 | 11.8 |
| KXFEDDECISION | [0,0.03) | 9 | 8 | 0.0194 | 0.0000 | -0.0194 | 0.0020 | -9.8 |
| KXFEDDECISION | [0.97,1) | 8 | 8 | 0.9813 | 1.0000 | 0.0188 | 0.0018 | 10.2 |
| KXGDP | [0.03,0.12) | 15 | 9 | 0.0658 | 0.0000 | -0.0658 | 0.0045 | -14.7 |
| KXGDP | [0.12,0.3) | 13 | 12 | 0.1906 | 0.0769 | -0.1137 | 0.0787 | -1.4 |
| KXGDP | [0.3,0.7) | 22 | 15 | 0.4973 | 0.4091 | -0.0882 | 0.1316 | -0.7 |
| KXGDP | [0.7,0.88) | 13 | 12 | 0.7873 | 0.5385 | -0.2489 | 0.1618 | -1.5 |
| KXGDP | [0.88,0.97) | 32 | 15 | 0.9300 | 0.8437 | -0.0862 | 0.0979 | -0.9 |
| KXGDP | [0.97,1) | 9 | 7 | 0.9756 | 1.0000 | 0.0244 | 0.0019 | 12.8 |
| KXPCECORE | [0.03,0.12) | 18 | 16 | 0.0619 | 0.0556 | -0.0064 | 0.0546 | -0.1 |
| KXPCECORE | [0.3,0.7) | 13 | 13 | 0.4958 | 0.4615 | -0.0342 | 0.1240 | -0.3 |
| KXPCECORE | [0.7,0.88) | 8 | 8 | 0.7525 | 0.6250 | -0.1275 | 0.1804 | -0.7 |
| KXPCECORE | [0.88,0.97) | 12 | 12 | 0.9233 | 0.9167 | -0.0067 | 0.0798 | -0.1 |
| KXJOBLESSCLAIMS | [0,0.03) | 9 | 8 | 0.0194 | 0.0000 | -0.0194 | 0.0015 | -12.7 |
| KXJOBLESSCLAIMS | [0.03,0.12) | 89 | 51 | 0.0690 | 0.0449 | -0.0241 | 0.0214 | -1.1 |
| KXJOBLESSCLAIMS | [0.12,0.3) | 74 | 50 | 0.1981 | 0.0676 | -0.1305 | 0.0299 | -4.4 |
| KXJOBLESSCLAIMS | [0.3,0.7) | 112 | 57 | 0.5001 | 0.3393 | -0.1608 | 0.0579 | -2.8 |
| KXJOBLESSCLAIMS | [0.7,0.88) | 68 | 47 | 0.8011 | 0.8235 | 0.0224 | 0.0496 | 0.5 |
| KXJOBLESSCLAIMS | [0.88,0.97) | 80 | 47 | 0.9271 | 0.9125 | -0.0146 | 0.0332 | -0.4 |
| KXJOBLESSCLAIMS | [0.97,1) | 15 | 13 | 0.9757 | 1.0000 | 0.0243 | 0.0015 | 16.6 |
| KXUSRETAIL | [0.03,0.12) | 9 | 4 | 0.0683 | 0.0000 | -0.0683 | 0.0088 | -7.7 |
| KXUSRETAIL | [0.12,0.3) | 10 | 5 | 0.2000 | 0.2000 | 0.0000 | 0.2037 | 0.0 |
| KXUSRETAIL | [0.3,0.7) | 12 | 6 | 0.5442 | 0.4167 | -0.1275 | 0.1607 | -0.8 |
| KXUSRETAIL | [0.88,0.97) | 13 | 4 | 0.9173 | 1.0000 | 0.0827 | 0.0043 | 19.1 |
| KXISMPMI | [0.03,0.12) | 20 | 12 | 0.0643 | 0.0000 | -0.0643 | 0.0056 | -11.5 |
| KXISMPMI | [0.12,0.3) | 13 | 10 | 0.2054 | 0.0769 | -0.1285 | 0.0852 | -1.5 |
| KXISMPMI | [0.3,0.7) | 24 | 13 | 0.4990 | 0.5000 | 0.0010 | 0.1023 | 0.0 |
| KXISMPMI | [0.7,0.88) | 15 | 12 | 0.8150 | 1.0000 | 0.1850 | 0.0088 | 21.0 |
| KXISMPMI | [0.88,0.97) | 12 | 10 | 0.9288 | 1.0000 | 0.0712 | 0.0055 | 12.9 |
| ALL | [0,0.03) | 82 | 76 | 0.0197 | 0.0000 | -0.0197 | 0.0005 | -36.7 |
| ALL | [0.03,0.12) | 325 | 236 | 0.0644 | 0.0492 | -0.0152 | 0.0119 | -1.3 |
| ALL | [0.12,0.3) | 252 | 201 | 0.1961 | 0.1548 | -0.0413 | 0.0308 | -1.3 |
| ALL | [0.3,0.7) | 438 | 263 | 0.5051 | 0.4543 | -0.0508 | 0.0332 | -1.5 |
| ALL | [0.7,0.88) | 260 | 195 | 0.7984 | 0.7731 | -0.0254 | 0.0310 | -0.8 |
| ALL | [0.88,0.97) | 314 | 224 | 0.9285 | 0.9236 | -0.0050 | 0.0177 | -0.3 |
| ALL | [0.97,1) | 113 | 105 | 0.9776 | 1.0000 | 0.0224 | 0.0005 | 43.3 |

### Calibration by mid band, 1 h before close (two-sided quotes; realised - mid, jackknife SE by event)
| series | band | n | events | mean mid | realised | realised - mid | SE | t |
|---|---|---|---|---|---|---|---|---|
| KXCPI | [0,0.03) | 9 | 9 | 0.0178 | 0.0000 | -0.0178 | 0.0015 | -12.1 |
| KXCPI | [0.03,0.12) | 39 | 36 | 0.0595 | 0.0256 | -0.0338 | 0.0256 | -1.3 |
| KXCPI | [0.12,0.3) | 24 | 24 | 0.1977 | 0.0833 | -0.1144 | 0.0590 | -1.9 |
| KXCPI | [0.3,0.7) | 35 | 33 | 0.5026 | 0.4000 | -0.1026 | 0.0853 | -1.2 |
| KXCPI | [0.7,0.88) | 24 | 24 | 0.7788 | 0.7917 | 0.0129 | 0.0868 | 0.1 |
| KXCPI | [0.88,0.97) | 35 | 32 | 0.9357 | 0.9429 | 0.0071 | 0.0405 | 0.2 |
| KXCPI | [0.97,1) | 15 | 14 | 0.9770 | 1.0000 | 0.0230 | 0.0015 | 15.5 |
| KXCPICORE | [0,0.03) | 8 | 8 | 0.0225 | 0.0000 | -0.0225 | 0.0013 | -16.8 |
| KXCPICORE | [0.03,0.12) | 28 | 27 | 0.0634 | 0.0000 | -0.0634 | 0.0036 | -17.5 |
| KXCPICORE | [0.12,0.3) | 25 | 25 | 0.2152 | 0.2000 | -0.0152 | 0.0822 | -0.2 |
| KXCPICORE | [0.3,0.7) | 36 | 31 | 0.5286 | 0.5278 | -0.0008 | 0.0784 | -0.0 |
| KXCPICORE | [0.7,0.88) | 15 | 15 | 0.7930 | 0.6667 | -0.1263 | 0.1284 | -1.0 |
| KXCPICORE | [0.88,0.97) | 31 | 29 | 0.9281 | 0.9355 | 0.0074 | 0.0446 | 0.2 |
| KXU3 | [0,0.03) | 14 | 14 | 0.0207 | 0.0000 | -0.0207 | 0.0012 | -17.9 |
| KXU3 | [0.03,0.12) | 44 | 35 | 0.0653 | 0.0455 | -0.0199 | 0.0319 | -0.6 |
| KXU3 | [0.12,0.3) | 31 | 30 | 0.1979 | 0.0968 | -0.1011 | 0.0555 | -1.8 |
| KXU3 | [0.3,0.7) | 62 | 43 | 0.4823 | 0.5161 | 0.0338 | 0.0680 | 0.5 |
| KXU3 | [0.7,0.88) | 35 | 33 | 0.7871 | 0.6857 | -0.1014 | 0.0809 | -1.3 |
| KXU3 | [0.88,0.97) | 33 | 27 | 0.9355 | 0.9697 | 0.0342 | 0.0313 | 1.1 |
| KXU3 | [0.97,1) | 14 | 14 | 0.9761 | 1.0000 | 0.0239 | 0.0013 | 18.4 |
| KXPAYROLLS | [0.03,0.12) | 42 | 29 | 0.0662 | 0.1905 | 0.1243 | 0.0634 | 2.0 |
| KXPAYROLLS | [0.12,0.3) | 45 | 33 | 0.2060 | 0.3111 | 0.1051 | 0.1037 | 1.0 |
| KXPAYROLLS | [0.3,0.7) | 89 | 36 | 0.5162 | 0.5281 | 0.0119 | 0.1039 | 0.1 |
| KXPAYROLLS | [0.7,0.88) | 68 | 36 | 0.7932 | 0.6912 | -0.1020 | 0.0884 | -1.2 |
| KXPAYROLLS | [0.88,0.97) | 47 | 30 | 0.9315 | 0.8936 | -0.0379 | 0.0676 | -0.6 |
| KXPAYROLLS | [0.97,1) | 21 | 21 | 0.9764 | 1.0000 | 0.0236 | 0.0010 | 23.9 |
| KXFED | [0,0.03) | 9 | 9 | 0.0217 | 0.0000 | -0.0217 | 0.0017 | -13.0 |
| KXFEDDECISION | [0,0.03) | 8 | 8 | 0.0206 | 0.0000 | -0.0206 | 0.0018 | -11.8 |
| KXFEDDECISION | [0.97,1) | 10 | 10 | 0.9815 | 1.0000 | 0.0185 | 0.0015 | 12.3 |
| KXGDP | [0.03,0.12) | 15 | 10 | 0.0634 | 0.0000 | -0.0634 | 0.0062 | -10.2 |
| KXGDP | [0.12,0.3) | 14 | 12 | 0.1948 | 0.0000 | -0.1948 | 0.0112 | -17.4 |
| KXGDP | [0.3,0.7) | 18 | 13 | 0.5072 | 0.3889 | -0.1183 | 0.1309 | -0.9 |
| KXGDP | [0.7,0.88) | 15 | 13 | 0.8003 | 0.7333 | -0.0670 | 0.1168 | -0.6 |
| KXGDP | [0.88,0.97) | 21 | 13 | 0.9348 | 0.8571 | -0.0776 | 0.1073 | -0.7 |
| KXPCECORE | [0.03,0.12) | 15 | 14 | 0.0513 | 0.0667 | 0.0153 | 0.0653 | 0.2 |
| KXPCECORE | [0.3,0.7) | 9 | 8 | 0.4828 | 0.5556 | 0.0728 | 0.1827 | 0.4 |
| KXPCECORE | [0.7,0.88) | 8 | 8 | 0.7744 | 0.7500 | -0.0244 | 0.1635 | -0.1 |
| KXPCECORE | [0.88,0.97) | 9 | 9 | 0.9267 | 0.8889 | -0.0378 | 0.1063 | -0.4 |
| KXJOBLESSCLAIMS | [0,0.03) | 8 | 8 | 0.0206 | 0.0000 | -0.0206 | 0.0015 | -14.0 |
| KXJOBLESSCLAIMS | [0.03,0.12) | 89 | 49 | 0.0690 | 0.0225 | -0.0465 | 0.0160 | -2.9 |
| KXJOBLESSCLAIMS | [0.12,0.3) | 70 | 51 | 0.2004 | 0.1000 | -0.1004 | 0.0393 | -2.6 |
| KXJOBLESSCLAIMS | [0.3,0.7) | 92 | 56 | 0.5036 | 0.3261 | -0.1775 | 0.0572 | -3.1 |
| KXJOBLESSCLAIMS | [0.7,0.88) | 66 | 50 | 0.8014 | 0.8030 | 0.0017 | 0.0524 | 0.0 |
| KXJOBLESSCLAIMS | [0.88,0.97) | 72 | 45 | 0.9287 | 0.9028 | -0.0259 | 0.0365 | -0.7 |
| KXJOBLESSCLAIMS | [0.97,1) | 23 | 19 | 0.9767 | 0.9565 | -0.0202 | 0.0438 | -0.5 |
| KXUSRETAIL | [0.3,0.7) | 10 | 5 | 0.5210 | 0.2000 | -0.3210 | 0.1594 | -2.0 |
| KXUSRETAIL | [0.7,0.88) | 8 | 5 | 0.7712 | 0.8750 | 0.1038 | 0.1299 | 0.8 |
| KXISMPMI | [0.03,0.12) | 13 | 8 | 0.0681 | 0.0000 | -0.0681 | 0.0059 | -11.5 |
| KXISMPMI | [0.12,0.3) | 11 | 9 | 0.2068 | 0.1818 | -0.0250 | 0.1185 | -0.2 |
| KXISMPMI | [0.3,0.7) | 23 | 13 | 0.4863 | 0.3913 | -0.0950 | 0.1136 | -0.8 |
| KXISMPMI | [0.7,0.88) | 14 | 11 | 0.8204 | 0.9286 | 0.1082 | 0.0699 | 1.5 |
| KXISMPMI | [0.88,0.97) | 13 | 9 | 0.9300 | 1.0000 | 0.0700 | 0.0048 | 14.5 |
| ALL | [0,0.03) | 69 | 68 | 0.0207 | 0.0000 | -0.0207 | 0.0005 | -37.9 |
| ALL | [0.03,0.12) | 294 | 217 | 0.0644 | 0.0476 | -0.0167 | 0.0131 | -1.3 |
| ALL | [0.12,0.3) | 233 | 194 | 0.2034 | 0.1502 | -0.0532 | 0.0287 | -1.9 |
| ALL | [0.3,0.7) | 377 | 240 | 0.5047 | 0.4403 | -0.0644 | 0.0348 | -1.9 |
| ALL | [0.7,0.88) | 256 | 198 | 0.7939 | 0.7539 | -0.0400 | 0.0327 | -1.2 |
| ALL | [0.88,0.97) | 275 | 204 | 0.9316 | 0.9236 | -0.0080 | 0.0189 | -0.4 |
| ALL | [0.97,1) | 105 | 97 | 0.9770 | 0.9905 | 0.0135 | 0.0095 | 1.4 |

### Coherence, 24 h, all quotes (ladders with >= 3 two-sided markets)
| series | ladders | incoherent mids (dist2>1e-6) | Brier mid (per mkt) | Brier projected | gain/mkt | gain SE | glue margin<0 | Dutch book net>0.005 | mean net DB $/unit | max DB $ |
|---|---|---|---|---|---|---|---|---|---|---|
| KXCPI | 41 | 1 (2%) | 0.0861 | 0.0860 | 0.00011 | 0.00011 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXCPICORE | 40 | 0 (0%) | 0.1034 | 0.1034 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXU3 | 44 | 2 (5%) | 0.1108 | 0.1103 | 0.00043 | 0.00043 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXPAYROLLS | 42 | 1 (2%) | 0.1771 | 0.1767 | 0.00043 | 0.00043 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXFED | 1 | 0 (0%) | 0.0087 | 0.0087 | 0.00000 | n/a | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXFEDDECISION | 16 | 2 (13%) | 0.0164 | 0.0164 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXGDP | 14 | 1 (7%) | 0.1384 | 0.1384 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXPCECORE | 9 | 1 (11%) | 0.0794 | 0.0780 | 0.00146 | 0.00146 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXJOBLESSCLAIMS | 57 | 6 (11%) | 0.1173 | 0.1171 | 0.00018 | 0.00013 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXUSRETAIL | 7 | 4 (57%) | 0.0897 | 0.0897 | 0.00001 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXISMPMI | 13 | 3 (23%) | 0.0835 | 0.0831 | 0.00040 | 0.00033 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| ALL | 284 | 21 (7%) | 0.1178 | 0.1176 | 0.00025 | 0.00011 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |

### Coherence, 24 h, recently-changed quotes only (last quote change < 1 h / 5 min before the horizon) (ladders with >= 3 two-sided markets)
| series | ladders | incoherent mids (dist2>1e-6) | Brier mid (per mkt) | Brier projected | gain/mkt | gain SE | glue margin<0 | Dutch book net>0.005 | mean net DB $/unit | max DB $ |
|---|---|---|---|---|---|---|---|---|---|---|
| KXCPI | 28 | 0 (0%) | 0.0776 | 0.0776 | -0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXCPICORE | 21 | 0 (0%) | 0.0909 | 0.0909 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXU3 | 28 | 0 (0%) | 0.1113 | 0.1113 | -0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXPAYROLLS | 31 | 1 (3%) | 0.2000 | 0.1995 | 0.00050 | 0.00050 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXFEDDECISION | 13 | 2 (15%) | 0.0204 | 0.0204 | 0.00001 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXGDP | 7 | 1 (14%) | 0.1312 | 0.1312 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXPCECORE | 7 | 1 (14%) | 0.0938 | 0.0918 | 0.00194 | 0.00194 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXJOBLESSCLAIMS | 53 | 5 (9%) | 0.1267 | 0.1265 | 0.00021 | 0.00016 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXUSRETAIL | 7 | 3 (43%) | 0.0964 | 0.0964 | 0.00001 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXISMPMI | 12 | 3 (25%) | 0.0919 | 0.0914 | 0.00050 | 0.00041 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| ALL | 207 | 16 (8%) | 0.1245 | 0.1243 | 0.00023 | 0.00011 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |

### Coherence, 1 h, all quotes (ladders with >= 3 two-sided markets)
| series | ladders | incoherent mids (dist2>1e-6) | Brier mid (per mkt) | Brier projected | gain/mkt | gain SE | glue margin<0 | Dutch book net>0.005 | mean net DB $/unit | max DB $ |
|---|---|---|---|---|---|---|---|---|---|---|
| KXCPI | 38 | 0 (0%) | 0.0858 | 0.0858 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXCPICORE | 39 | 0 (0%) | 0.1097 | 0.1097 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXU3 | 43 | 2 (5%) | 0.1206 | 0.1197 | 0.00096 | 0.00082 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXPAYROLLS | 41 | 3 (7%) | 0.1766 | 0.1765 | 0.00010 | 0.00010 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXFEDDECISION | 15 | 1 (7%) | 0.0318 | 0.0318 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXGDP | 13 | 1 (8%) | 0.1209 | 0.1209 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXPCECORE | 6 | 0 (0%) | 0.0617 | 0.0617 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXJOBLESSCLAIMS | 56 | 15 (27%) | 0.1143 | 0.1141 | 0.00021 | 0.00013 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXUSRETAIL | 7 | 1 (14%) | 0.1110 | 0.1109 | 0.00012 | 0.00012 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXISMPMI | 13 | 1 (8%) | 0.0990 | 0.0981 | 0.00096 | 0.00096 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| ALL | 271 | 24 (9%) | 0.1200 | 0.1197 | 0.00028 | 0.00014 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |

### Coherence, 1 h, recently-changed quotes only (last quote change < 1 h / 5 min before the horizon) (ladders with >= 3 two-sided markets)
| series | ladders | incoherent mids (dist2>1e-6) | Brier mid (per mkt) | Brier projected | gain/mkt | gain SE | glue margin<0 | Dutch book net>0.005 | mean net DB $/unit | max DB $ |
|---|---|---|---|---|---|---|---|---|---|---|
| KXCPI | 9 | 0 (0%) | 0.0608 | 0.0608 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXCPICORE | 5 | 0 (0%) | 0.1095 | 0.1095 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXU3 | 9 | 0 (0%) | 0.1388 | 0.1388 | -0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXPAYROLLS | 13 | 1 (8%) | 0.2203 | 0.2203 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXFEDDECISION | 10 | 1 (10%) | 0.0465 | 0.0465 | 0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXGDP | 3 | 0 (0%) | 0.2575 | 0.2575 | -0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXJOBLESSCLAIMS | 24 | 4 (17%) | 0.1358 | 0.1358 | 0.00001 | 0.00001 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXUSRETAIL | 3 | 0 (0%) | 0.1125 | 0.1125 | -0.00000 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| KXISMPMI | 5 | 1 (20%) | 0.1301 | 0.1301 | 0.00002 | 0.00002 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |
| ALL | 81 | 7 (9%) | 0.1486 | 0.1486 | 0.00001 | 0.00000 | 0 (0%) | 0 (0%) | 0.000 | 0.000 |

### R1: buy NO at 1 - bid on markets with bid in [0.03, 0.12], 24 h before close, hold to settlement; net of taker fee
| series | half | contracts | events | YES hits (tail losses) | price paid (NO) | NO win rate | gross/contract | fee/contract | net/contract | SE | t | net ROI |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| KXCPI | 2023-24 | 20 | 19 | 2 | 0.9395 | 0.9000 | -0.0395 | 0.0039 | -0.0434 | 0.0685 | -0.6 | -0.046 |
| KXCPI | 2025-26 | 20 | 17 | 1 | 0.9380 | 0.9500 | 0.0120 | 0.0040 | 0.0080 | 0.0509 | 0.2 | 0.009 |
| KXCPI | all | 40 | 36 | 3 | 0.9388 | 0.9250 | -0.0138 | 0.0040 | -0.0177 | 0.0425 | -0.4 | -0.019 |
| KXCPICORE | 2023-24 | 19 | 16 | 3 | 0.9311 | 0.8421 | -0.0889 | 0.0044 | -0.0934 | 0.0879 | -1.1 | -0.100 |
| KXCPICORE | 2025-26 | 16 | 14 | 0 | 0.9375 | 1.0000 | 0.0625 | 0.0041 | 0.0584 | 0.0056 | 10.5 | 0.062 |
| KXCPICORE | all | 35 | 30 | 3 | 0.9340 | 0.9143 | -0.0197 | 0.0043 | -0.0240 | 0.0484 | -0.5 | -0.026 |
| KXU3 | 2023-24 | 23 | 19 | 4 | 0.9300 | 0.8261 | -0.1039 | 0.0045 | -0.1084 | 0.0786 | -1.4 | -0.117 |
| KXU3 | 2025-26 | 21 | 19 | 0 | 0.9386 | 1.0000 | 0.0614 | 0.0040 | 0.0574 | 0.0054 | 10.6 | 0.061 |
| KXU3 | all | 44 | 38 | 4 | 0.9341 | 0.9091 | -0.0250 | 0.0043 | -0.0293 | 0.0427 | -0.7 | -0.031 |
| KXPAYROLLS | 2023-24 | 25 | 20 | 4 | 0.9308 | 0.8400 | -0.0908 | 0.0044 | -0.0952 | 0.0785 | -1.2 | -0.102 |
| KXPAYROLLS | 2025-26 | 24 | 14 | 5 | 0.9346 | 0.7917 | -0.1429 | 0.0042 | -0.1471 | 0.0927 | -1.6 | -0.157 |
| KXPAYROLLS | all | 49 | 34 | 9 | 0.9327 | 0.8163 | -0.1163 | 0.0043 | -0.1206 | 0.0596 | -2.0 | -0.129 |
| KXFEDDECISION | all | 6 | 6 | 0 | 0.9617 | 1.0000 | 0.0383 | 0.0026 | 0.0358 | 0.0045 | 8.0 | 0.037 |
| KXGDP | 2023-24 | 6 | 6 | 0 | 0.9283 | 1.0000 | 0.0717 | 0.0046 | 0.0671 | 0.0120 | 5.6 | 0.072 |
| KXGDP | 2025-26 | 9 | 5 | 0 | 0.9456 | 1.0000 | 0.0544 | 0.0036 | 0.0509 | 0.0061 | 8.3 | 0.054 |
| KXGDP | all | 15 | 11 | 0 | 0.9387 | 1.0000 | 0.0613 | 0.0040 | 0.0574 | 0.0066 | 8.7 | 0.061 |
| KXPCECORE | 2025-26 | 10 | 10 | 0 | 0.9500 | 1.0000 | 0.0500 | 0.0033 | 0.0467 | 0.0066 | 7.1 | 0.049 |
| KXPCECORE | all | 12 | 12 | 1 | 0.9483 | 0.9167 | -0.0317 | 0.0034 | -0.0351 | 0.0828 | -0.4 | -0.037 |
| KXJOBLESSCLAIMS | 2025-26 | 95 | 50 | 3 | 0.9345 | 0.9684 | 0.0339 | 0.0042 | 0.0297 | 0.0179 | 1.7 | 0.032 |
| KXJOBLESSCLAIMS | all | 95 | 50 | 3 | 0.9345 | 0.9684 | 0.0339 | 0.0042 | 0.0297 | 0.0179 | 1.7 | 0.032 |
| KXUSRETAIL | 2025-26 | 10 | 4 | 1 | 0.9520 | 0.9000 | -0.0520 | 0.0032 | -0.0552 | 0.0999 | -0.6 | -0.058 |
| KXUSRETAIL | all | 10 | 4 | 1 | 0.9520 | 0.9000 | -0.0520 | 0.0032 | -0.0552 | 0.0999 | -0.6 | -0.058 |
| KXISMPMI | 2025-26 | 19 | 11 | 0 | 0.9421 | 1.0000 | 0.0579 | 0.0038 | 0.0541 | 0.0057 | 9.4 | 0.057 |
| KXISMPMI | all | 19 | 11 | 0 | 0.9421 | 1.0000 | 0.0579 | 0.0038 | 0.0541 | 0.0057 | 9.4 | 0.057 |
| ALL | 2023-24 | 100 | 87 | 14 | 0.9338 | 0.8600 | -0.0738 | 0.0043 | -0.0781 | 0.0350 | -2.2 | -0.084 |
| ALL | 2025-26 | 228 | 148 | 10 | 0.9385 | 0.9561 | 0.0176 | 0.0040 | 0.0136 | 0.0146 | 0.9 | 0.015 |
| ALL | all | 328 | 235 | 24 | 0.9371 | 0.9268 | -0.0102 | 0.0041 | -0.0143 | 0.0148 | -1.0 | -0.015 |

### R2: buy NO at 1 - bid on markets with bid in [0.03, 0.12], 1 h before close, hold to settlement; net of taker fee
| series | half | contracts | events | YES hits (tail losses) | price paid (NO) | NO win rate | gross/contract | fee/contract | net/contract | SE | t | net ROI |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| KXCPI | 2023-24 | 18 | 18 | 1 | 0.9400 | 0.9444 | 0.0044 | 0.0039 | 0.0005 | 0.0563 | 0.0 | 0.001 |
| KXCPI | 2025-26 | 13 | 13 | 0 | 0.9415 | 1.0000 | 0.0585 | 0.0038 | 0.0546 | 0.0061 | 9.0 | 0.058 |
| KXCPI | all | 31 | 31 | 1 | 0.9406 | 0.9677 | 0.0271 | 0.0039 | 0.0232 | 0.0328 | 0.7 | 0.025 |
| KXCPICORE | 2023-24 | 20 | 15 | 6 | 0.9315 | 0.7000 | -0.2315 | 0.0044 | -0.2359 | 0.1415 | -1.7 | -0.253 |
| KXCPICORE | 2025-26 | 12 | 12 | 0 | 0.9458 | 1.0000 | 0.0542 | 0.0036 | 0.0506 | 0.0057 | 8.9 | 0.054 |
| KXCPICORE | all | 32 | 27 | 6 | 0.9369 | 0.8125 | -0.1244 | 0.0041 | -0.1285 | 0.0961 | -1.3 | -0.137 |
| KXU3 | 2023-24 | 21 | 19 | 3 | 0.9310 | 0.8571 | -0.0738 | 0.0044 | -0.0783 | 0.0794 | -1.0 | -0.084 |
| KXU3 | 2025-26 | 19 | 18 | 0 | 0.9463 | 1.0000 | 0.0537 | 0.0035 | 0.0502 | 0.0040 | 12.7 | 0.053 |
| KXU3 | all | 40 | 37 | 3 | 0.9382 | 0.9250 | -0.0132 | 0.0040 | -0.0173 | 0.0422 | -0.4 | -0.018 |
| KXPAYROLLS | 2023-24 | 20 | 18 | 4 | 0.9365 | 0.8000 | -0.1365 | 0.0041 | -0.1406 | 0.0948 | -1.5 | -0.150 |
| KXPAYROLLS | 2025-26 | 21 | 13 | 6 | 0.9338 | 0.7143 | -0.2195 | 0.0043 | -0.2238 | 0.1351 | -1.7 | -0.240 |
| KXPAYROLLS | all | 41 | 31 | 10 | 0.9351 | 0.7561 | -0.1790 | 0.0042 | -0.1832 | 0.0815 | -2.2 | -0.196 |
| KXFEDDECISION | all | 5 | 5 | 0 | 0.9440 | 1.0000 | 0.0560 | 0.0036 | 0.0524 | 0.0138 | 3.8 | 0.055 |
| KXGDP | 2023-24 | 5 | 5 | 0 | 0.9420 | 1.0000 | 0.0580 | 0.0038 | 0.0542 | 0.0086 | 6.3 | 0.058 |
| KXGDP | 2025-26 | 7 | 6 | 0 | 0.9380 | 1.0000 | 0.0620 | 0.0041 | 0.0579 | 0.0043 | 13.4 | 0.062 |
| KXGDP | all | 12 | 11 | 0 | 0.9397 | 1.0000 | 0.0603 | 0.0040 | 0.0564 | 0.0042 | 13.4 | 0.060 |
| KXPCECORE | 2025-26 | 8 | 8 | 0 | 0.9537 | 1.0000 | 0.0463 | 0.0031 | 0.0432 | 0.0043 | 10.0 | 0.045 |
| KXPCECORE | all | 10 | 10 | 1 | 0.9500 | 0.9000 | -0.0500 | 0.0033 | -0.0533 | 0.0990 | -0.5 | -0.056 |
| KXJOBLESSCLAIMS | 2025-26 | 87 | 48 | 3 | 0.9357 | 0.9655 | 0.0298 | 0.0042 | 0.0256 | 0.0199 | 1.3 | 0.027 |
| KXJOBLESSCLAIMS | all | 87 | 48 | 3 | 0.9357 | 0.9655 | 0.0298 | 0.0042 | 0.0256 | 0.0199 | 1.3 | 0.027 |
| KXISMPMI | 2025-26 | 18 | 12 | 1 | 0.9439 | 0.9444 | 0.0006 | 0.0037 | -0.0031 | 0.0568 | -0.1 | -0.003 |
| KXISMPMI | all | 18 | 12 | 1 | 0.9439 | 0.9444 | 0.0006 | 0.0037 | -0.0031 | 0.0568 | -0.1 | -0.003 |
| ALL | 2023-24 | 89 | 80 | 15 | 0.9360 | 0.8315 | -0.1045 | 0.0041 | -0.1086 | 0.0460 | -2.4 | -0.116 |
| ALL | 2025-26 | 191 | 135 | 10 | 0.9395 | 0.9476 | 0.0081 | 0.0039 | 0.0042 | 0.0201 | 0.2 | 0.004 |
| ALL | all | 280 | 215 | 25 | 0.9384 | 0.9107 | -0.0277 | 0.0040 | -0.0317 | 0.0204 | -1.6 | -0.034 |

### Cleveland Fed nowcast evidence, KXCPI (24 h, two-sided numeric markets; nowcast = last value dated before release day, Gaussian around nowcast + leave-one-event-out bias, sd 0.121, published value rounded to 0.1)
| events | markets | Brier market mid | Brier nowcast | Brier 50/50 blend | nowcast - mid (SE) | blend - mid (SE) |
|---|---|---|---|---|---|---|
| 42 | 188 | 0.0972 | 0.1430 | 0.1084 | 0.04580 (0.01455) | 0.01112 (0.00621) |

### Cleveland Fed nowcast evidence, KXCPICORE (24 h, two-sided numeric markets; nowcast = last value dated before release day, Gaussian around nowcast + leave-one-event-out bias, sd 0.087, published value rounded to 0.1)
| events | markets | Brier market mid | Brier nowcast | Brier 50/50 blend | nowcast - mid (SE) | blend - mid (SE) |
|---|---|---|---|---|---|---|
| 40 | 148 | 0.0916 | 0.1231 | 0.0951 | 0.03149 (0.01772) | 0.00350 (0.00683) |
