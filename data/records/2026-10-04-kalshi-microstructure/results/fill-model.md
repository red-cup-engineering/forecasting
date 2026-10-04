# Queue-aware fill model for a resting sell of YES (weather tails)

Replay of 69,544 (market, 10-minute placement time) samples per price for p=2c, over the public tape of settled KXHIGH/KXLOWT markets (fill iff taker-buy-YES volume at exactly p exceeds the queue ahead, or any taker bought YES above p). Liveness filter: a trade within 2c of p in the previous 60 minutes.


## P(fill) within 20 min, by price p (rows) and contracts ahead Q (columns)

| p | 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100 | 200 | 500 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.000 | 0.132 | 0.128 | 0.126 | 0.122 | 0.117 | 0.112 | 0.105 | 0.101 | 0.099 | 0.097 |
| 3.000 | 0.111 | 0.108 | 0.107 | 0.104 | 0.101 | 0.097 | 0.091 | 0.087 | 0.085 | 0.083 |
| 4.000 | 0.187 | 0.183 | 0.181 | 0.178 | 0.173 | 0.167 | 0.156 | 0.150 | 0.145 | 0.143 |
| 5.000 | 0.221 | 0.217 | 0.214 | 0.209 | 0.204 | 0.197 | 0.187 | 0.181 | 0.178 | 0.176 |
| 6.000 | 0.250 | 0.246 | 0.242 | 0.237 | 0.231 | 0.223 | 0.214 | 0.207 | 0.204 | 0.203 |

samples per cell: p=2: 69,544, 3: 74,186, 4: 36,410, 5: 27,209, 6: 22,186

## P(fill) within 60 min, by price p (rows) and contracts ahead Q (columns)

| p | 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100 | 200 | 500 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.000 | 0.238 | 0.232 | 0.229 | 0.223 | 0.216 | 0.208 | 0.195 | 0.187 | 0.182 | 0.179 |
| 3.000 | 0.201 | 0.197 | 0.194 | 0.190 | 0.185 | 0.179 | 0.169 | 0.161 | 0.156 | 0.153 |
| 4.000 | 0.328 | 0.323 | 0.319 | 0.312 | 0.305 | 0.297 | 0.279 | 0.269 | 0.261 | 0.257 |
| 5.000 | 0.376 | 0.370 | 0.365 | 0.358 | 0.350 | 0.340 | 0.325 | 0.316 | 0.310 | 0.308 |
| 6.000 | 0.418 | 0.410 | 0.406 | 0.401 | 0.392 | 0.381 | 0.367 | 0.358 | 0.354 | 0.351 |

samples per cell: p=2: 69,544, 3: 74,186, 4: 36,410, 5: 27,209, 6: 22,186

## P(fill) within 240 min, by price p (rows) and contracts ahead Q (columns)

| p | 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100 | 200 | 500 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.000 | 0.391 | 0.383 | 0.379 | 0.371 | 0.364 | 0.353 | 0.335 | 0.322 | 0.313 | 0.306 |
| 3.000 | 0.333 | 0.329 | 0.326 | 0.320 | 0.314 | 0.304 | 0.292 | 0.278 | 0.270 | 0.265 |
| 4.000 | 0.525 | 0.519 | 0.516 | 0.506 | 0.496 | 0.485 | 0.463 | 0.449 | 0.438 | 0.431 |
| 5.000 | 0.579 | 0.573 | 0.569 | 0.561 | 0.553 | 0.540 | 0.522 | 0.507 | 0.502 | 0.498 |
| 6.000 | 0.623 | 0.617 | 0.614 | 0.606 | 0.598 | 0.587 | 0.570 | 0.561 | 0.555 | 0.553 |

samples per cell: p=2: 69,544, 3: 74,186, 4: 36,410, 5: 27,209, 6: 22,186

## CLEAN fills only: P(queue consumed by taker volume at p, before any sweep through the level) within 20 min

| p | 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100 | 200 | 500 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.000 | 0.043 | 0.038 | 0.036 | 0.032 | 0.026 | 0.020 | 0.011 | 0.006 | 0.003 | 0.001 |
| 3.000 | 0.036 | 0.034 | 0.032 | 0.028 | 0.024 | 0.020 | 0.012 | 0.007 | 0.004 | 0.001 |
| 4.000 | 0.060 | 0.056 | 0.053 | 0.049 | 0.043 | 0.036 | 0.020 | 0.012 | 0.005 | 0.001 |
| 5.000 | 0.063 | 0.058 | 0.054 | 0.049 | 0.041 | 0.032 | 0.017 | 0.008 | 0.003 | 0.001 |
| 6.000 | 0.069 | 0.062 | 0.058 | 0.052 | 0.044 | 0.034 | 0.020 | 0.009 | 0.004 | 0.001 |

