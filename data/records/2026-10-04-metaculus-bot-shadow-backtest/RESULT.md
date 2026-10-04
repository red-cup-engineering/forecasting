# Shadow backtest: 40 resolved Polymarket binary markets, as-of = end minus lead, market price at as-of is the baseline
Questions 40; YES rate 0.250; resolve window 2026-06-21 to 2026-09-20; calibration: floor 0.03 cap 0.97 extremize 1

| Arm | Forecaster | n | Brier | Log loss |
| --- | --- | ---: | ---: | ---: |
| no-retrieval | market price at as-of | 20 | 0.082 | 0.302 |
| no-retrieval | always 0.50 | 20 | 0.250 | 0.693 |
| no-retrieval | member qwen-groq | 20 | 0.182 | 0.585 |
| no-retrieval | ensemble pooled | 20 | 0.182 | 0.585 |
| no-retrieval | ensemble calibrated (bot output) | 20 | 0.182 | 0.585 |
| retrieval | market price at as-of | 30 | 0.150 | 0.510 |
| retrieval | always 0.50 | 30 | 0.250 | 0.693 |
| retrieval | member qwen-groq | 30 | 0.336 | 1.085 |
| retrieval | member llama-nvidia | 30 | 0.259 | 0.790 |
| retrieval | ensemble pooled | 30 | 0.287 | 0.873 |
| retrieval | ensemble calibrated (bot output) | 30 | 0.287 | 0.873 |

Paired difference in Brier, bot minus market (negative = bot better), 95% bootstrap interval over questions:
- no-retrieval: 0.100 [-0.043, 0.258] over n=20
- retrieval: 0.136 [0.017, 0.255] over n=30
- no-retrieval Platt (fit on earlier 10, test on later 10): a=0.61 b=-2.53; test Brier identity 0.100, Platt 0.233, market 0.129
  extremize x0.8 on test: Brier 0.105
  extremize x1.2 on test: Brier 0.098
  extremize x1.5 on test: Brier 0.099
- retrieval Platt (fit on earlier 15, test on later 15): a=-0.06 b=-0.75; test Brier identity 0.259, Platt 0.177, market 0.214
  extremize x0.8 on test: Brier 0.252
  extremize x1.2 on test: Brier 0.266
  extremize x1.5 on test: Brier 0.277

Leak probe (no-retrieval arm): directional accuracy on the earlier-resolving half 0.700 vs the later half 0.900. Higher accuracy on EARLIER questions than later ones would suggest the models remember outcomes; it is a weak probe, not proof either way.
