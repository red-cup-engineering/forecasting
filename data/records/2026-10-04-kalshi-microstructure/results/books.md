Snapshots: 3919 over 10 sweeps, 429 markets, 10-04 03:03 .. 10-04 03:53 UTC

Snapshots inside an active LIP window: 55.5% (weather: 0.0%, gas: 92.8%)

## Weather: queue length at the touch ask, by touch price (a sell joining the touch has this many contracts ahead)

| ask | count | mean | 25% | 50% | 75% | 90% | max |
|---|---|---|---|---|---|---|---|
| 2.000 | 437.000 | 144.900 | 40.200 | 103.000 | 168.200 | 354.600 | 638.200 |
| 3.000 | 247.000 | 96.000 | 24.000 | 70.000 | 147.000 | 206.000 | 571.800 |
| 4.000 | 198.000 | 55.700 | 6.200 | 33.900 | 74.000 | 163.300 | 315.300 |
| 5.000 | 119.000 | 58.200 | 8.000 | 50.000 | 74.000 | 125.600 | 354.000 |
| 6.000 | 146.000 | 60.400 | 4.000 | 12.000 | 55.000 | 223.400 | 654.000 |
| 7.000 | 53.000 | 55.800 | 2.000 | 4.000 | 15.000 | 306.400 | 326.600 |
| 8.000 | 41.000 | 35.400 | 4.000 | 20.000 | 25.000 | 93.900 | 234.800 |

## Weather: spread (ask - bid) and share of snapshots where a 1c improvement is possible (spread >= 2c), touch ask 2-6c

| ask | snaps | spread_median | share_spread_ge2 | share_no_bid |
|---|---|---|---|---|
| 2.000 | 437.000 | 1.000 | 0.000 | 0.481 |
| 3.000 | 247.000 | 2.000 | 0.433 | 0.267 |
| 4.000 | 198.000 | 1.000 | 0.384 | 0.116 |
| 5.000 | 119.000 | 2.000 | 0.563 | 0.185 |
| 6.000 | 146.000 | 3.000 | 0.685 | 0.000 |

## Weather: depth resting at each ask price when any exists (contracts)

| index | count | mean | 50% | 90% | max |
|---|---|---|---|---|---|
| a2 | 442.000 | 144.800 | 101.600 | 357.600 | 638.200 |
| a3 | 658.000 | 83.100 | 49.000 | 201.000 | 571.800 |
| a4 | 752.000 | 58.300 | 37.000 | 128.000 | 315.300 |
| a5 | 810.000 | 44.000 | 32.100 | 100.000 | 354.000 |
| a6 | 866.000 | 53.400 | 28.000 | 123.000 | 654.000 |

## Weather: touch churn between consecutive sweeps (about 5 min apart), touch ask 2-8c

pairs 1115; touch price changed 8.3%; touch size changed (same price) 21.3%; unchanged 70.4%

## Gas: depth at the touch bid (a buy joining the touch has this many ahead), by touch price and LIP window

| bid | lip | count | mean | 50% | 90% | max |
|---|---|---|---|---|---|---|
| 90.000 | False | 6.000 | 555.000 | 555.000 | 1010.000 | 1010.000 |
| 90.000 | True | 19.000 | 40.300 | 58.000 | 81.000 | 81.000 |
| 91.000 | False | 1.000 | 1779.000 | 1779.000 | 1779.000 | 1779.000 |
| 91.000 | True | 9.000 | 663.500 | 1062.400 | 1190.300 | 1702.000 |
| 92.000 | True | 24.000 | 1253.100 | 912.400 | 3241.700 | 3274.700 |
| 93.000 | False | 1.000 | 1601.000 | 1601.000 | 1601.000 | 1601.000 |
| 93.000 | True | 16.000 | 882.100 | 1003.000 | 1238.000 | 1489.000 |
| 94.000 | False | 1.000 | 217.000 | 217.000 | 217.000 | 217.000 |
| 94.000 | True | 17.000 | 940.600 | 1029.000 | 1395.400 | 1496.000 |
| 95.000 | False | 1.000 | 3290.000 | 3290.000 | 3290.000 | 3290.000 |
| 95.000 | True | 33.000 | 533.100 | 5.000 | 1214.200 | 3273.000 |
| 96.000 | True | 31.000 | 1221.700 | 1147.000 | 1600.000 | 3988.000 |
| 97.000 | False | 3.000 | 2653.300 | 2550.000 | 3062.000 | 3190.000 |
| 97.000 | True | 28.000 | 1801.100 | 1080.000 | 3797.200 | 3874.000 |
| 98.000 | False | 1.000 | 1000.000 | 1000.000 | 1000.000 | 1000.000 |
| 98.000 | True | 281.000 | 2658.700 | 1533.000 | 5084.000 | 5646.000 |

