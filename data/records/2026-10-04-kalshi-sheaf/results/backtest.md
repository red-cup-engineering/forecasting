## Brier: harmonic estimate vs market mid (lower is better); d = Brier(model) - Brier(mid), 95% day-cluster CI
| S | mode | split | n brackets | days | mid | pM (own Normal) | pA harmonic(mu,sigma) | d(pA) [CI] | pB harmonic mu, own sigma | d(pB) [CI] | w_A | blend(wA) d [CI] |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S1 | thin | train | 1848 | 26 | 0.1149 | 0.1073 | 0.1286 | 0.0138 [0.0080, 0.0204] | 0.1292 | 0.0143 [0.0083, 0.0209] | 0.282 | -0.0025 [-0.0048, -0.0003] |
| S1 | thin | test | 1518 | 25 | 0.1070 | 0.1040 | 0.1420 | 0.0351 [0.0286, 0.0427] | 0.1419 | 0.0350 [0.0266, 0.0439] | 0.282 | 0.0016 [-0.0002, 0.0031] |
| S1 | loo | train | 6390 | 26 | 0.1079 | 0.1054 | 0.1300 | 0.0220 [0.0189, 0.0252] | 0.1299 | 0.0220 [0.0191, 0.0248] | 0.098 | -0.0003 [-0.0006, 0.0001] |
| S1 | loo | test | 6252 | 25 | 0.1043 | 0.1034 | 0.1537 | 0.0494 [0.0440, 0.0555] | 0.1529 | 0.0486 [0.0433, 0.0541] | 0.098 | 0.0006 [0.0003, 0.0010] |
| S2 | thin | train | 1830 | 26 | 0.1110 | 0.1038 | 0.1298 | 0.0188 [0.0097, 0.0288] | 0.1317 | 0.0207 [0.0108, 0.0310] | 0.230 | -0.0018 [-0.0040, 0.0003] |
| S2 | thin | test | 1530 | 25 | 0.1006 | 0.0969 | 0.1360 | 0.0355 [0.0279, 0.0435] | 0.1380 | 0.0375 [0.0275, 0.0473] | 0.230 | 0.0005 [-0.0012, 0.0022] |
| S2 | loo | train | 6342 | 26 | 0.1050 | 0.1026 | 0.1292 | 0.0242 [0.0207, 0.0279] | 0.1295 | 0.0245 [0.0207, 0.0278] | 0.086 | -0.0002 [-0.0005, 0.0001] |
| S2 | loo | test | 6192 | 25 | 0.1014 | 0.1006 | 0.1557 | 0.0543 [0.0482, 0.0602] | 0.1566 | 0.0552 [0.0495, 0.0609] | 0.086 | 0.0006 [0.0003, 0.0009] |

