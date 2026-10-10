# Crypto combo prints against measured cross-asset correlation, 2026-10-07

Shadow research on the combo lane's 10-04 tape. The work is read-only and no order paths are
touched. Code: `src/crypto-joint.mjs`, `scripts/crypto-combo-measure.mjs`, `test/crypto-joint.test.mjs`.

## Question

Kalshi's 15-minute crypto "up" markets settle YES when the 60-second average of the CF Benchmarks RTI
at the window's close is at least the 60-second average at its open. The assets are BTC, ETH, XRP,
DOGE, SOL, BNB, ZEC, HYPE and NEAR. Combos join 2–9 of these markets in one window. Do executed combo
prices reflect the assets' correlation?

## Data and forecasters

- **Prints:** 2,719 settled prints in 57 windows. All errors are delete-one-window jackknife
  standard errors, because every combo in a window shares the window's outcomes.
- **Correlation (ρ):** measured from 1-minute Binance log returns over the prior 24 hours, with no
  lookahead. The mean off-diagonal is 0.43 (range 0.19–0.72).
- **Forecasters:**
  - `print`: the executed price;
  - `indepMid`: the product of the leg mids;
  - `midJoint`: a Gaussian copula of the leg mids with the measured ρ;
  - `spotJoint`: the same copula with marginals from spot diffusion.

## Results

| forecaster | Brier | Δ vs print |
| --- | --- | --- |
| print | 0.1378 ± 0.0099 | (reference) |
| indepMid | 0.1348 ± 0.0083 | −0.0030 ± 0.0056 |
| midJoint | 0.1361 ± 0.0093 | −0.0016 ± 0.0020 |
| spotJoint | 0.1444 ± 0.0102 | +0.0066 ± 0.0066 |

- **Spot marginals lose to Kalshi's leg books:** single-leg Brier is 0.161 for spot against 0.144 for
  the mids. Stale 1-minute bars explain most of the gap.
- **Prints embed more correlation than the assets show:** regressing the print on
  indepMid + β(midJoint − indepMid) gives β = 1.27 ± 0.02.
- **Prints are miscalibrated at the top:** in the deciles predicting 0.50, 0.68 and 0.90, the observed
  frequencies are 0.42, 0.54 and 0.81. Taker-YES prints overpay by 3.9¢ ± 2.2¢.
- **Shadow maker:** sell YES when the print is above midJoint + m; buy when it is below midJoint − m.
  Maker fee assumed zero; P&L per print.

  | margin m | prints traded | P&L per print |
  | --- | --- | --- |
  | 0.02 | 1,428 | +9.1¢ ± 2.5¢ (t = 3.6) |
  | 0.05 | 620 | +9.0¢ ± 3.6¢ |

  The sells carry the edge.

## Status

This is an in-sample result from one day (57 windows), and it assumes we would have won each RFQ. It
becomes a lane only after the out-of-sample days pass. Those days are backfilled from public history:
the combo tape, the legs, and 1-minute leg candles. The days were fixed in advance: 09-27, 09-30 and
10-02.

## Out of sample (days fixed in advance; public-history backfill): the lead is killed

`node scripts/crypto-combo-measure.mjs --spot <day> --state combo-backfill/crypto-<day>`. Combos are
restricted to the nine crypto assets; the backfill also holds 15-minute commodity legs.

| day | prints / windows | β (ρ from 1-min returns) | Brier print | Brier midJoint | midJoint m=0.02 maker P&L |
| --- | --- | --- | --- | --- | --- |
| 09-27 | 4,854 / 22 | 1.265 ± 0.032 | 0.1356 | 0.1429 | −0.06¢ ± 3.8 |
| 09-30 | 3,905 / 23 | 1.128 ± 0.030 | 0.1242 | 0.1335 | +1.8¢ ± 2.6 |
| 10-02 | 5,291 / 19 | 1.165 ± 0.066 | 0.1080 | 0.1244 | −0.3¢ ± 2.1 |

- **β replicates:** prints always carry more correlation than 1-minute-return ρ.
- **The prints are the better forecaster on every day**, by 0.007–0.016 Brier. The extra correlation
  is correct, and our ρ is too low.
- **The cause is the Epps effect:** high-frequency correlation estimates are biased low. With
  `RHO_H=15` (ρ from non-overlapping 15-minute returns), β moves toward 1 (09-27 1.035, 10-02 1.094)
  and the Brier gap narrows (09-27 0.0044 ± 0.0035), but the prints still win.
- **The maker rule earns nothing out of sample:** t = 0.89, 0.66 and −0.93 by day.

**Verdict:** Kalshi's crypto-combo makers price the joint as well as or better than a measured-ρ
copula. The in-sample +9.1¢ was the Epps bias plus one day's luck. Do not trade it.

Keep two things: estimate ρ at the contract's own horizon, never at the sampling interval; and the
house's measured-correlation copula, which now carries that correction.
