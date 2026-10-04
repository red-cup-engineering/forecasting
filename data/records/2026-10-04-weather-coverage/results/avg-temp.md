# KXAVGTK* weekly average temperature (>= N consecutive days with (hi+lo)/2 > 90F) -- 10 cities, 6 weeks; decisions Wed/Fri 15h with the elapsed days observed (IEM climate reports) and NBS (reaches ~3.7 days) for the rest

| decision | n | yes_rate | brier_model | brier_mid |
|---|---|---|---|---|
| Fri 15h | 305 | 0.144 | 0.027 | 0.011 |
| Wed 15h | 305 | 0.144 | 0.041 | 0.026 |

| bin | n | model | mid | yes |
|---|---|---|---|---|
| (-0.01, 0.02] | 437 | 0.001 | 0.052 | 0.000 |
| (0.02, 0.1] | 24 | 0.048 | 0.080 | 0.000 |
| (0.1, 0.3] | 20 | 0.201 | 0.167 | 0.100 |
| (0.3, 0.6] | 30 | 0.458 | 0.155 | 0.100 |
| (0.6, 0.9] | 16 | 0.775 | 0.430 | 0.375 |
| (0.9, 1.0] | 83 | 0.993 | 0.886 | 0.928 |

candidates: tails 2 (wrong 0), favourites 2 (wrong 2)