## Edge trades at the quote (taker, 10-lot fee, one contract-equivalent), signal = harmonic pA vs ask/bid
fill rule: spread <= 6c, trailing-3h volume in the bracket >= 100 contracts (top-of-book depth is not in candles, so a 10-lot at the quote is ASSUMED fillable only when the bracket is actively trading); +1c slippage variant shown.
| S | mode | split | threshold | trades | per-day avg trades | EV/contract (c) [95% CI] | EV with +1c slip (c) | hit rate | buy-yes share |
|---|---|---|---|---|---|---|---|---|---|
| S1 | thin | train | 0.04 | 93 | 3.6 | 2.55 [-6.03, 10.96] | 1.55 | 0.462 | 0.47 |
| S1 | thin | train | 0.07 | 78 | 3.1 | 6.64 [-0.41, 14.43] | 5.64 | 0.474 | 0.50 |
| S1 | thin | train | 0.1 | 64 | 2.7 | 8.13 [-1.38, 15.65] | 7.13 | 0.500 | 0.47 |
| S1 | thin | train | 0.15 | 45 | 2.0 | 11.34 [0.27, 21.53] | 10.34 | 0.511 | 0.49 |
| S1 | thin | test | 0.04 | 88 | 3.5 | -8.16 [-17.07, 0.35] | -9.16 | 0.375 | 0.35 |
| S1 | thin | test | 0.07 | 79 | 3.2 | -6.97 [-15.19, 1.48] | -7.97 | 0.380 | 0.37 |
| S1 | thin | test | 0.1 | 73 | 2.9 | -7.73 [-18.27, 2.34] | -8.73 | 0.370 | 0.36 |
| S1 | thin | test | 0.15 | 57 | 2.4 | -4.96 [-16.39, 3.21] | -5.96 | 0.368 | 0.37 |
| S1 | loo | train | 0.04 | 846 | 32.5 | -4.18 [-6.70, -1.92] | -5.18 | 0.427 | 0.43 |
| S1 | loo | train | 0.07 | 669 | 25.7 | -4.38 [-7.21, -1.54] | -5.38 | 0.408 | 0.43 |
| S1 | loo | train | 0.1 | 552 | 21.2 | -4.49 [-8.04, -1.54] | -5.49 | 0.397 | 0.43 |
| S1 | loo | train | 0.15 | 393 | 15.1 | -3.39 [-6.67, -0.20] | -4.39 | 0.384 | 0.45 |
| S1 | loo | test | 0.04 | 1029 | 41.2 | -2.97 [-5.32, -0.46] | -3.97 | 0.473 | 0.37 |
| S1 | loo | test | 0.07 | 884 | 35.4 | -3.47 [-6.10, -0.70] | -4.47 | 0.458 | 0.37 |
| S1 | loo | test | 0.1 | 754 | 30.2 | -3.57 [-6.00, -0.92] | -4.57 | 0.444 | 0.37 |
| S1 | loo | test | 0.15 | 589 | 23.6 | -2.82 [-6.16, 0.26] | -3.82 | 0.430 | 0.37 |
| S2 | thin | train | 0.04 | 147 | 5.7 | -8.24 [-15.62, -1.57] | -9.24 | 0.408 | 0.33 |
| S2 | thin | train | 0.07 | 118 | 4.5 | -7.96 [-15.56, 0.67] | -8.96 | 0.381 | 0.34 |
| S2 | thin | train | 0.1 | 95 | 4.0 | -9.27 [-19.72, -0.37] | -10.27 | 0.368 | 0.31 |
| S2 | thin | train | 0.15 | 74 | 3.2 | -6.98 [-17.13, 3.21] | -7.98 | 0.365 | 0.35 |
| S2 | thin | test | 0.04 | 135 | 5.4 | -1.90 [-6.83, 2.75] | -2.90 | 0.474 | 0.27 |
| S2 | thin | test | 0.07 | 121 | 4.8 | -0.07 [-5.03, 5.57] | -1.07 | 0.504 | 0.24 |
| S2 | thin | test | 0.1 | 103 | 4.1 | 0.59 [-5.47, 7.08] | -0.41 | 0.505 | 0.23 |
| S2 | thin | test | 0.15 | 88 | 3.5 | 1.09 [-4.06, 6.91] | 0.09 | 0.500 | 0.23 |
| S2 | loo | train | 0.04 | 1083 | 41.7 | -3.77 [-6.01, -1.13] | -4.77 | 0.428 | 0.42 |
| S2 | loo | train | 0.07 | 887 | 34.1 | -3.74 [-6.17, -1.29] | -4.74 | 0.413 | 0.41 |
| S2 | loo | train | 0.1 | 707 | 27.2 | -3.59 [-6.46, -0.76] | -4.59 | 0.402 | 0.41 |
| S2 | loo | train | 0.15 | 536 | 20.6 | -2.81 [-6.00, 0.70] | -3.81 | 0.394 | 0.41 |
| S2 | loo | test | 0.04 | 1189 | 47.6 | -2.92 [-5.01, -0.85] | -3.92 | 0.475 | 0.36 |
| S2 | loo | test | 0.07 | 1024 | 41.0 | -3.37 [-5.62, -1.01] | -4.37 | 0.455 | 0.36 |
| S2 | loo | test | 0.1 | 888 | 35.5 | -3.52 [-5.97, -1.31] | -4.52 | 0.444 | 0.35 |
| S2 | loo | test | 0.15 | 710 | 28.4 | -3.96 [-6.41, -1.70] | -4.96 | 0.418 | 0.36 |

## Residual sign diagnostic: does market move toward the harmonic estimate? (S1 -> S2 same event, LOO)
slope of (mid_S2 - mid_S1) on (pA_S1 - mid_S1): 0.005 over 6168 bracket-pairs (1 = market closes the gap fully, 0 = ignores it)

## Level test: does the harmonic mean carry information about the settled temperature beyond the ladder mean? (LOO, one row per ladder)
regress (settled - muM) on (muH - muM); slope 0 = nothing beyond the market, 1 = harmonic is the better mean. RMSE in degF.
| S | split | ladders | RMSE muM | RMSE muH | RMSE trailing climatology | slope [95% CI] | RMSE muM + slope*(muH-muM) (train slope) |
|---|---|---|---|---|---|---|---|
| S1 | train | 1064 | 2.006 | 2.907 | 4.552 | 0.071 [0.003, 0.139] | 1.999 |
| S1 | test | 1042 | 1.738 | 3.896 | 5.809 | 0.004 [-0.028, 0.036] | 1.754 |
| S2 | train | 1056 | 1.947 | 2.884 | 4.508 | 0.055 [-0.011, 0.119] | 1.943 |
| S2 | test | 1032 | 1.633 | 3.931 | 5.821 | -0.005 [-0.033, 0.026] | 1.647 |

Spearman(daily mean edge energy, daily mean |settled - muM|) over 51 days (S1): rho = -0.297  (energy as a market-wide uncertainty/dislocation gauge)