## CLEAN fills only: P(queue consumed by taker volume at p, before any sweep through the level) within 60 min

| p | 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100 | 200 | 500 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.000 | 0.082 | 0.075 | 0.071 | 0.064 | 0.054 | 0.043 | 0.025 | 0.014 | 0.007 | 0.002 |
| 3.000 | 0.070 | 0.065 | 0.061 | 0.056 | 0.049 | 0.040 | 0.027 | 0.015 | 0.007 | 0.003 |
| 4.000 | 0.113 | 0.105 | 0.101 | 0.092 | 0.082 | 0.070 | 0.042 | 0.025 | 0.011 | 0.003 |
| 5.000 | 0.114 | 0.106 | 0.099 | 0.089 | 0.077 | 0.061 | 0.035 | 0.018 | 0.007 | 0.001 |
| 6.000 | 0.120 | 0.109 | 0.102 | 0.094 | 0.080 | 0.063 | 0.038 | 0.018 | 0.008 | 0.002 |

## CLEAN fills only: P(queue consumed by taker volume at p, before any sweep through the level) within 240 min

| p | 0 | 1 | 2 | 5 | 10 | 20 | 50 | 100 | 200 | 500 |
|---|---|---|---|---|---|---|---|---|---|---|
| 2.000 | 0.148 | 0.137 | 0.131 | 0.120 | 0.106 | 0.090 | 0.055 | 0.033 | 0.016 | 0.004 |
| 3.000 | 0.128 | 0.120 | 0.115 | 0.106 | 0.095 | 0.080 | 0.058 | 0.032 | 0.016 | 0.004 |
| 4.000 | 0.199 | 0.188 | 0.183 | 0.167 | 0.149 | 0.130 | 0.087 | 0.054 | 0.026 | 0.007 |
| 5.000 | 0.192 | 0.180 | 0.173 | 0.158 | 0.140 | 0.114 | 0.070 | 0.035 | 0.015 | 0.003 |
| 6.000 | 0.197 | 0.184 | 0.175 | 0.160 | 0.141 | 0.114 | 0.073 | 0.035 | 0.014 | 0.002 |

## P(fill in 60 min) at Q=0, p=2-6c pooled, by hours to settlement

| hours_to_close | filled | n | P_fill_60min |
|---|---|---|---|
| <6h | 3304 | 20779 | 0.159 |
| 6-12h | 9484 | 39748 | 0.239 |
| 12-24h | 29412 | 85742 | 0.343 |
| 24-36h | 14037 | 51197 | 0.274 |
| 36-48h | 6682 | 32069 | 0.208 |

## P(fill in 60 min) at Q=0, p=2-6c pooled, by Eastern time of placement

| placement_time | filled | n | P_fill_60min |
|---|---|---|---|
| 00-04ET | 6123 | 24126 | 0.254 |
| 04-08 | 7702 | 25261 | 0.305 |
| 08-12 | 15997 | 51480 | 0.311 |
| 12-16 | 15384 | 52374 | 0.294 |
| 16-20 | 10250 | 41828 | 0.245 |
| 20-24 | 7463 | 34466 | 0.217 |

## P(fill in 60 min) at Q=20, p=2-6c pooled, by hours to settlement

| hours_to_close | filled | n | P_fill_60min |
|---|---|---|---|
| <6h | 3037 | 20779 | 0.146 |
| 6-12h | 8658 | 39748 | 0.218 |
| 12-24h | 26377 | 85742 | 0.308 |
| 24-36h | 12422 | 51197 | 0.243 |
| 36-48h | 5721 | 32069 | 0.178 |

## P(fill in 60 min) at Q=20, p=2-6c pooled, by Eastern time of placement

| placement_time | filled | n | P_fill_60min |
|---|---|---|---|
| 00-04ET | 5537 | 24126 | 0.230 |
| 04-08 | 6925 | 25261 | 0.274 |
| 08-12 | 14103 | 51480 | 0.274 |
| 12-16 | 13708 | 52374 | 0.262 |
| 16-20 | 9202 | 41828 | 0.220 |
| 20-24 | 6740 | 34466 | 0.196 |

## P(fill in 60 min) by trailing-6h taker-buy volume at >= p (arrival-rate proxy), p=2-6c pooled

| trailing_6h_contracts | Q=0 | Q=20 | samples |
|---|---|---|---|
| <1 | 0.087 | 0.070 | 151184 |
| 1-10 | 0.219 | 0.180 | 38896 |
| 10-50 | 0.245 | 0.205 | 58326 |
| 50-200 | 0.342 | 0.304 | 80164 |
| >200 | 0.479 | 0.448 | 130500 |

