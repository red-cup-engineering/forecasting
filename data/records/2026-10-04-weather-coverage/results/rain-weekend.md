# KXRAINWKND (weekend rain) -- 6 weekends, 133 markets

Daily-fit logistic weights [-0.464, 1.166] applied to P(any rain) over Sat+Sun from NBS P06. In-sample for the daily model, out-of-sample for the weekend contract.

| decision | n | yes_rate | brier_model | brier_mid | brier_pool |
|---|---|---|---|---|---|
| Fri 15h | 132 | 0.394 | 0.106 | 0.115 | 0.098 |
| Fri 21h | 132 | 0.394 | 0.109 | 0.113 | 0.100 |
| Sat 07h | 132 | 0.394 | 0.092 | 0.121 | 0.091 |
| Thu 15h | 77 | 0.195 | 0.064 | 0.132 | 0.067 |

candidates: tails 32, favourites 23

| rule | markets | wrong | taker_c_per_ct | rest_fill_rate | rest_c_per_placed | median_flow |
|---|---|---|---|---|---|---|
| tail_sell p<=0.03 bid>=3c | 32 | 0 | 4.710 | 0.310 | 3.220 | 0.000 |
| fav_buy p>=0.97 ask<=97c | 23 | 0 | 12.250 | 0.220 | 4.960 | 0.000 |