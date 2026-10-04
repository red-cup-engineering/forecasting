# Daily rain (KXRAIN) model: NBS P06 vs Kalshi mid

Fit dates < 2026-09-02, test >= 2026-09-02. Rows are (market, decision time); mid = (bid+ask)/2 from the last hourly candle.

Two-fold cross-fit by date (fit on one side of the split, predict the other), so every row is out-of-sample.
D-1 15h pany: fit on early half w=[-0.488, 1.092] n=738
D-1 15h pany: fit on late half w=[-0.442, 1.252] n=766
D-1 15h pany+q: fit on early half w=[-0.09, 0.688, 0.002, 0.451] n=738
D-1 15h pany+q: fit on late half w=[-0.332, 1.239, -0.006, 0.064] n=766
  OOF Brier (n=1504): climatology 0.1831 | raw pany 0.0915 | model(pany) 0.0885 | model(pany+q) 0.0887 | Kalshi mid 0.0903 | 50/50 pool 0.0863

D-1 21h pany: fit on early half w=[-0.511, 1.1] n=743
D-1 21h pany: fit on late half w=[-0.479, 1.34] n=766
D-1 21h pany+q: fit on early half w=[-0.297, 0.998, -0.006, 0.166] n=743
D-1 21h pany+q: fit on late half w=[-0.074, 1.268, -0.02, 0.271] n=766
  OOF Brier (n=1509): climatology 0.1827 | raw pany 0.0885 | model(pany) 0.0854 | model(pany+q) 0.0852 | Kalshi mid 0.0848 | 50/50 pool 0.0820

D 07h pany: fit on early half w=[-0.445, 1.094] n=758
D 07h pany: fit on late half w=[-0.422, 1.291] n=766
D 07h pany+q: fit on early half w=[-0.111, 0.941, -0.012, 0.268] n=758
D 07h pany+q: fit on late half w=[-0.136, 1.388, -0.023, 0.095] n=766
  OOF Brier (n=1524): climatology 0.1828 | raw pany 0.0838 | model(pany) 0.0810 | model(pany+q) 0.0805 | Kalshi mid 0.0670 | 50/50 pool 0.0637

## Calibration on test (model p bins; all decision times)

| bin | n | model | mid | yes |
|---|---|---|---|---|
| (0.0, 0.02] | 1473 | 0.006 | 0.032 | 0.004 |
| (0.02, 0.05] | 617 | 0.034 | 0.073 | 0.026 |
| (0.05, 0.1] | 454 | 0.070 | 0.115 | 0.077 |
| (0.1, 0.2] | 411 | 0.145 | 0.215 | 0.168 |
| (0.2, 0.4] | 456 | 0.293 | 0.360 | 0.311 |
| (0.4, 0.6] | 343 | 0.496 | 0.560 | 0.496 |
| (0.6, 0.8] | 271 | 0.698 | 0.684 | 0.683 |
| (0.8, 0.9] | 167 | 0.851 | 0.798 | 0.802 |
| (0.9, 0.95] | 92 | 0.925 | 0.827 | 0.924 |
| (0.95, 0.98] | 63 | 0.967 | 0.894 | 0.968 |
| (0.98, 1.0] | 190 | 0.995 | 0.958 | 1.000 |

## Calibration of the market mid on test

| mbin | n | model | mid | yes |
|---|---|---|---|---|
| (0.0, 0.02] | 863 | 0.011 | 0.012 | 0.000 |
| (0.02, 0.05] | 940 | 0.025 | 0.033 | 0.011 |
| (0.05, 0.1] | 504 | 0.064 | 0.073 | 0.024 |
| (0.1, 0.2] | 472 | 0.115 | 0.144 | 0.112 |
| (0.2, 0.4] | 477 | 0.239 | 0.297 | 0.252 |
| (0.4, 0.6] | 390 | 0.443 | 0.501 | 0.421 |
| (0.6, 0.8] | 405 | 0.663 | 0.705 | 0.659 |
| (0.8, 0.9] | 164 | 0.845 | 0.854 | 0.902 |
| (0.9, 0.95] | 79 | 0.931 | 0.927 | 0.975 |
| (0.95, 0.98] | 56 | 0.943 | 0.967 | 0.982 |
| (0.98, 1.0] | 187 | 0.814 | 0.993 | 1.000 |