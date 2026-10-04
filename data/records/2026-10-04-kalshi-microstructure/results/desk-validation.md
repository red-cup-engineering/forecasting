# Desk resting history replayed against the public tape


## gas: 33 orders, 33 contracts, 12.1 order-hours, realised fill 0 contracts in 0 orders

tape-covered orders: 29; orders where ANY taker volume reached the price during life (V>0 or level cleared): 0; median V among those: nan

| Q_ahead | orders_that_would_fill | share | realised_fills |
|---|---|---|---|
| 0.000 | 0.000 | 0.000 | 0.000 |
| 1.000 | 0.000 | 0.000 | 0.000 |
| 2.000 | 0.000 | 0.000 | 0.000 |
| 5.000 | 0.000 | 0.000 | 0.000 |
| 10.000 | 0.000 | 0.000 | 0.000 |
| 20.000 | 0.000 | 0.000 | 0.000 |
| 50.000 | 0.000 | 0.000 | 0.000 |
| 100.000 | 0.000 | 0.000 | 0.000 |
| 200.000 | 0.000 | 0.000 | 0.000 |
| 500.000 | 0.000 | 0.000 | 0.000 |
| 1000.000 | 0.000 | 0.000 | 0.000 |
| 3000.000 | 0.000 | 0.000 | 0.000 |

## weather: 210 orders, 401 contracts, 79.7 order-hours, realised fill 12 contracts in 4 orders

tape-covered orders: 210; orders where ANY taker volume reached the price during life (V>0 or level cleared): 8; median V among those: 9.0

| Q_ahead | orders_that_would_fill | share | realised_fills |
|---|---|---|---|
| 0.000 | 8.000 | 0.038 | 4.000 |
| 1.000 | 7.000 | 0.033 | 4.000 |
| 2.000 | 5.000 | 0.024 | 4.000 |
| 5.000 | 5.000 | 0.024 | 4.000 |
| 10.000 | 3.000 | 0.014 | 4.000 |
| 20.000 | 3.000 | 0.014 | 4.000 |
| 50.000 | 3.000 | 0.014 | 4.000 |
| 100.000 | 1.000 | 0.005 | 4.000 |
| 200.000 | 1.000 | 0.005 | 4.000 |
| 500.000 | 1.000 | 0.005 | 4.000 |
| 1000.000 | 1.000 | 0.005 | 4.000 |
| 3000.000 | 1.000 | 0.005 | 4.000 |

## The realised fill(s)

| tk | p | n | filled | life_min | V | A |
|---|---|---|---|---|---|---|
| KXHIGHTSAN-26OCT04-B101.5 | 3 | 9.000 | 9.000 | 5.500 | 9.000 | 1.000 |
| KXHIGHTSAN-26OCT04-T102 | 2 | 1.000 | 1.000 | 12.400 | 73.900 | 0.000 |
| KXHIGHTSAN-26OCT04-T102 | 2 | 1.000 | 1.000 | 23.100 | 73.900 | 0.000 |
| KXHIGHTSAN-26OCT04-B101.5 | 3 | 2.000 | 1.000 | 10.600 | 1.000 | 0.000 |

## Implied queue ahead of the desk (lognormal on Q+1), maximum likelihood on weather sells

| loglik | median_Q | sigma |
|---|---|---|
| -4.110 | 11.180 | 3.000 |
| -4.120 | 14.640 | 3.000 |
| -4.130 | 8.490 | 3.000 |
| -4.150 | 19.090 | 3.000 |
| -4.180 | 6.390 | 3.000 |
| -4.210 | 8.490 | 2.000 |
| -4.210 | 24.790 | 3.000 |
| -4.220 | 11.180 | 2.000 |

(With one realised fill the likelihood is flat above its peak; read it as a lower bound on Q, not a point estimate.)


## Calibration of the replay grid on the desk's weather sells (Q=0 prediction vs outcome, matched on price, trailing-6h taker-buy volume, order life)

| subset | orders | predicted_fills_Q0 | ceiling_orders_with_volume | realised_fill_orders |
|---|---|---|---|---|
| all | 210 | 20.430 | 8 | 4 |
| live market at placement | 51 | 6.760 | 3 | 0 |
| not live | 159 | 13.670 | 5 | 4 |
| trailing 6h volume < 1 | 106 | 4.980 | 2 | 2 |
| trailing 6h volume >= 1 | 104 | 15.450 | 6 | 2 |