## Adverse selection: P(fill within 240 min at Q=0) by how the market settles (all brackets trading at 2-6c, not just certified tails)

| yes | filled | n | P_fill_240min_Q0 |
|---|---|---|---|
| settles NO | 97649 | 225658 | 0.433 |
| settles YES | 2989 | 3877 | 0.771 |

## Where fills land, by channel (H=240, Q=0, all brackets at 2-6c): share of fills in markets that settle YES

| channel | yes_share |
|---|---|
| any fill | 0.030 |
| clean (volume) fill | 0.016 |
| sweep-only fill (level cleared by price move) | 0.037 |
| all samples | 0.017 |

Share of simulated fills that land on markets that settle YES: 2.97%; share of all samples that settle YES: 1.69%. Resting sellers are adversely selected when the first is larger than the second.


## Old backtest fill rule (any later trade at/through p within 6h) vs queue-aware rule on the same placements

| price | trailing_vol | samples | old_rule_6h | queue_aware_Q0_4h | queue_aware_Qmedian_4h | clean_Qmedian_4h |
|---|---|---|---|---|---|---|
| 2 | all | 69544 | 0.489 | 0.391 | 0.322 | 0.033 |
| 2 | <1 | 23063 | 0.306 | 0.182 | 0.134 | 0.017 |
| 2 | >200 | 20850 | 0.509 | 0.479 | 0.438 | 0.043 |
| 3 | all | 74186 | 0.397 | 0.333 | 0.292 | 0.058 |
| 3 | <1 | 30202 | 0.205 | 0.149 | 0.118 | 0.029 |
| 3 | >200 | 20174 | 0.505 | 0.481 | 0.445 | 0.095 |
| 4 | all | 36410 | 0.614 | 0.525 | 0.485 | 0.130 |
| 4 | <1 | 11380 | 0.339 | 0.254 | 0.215 | 0.056 |
| 4 | >200 | 9583 | 0.849 | 0.806 | 0.777 | 0.246 |
| 5 | all | 27209 | 0.662 | 0.579 | 0.522 | 0.070 |
| 5 | <1 | 6605 | 0.382 | 0.294 | 0.252 | 0.043 |
| 5 | >200 | 7767 | 0.868 | 0.827 | 0.778 | 0.119 |
| 6 | all | 22186 | 0.703 | 0.623 | 0.598 | 0.141 |
| 6 | <1 | 4342 | 0.450 | 0.363 | 0.337 | 0.115 |
| 6 | >200 | 6876 | 0.879 | 0.833 | 0.816 | 0.213 |
| all | all | 229535 | 0.520 | 0.438 | 0.388 | 0.071 |
| all | <1 | 75592 | 0.286 | 0.200 | 0.161 | 0.035 |
| all | >200 | 65250 | 0.639 | 0.606 | 0.570 | 0.116 |

(queue_aware horizons are 4h: the old rule gets 6h, so the gap is understated. Q_median = the median touch depth by price measured in the live books: 2c: 85, 3c: 53, 4c: 18, 5c: 50, 6c: 10.)


## Weather sells: realised result of simulated fills by channel (all brackets at p, uncertified, sold at p and held, no fee)

| p | channel | fills | yes_rate | pnl_per_contract_c |
|---|---|---|---|---|
| 2 | any | 27189 | 0.017 | 0.260 |
| 3 | any | 24738 | 0.023 | 0.696 |
| 4 | any | 19131 | 0.033 | 0.744 |
| 5 | any | 15753 | 0.040 | 1.039 |
| 6 | any | 13827 | 0.051 | 0.945 |
| 2 | clean | 10283 | 0.013 | 0.668 |
| 3 | clean | 9485 | 0.013 | 1.672 |
| 4 | clean | 7248 | 0.022 | 1.751 |
| 5 | clean | 5220 | 0.007 | 4.272 |
| 6 | clean | 4362 | 0.028 | 3.157 |
| 2 | sweep-only | 16906 | 0.020 | 0.013 |
| 3 | sweep-only | 15253 | 0.029 | 0.089 |
| 4 | sweep-only | 11883 | 0.039 | 0.129 |
| 5 | sweep-only | 10533 | 0.056 | -0.563 |
| 6 | sweep-only | 9465 | 0.061 | -0.075 |

The uncertified base rate settles YES about 1.7% of the time; certified far tails (model p <= 1%) must beat it. A sweep fill is the market moving up through the ask.
