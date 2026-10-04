# KXRAIN edges (model: NBS P06 logistic, cross-fit; truth: Kalshi results)

2026-07-26..2026-10-02, 1524 markets. One entry per market (first decision time that qualifies). Pnl in cents per contract after fees (taker at batch 10; resting pays no fee). Resting fills use the queue-aware rule, 4h horizon, queue ahead from the microstructure table.

| rule | markets | losses | lost_yes | taker_c | taker_total_c_per_ct | rest_fill_rate | rest_clean | rest_c_per_filled | rest_c_per_placed | median_flow |
|---|---|---|---|---|---|---|---|---|---|---|
| TAIL sell day-before p<=0.005 bid>=0.03 | 103 | 1 | 1 | 2.450 | 252.300 | 0.369 | 29 | 2.580 | 0.950 | 4.000 |
| TAIL sell day-before p<=0.005 bid>=0.04 | 42 | 0 | 0 | 4.540 | 190.600 | 0.381 | 10 | 6.500 | 2.480 | 9.705 |
| TAIL sell day-before p<=0.01 bid>=0.03 | 156 | 1 | 1 | 2.990 | 466.700 | 0.397 | 45 | 3.840 | 1.530 | 3.475 |
| TAIL sell day-before p<=0.01 bid>=0.04 | 70 | 0 | 0 | 4.840 | 338.500 | 0.400 | 15 | 6.960 | 2.790 | 6.500 |
| TAIL sell day-before p<=0.02 bid>=0.03 | 221 | 1 | 1 | 3.340 | 737.700 | 0.416 | 62 | 4.850 | 2.020 | 4.000 |
| TAIL sell day-before p<=0.02 bid>=0.04 | 110 | 0 | 0 | 5.000 | 549.700 | 0.427 | 26 | 7.620 | 3.250 | 9.500 |
| FAV buy day-before p>=0.95 ask<=0.96 | 56 | 1 | 1 | 8.220 | 460.100 | 0.339 | 8 | 11.530 | 3.910 | 31.750 |
| FAV buy day-before p>=0.95 ask<=0.97 | 65 | 1 | 1 | 7.450 | 484.400 | 0.354 | 10 | 10.300 | 3.650 | 30.880 |
| FAV buy day-before p>=0.97 ask<=0.96 | 45 | 0 | 0 | 8.360 | 376.000 | 0.467 | 8 | 11.860 | 5.530 | 34.550 |
| FAV buy day-before p>=0.97 ask<=0.97 | 54 | 0 | 0 | 7.410 | 400.300 | 0.463 | 10 | 10.680 | 4.940 | 33.585 |
| FAV buy day-before p>=0.98 ask<=0.96 | 35 | 0 | 0 | 7.830 | 274.200 | 0.457 | 6 | 11.880 | 5.430 | 38.160 |
| FAV buy day-before p>=0.98 ask<=0.97 | 44 | 0 | 0 | 6.780 | 298.500 | 0.455 | 8 | 10.400 | 4.730 | 36.355 |
| TAIL sell same-day 07h p<=0.005 bid>=0.03 | 32 | 0 | 0 | 3.960 | 126.700 | 0.375 | 6 | 7.170 | 2.690 | 24.950 |
| TAIL sell same-day 07h p<=0.005 bid>=0.04 | 18 | 0 | 0 | 4.940 | 88.900 | 0.333 | 2 | 8.670 | 2.890 | 17.815 |
| TAIL sell same-day 07h p<=0.01 bid>=0.03 | 48 | 0 | 0 | 4.290 | 206.000 | 0.375 | 9 | 7.560 | 2.830 | 24.950 |
| TAIL sell same-day 07h p<=0.01 bid>=0.04 | 27 | 0 | 0 | 5.530 | 149.300 | 0.370 | 4 | 9.300 | 3.440 | 20.630 |
| TAIL sell same-day 07h p<=0.02 bid>=0.03 | 86 | 1 | 1 | 3.270 | 281.300 | 0.453 | 19 | 4.900 | 2.220 | 34.500 |
| TAIL sell same-day 07h p<=0.02 bid>=0.04 | 54 | 0 | 0 | 5.460 | 294.900 | 0.444 | 10 | 9.040 | 4.020 | 30.405 |
| FAV buy same-day 07h p>=0.95 ask<=0.96 | 23 | 1 | 1 | 4.920 | 113.200 | 0.391 | 3 | 10.440 | 4.090 | 16.690 |
| FAV buy same-day 07h p>=0.95 ask<=0.97 | 27 | 1 | 1 | 4.590 | 124.000 | 0.407 | 4 | 9.270 | 3.780 | 34.350 |
| FAV buy same-day 07h p>=0.97 ask<=0.96 | 17 | 0 | 0 | 7.670 | 130.400 | 0.471 | 2 | 10.500 | 4.940 | 50.000 |
| FAV buy same-day 07h p>=0.97 ask<=0.97 | 21 | 0 | 0 | 6.720 | 141.200 | 0.476 | 3 | 9.200 | 4.380 | 50.000 |
| FAV buy same-day 07h p>=0.98 ask<=0.96 | 13 | 0 | 0 | 7.820 | 101.600 | 0.538 | 2 | 11.000 | 5.920 | 16.690 |
| FAV buy same-day 07h p>=0.98 ask<=0.97 | 15 | 0 | 0 | 7.130 | 107.000 | 0.533 | 2 | 10.120 | 5.400 | 30.070 |