## Gas: share of snapshots with >= 1000 contracts at the touch bid (LIP target size), by LIP window

| lip | snaps | ge1000 | median_q |
|---|---|---|---|
| False | 14 | 0.714 | 1010.000 |
| True | 458 | 0.742 | 1066.210 |

## Gas: no-ask-at-all (nothing offered): share of favourite snapshots whose book has no YES ask

58.5%  (only bids and no asks => our bid can fill only against a taker who sells YES, a rare event)


## Static large levels (bids, >= 200 contracts, identical size in >= 60% of sweeps): 95 levels in 75 markets; weather 33, gas 61

| kind | p | levels | median_size |
|---|---|---|---|
| gas | 1 | 27 | 1000.000 |
| weather | 1 | 22 | 320.000 |
| gas | 98 | 12 | 1333.000 |
| gas | 2 | 6 | 3002.000 |
| weather | 3 | 4 | 446.000 |
| weather | 2 | 4 | 326.000 |
| gas | 96 | 2 | 1302.000 |
| gas | 97 | 2 | 200.000 |
| gas | 78 | 1 | 736.000 |
| gas | 23 | 1 | 300.000 |
| gas | 9 | 1 | 1000.000 |
| gas | 5 | 1 | 200.000 |
| gas | 77 | 1 | 3602.000 |
| gas | 86 | 1 | 949.000 |
| gas | 87 | 1 | 379.000 |

## Static large levels (asks, >= 200 contracts, identical size in >= 60% of sweeps): 129 levels in 116 markets; weather 39, gas 84

| kind | p | levels | median_size |
|---|---|---|---|
| gas | 2 | 38 | 1300.000 |
| gas | 99 | 15 | 1002.000 |
| gas | 5 | 9 | 1005.000 |
| weather | 2 | 5 | 411.000 |
| gas | 3 | 5 | 1003.000 |
| weather | 99 | 5 | 309.000 |
| weather | 3 | 3 | 338.000 |
| weather | 10 | 3 | 289.000 |
| gas | 6 | 2 | 1041.000 |
| weather | 27 | 2 | 260.000 |
| weather | 24 | 2 | 246.000 |
| weather | 12 | 2 | 210.000 |
| gas | 10 | 2 | 242.000 |
| gas | 8 | 2 | 1005.000 |
| weather | 8 | 2 | 280.000 |

## Desk resting orders: signed queue_position (contracts ahead) vs book depth at that level, per sweep

| tk | side | p | reads | q_first | q_last | depth_first | depth_last | size |
|---|---|---|---|---|---|---|---|---|
| KXAAAGASDAZ-26OCT04-4.7250 | bid | 98 | 4 | 1532 | 1532 | 1533 | 1533 | 1 |
| KXAAAGASDCA-26OCT04-6.3550 | bid | 98 | 4 | 1500 | 1500 | 1501 | 1501 | 1 |
| KXAAAGASDCA-26OCT04-6.3600 | bid | 98 | 4 | 1036 | 1036 | 1037 | 1037 | 1 |
| KXAAAGASDMA-26OCT04-4.3150 | bid | 95 | 6 | 1002 | 1001 | 1003 | 1002 | 1 |
| KXAAAGASDMN-26OCT04-4.1850 | bid | 98 | 4 | 3374 | 3374 | 3375 | 3375 | 1 |
| KXAAAGASDMN-26OCT04-4.1900 | bid | 98 | 4 | 1018 | 1018 | 1019 | 1019 | 1 |
| KXAAAGASDNY-26OCT04-4.4500 | bid | 98 | 4 | 0 | 0 | 1 | 1 | 1 |
| KXAAAGASDNY-26OCT04-4.4550 | bid | 98 | 4 | 0 | 0 | 1 | 1 | 1 |
| KXHIGHTSAN-26OCT04-B101.5 | ask | 3 | 6 | 2 | 0 | 12 | 10 | 9 |
| KXHIGHTSAN-26OCT04-T102 | ask | 2 | 6 | 31 | 0 | 31 | 199 | 1 |
