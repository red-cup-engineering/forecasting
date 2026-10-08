# Supplemental forecast ensembles and calibration — October 7, 2026

The useful effect is a forecast distribution for a station, a published city index, or a daily extreme, with its actual uncertainty and outcomes preserved. Existing individual forecasts and the configured daily operations remain available. This addition removes the need to approximate a pooled distribution by a single bell curve or compare models on different outcomes.

## Research behind the implementation

Recovered ecosystem research includes the chronological [temperature-tail comparison](../2026-10-03-kalshi-temperature-tail-backtest/README.md), [weather coverage study](../2026-10-04-weather-coverage/README.md), and [physical forecast engineering](../2026-10-06-weather-prediction-improvements/README.md). These studies do not establish that generic meteorological predictions outperform current market probabilities; market skill continues to require its existing prospective settlement comparisons.

[Gneiting and Ranjan, Combining Predictive Distributions](https://arxiv.org/html/1106.1638) analyzes mixtures of forecast CDFs, including calibration and dispersion. It shows that linear pooling can increase dispersion and fail calibration, motivating explicit diagnostics rather than confidence by agreement. [ECMWF's calibration review](https://www.ecmwf.int/en/elibrary/74623-calibration-medium-range-weather-forecasts) supports comparing calibrated univariate distributions and using reforecast training data; this implementation does not claim to implement a new global weather simulation or train AIFS.

## Implemented transformations

Station and city forecasts now add an equal-weight mixture over available LAMP, NWS and NBM families. Hourly NBH replaces three-hour NBS within NBM wherever available; the two products never earn two family weights. Every component retains its mean, spread, provenance and mixture weight. Full mixture CDFs price hundredth-degree city contracts; their multiple peaks and provider disagreement are preserved. Affine local bias/spread adjustments transform every component and its separation, rather than just changing a display mean.

Daily high/low contracts add a separate linear pool of component probabilities for the same settlement event. NBM's published asymmetric quantiles take priority over its parametric daily model within the NBM family. Existing components remain separately forecast and graded. Missing daily temperatures, gaps and future source timestamps are refused as evidence of complete NWS daily coverage. Probabilistic-bulletin caches merge earlier station subsets and publish atomically.

Physical scoring computes 41 quadrature nodes per component, including cross-component distances through a sorted weighted CRPS identity. Its complexity is O(n log n), rather than all-pairs quadratic distance. The reported scale is only a variance summary; neither pricing nor scoring collapses the actual mixture to that summary.

Forecast calibration now exposes a ten-bin continuous-CDF probability integral transform (PIT), its mean and variance, and actual diagnostic sample counts. Historical aggregates without PIT are left without diagnostics. Hourly dependence is explicit: the histogram supplies no independence-based p-value. A 90% interval is tested using the actual distribution CDF.

For each pooled outcome, its component forecasts were frozen at the same issuance and are graded against the identical observation. Paired CRPS gains retain station, horizon, component, family, composition and truth distinctions, and weight each local date equally. Approximate date-cluster intervals are withheld until thirty dates. Physical gains do not authorize trades or imply a venue edge. This comparison uses no later provider updates to reconstruct component predictions.

## How to use it

Existing Cold Red Gate tools expose the addition: `weather_weather_station_evidence` registers standalone station forecasts without Kalshi reads; `weather_weather_index_evidence` registers city forecasts; `weather_weather_station_skill` returns PIT and paired component comparisons. The market cycle adds daily and hourly pool experiments to the existing model records. Native tools, original daily operations and the separately retained collector runtime remain the delivery path.

`@red-cup-engineering/forecasting/weather-ensemble` exports the pure distribution, pooling, calibration and scoring functions for other scientific consumers. Weights remain equal and untrained. Existing local postprocessing still requires seven completed dates and cannot narrow spread; this work diagnoses excessive dispersion without claiming it is already corrected.

## Demonstration

`node scripts/verify-ensemble-engineering.mjs` independently integrates squared CDF error to check mixture CRPS, proves that disagreement is preserved and identical distributions do not narrow, checks one weight per NBM family, transforms every calibrated component, scores frozen prospective components after their outcome, and verifies retries, absent legacy diagnostics, and withheld single-day confidence. It also verifies whole-degree daily ladder mass and rejection of incomplete or future NWS data. Synthetic outcomes stay in isolated temporary state. Existing meaningful prediction checks continue to pass. Hosted receipts below record the native and full-cycle effects without claiming improved long-run accuracy.

## Observed hosted effects

The native service registered 48 future Seattle station-pool forecasts without any Kalshi reads and 24 Miami index-pool forecasts plus 24 recent-innovation pool variants. Both native calls had no source errors and their immutable archives round-tripped. The full scheduled cycle added daily pools to 144 high and 144 low contracts, plus index pools to 30 hourly contracts; all 318 modelled contracts retained their original component experiments. Source and venue-settlement errors were empty. Peak worker memory was 162,156,544 bytes (about 155 MiB), and the timer remained active. Production state held 2,448 future pool forecasts. These new pooled outcomes had not yet resolved at verification; production PIT and paired-comparison sample counts were therefore zero.

The read-only replay inspected 105 evidence packets, verified their content hashes, and rebuilt 531 historical station-pool predictions from 44 immutable issuance snapshots, using their actual availability times. Each pooled forecast and its components were compared against the same recorded observation. Only two local dates were represented, so no confidence interval or statistical superiority is claimed. Individual sample rows retain station, horizon, composition, source and outcome content addresses. The reconstruction uses no current feed, no fitting and no writes to production forecasting or calibration state. It is distinct from the new model's prospective performance.

`historical-matched-comparisons.json` preserves matched component results; positive gain means a smaller pooled CRPS. The combination is not uniformly better than its constituents in this small reconstruction, and remains a supplemental experiment. Positive and negative gains and differing provider subsets remain visible rather than being replaced by an overall success claim.

In the reconstructed matched samples, pooled CRPS averaged 1.265 F versus LAMP's 1.197 F (531 matches), 1.287 F versus NBM's 1.523 F (297 matches), and 1.253 F versus NWS's 1.556 F (469 matches). Lower CRPS is better. Provider subsets differ, so each comparison uses its own matched pool score. These point summaries do not establish superiority: LAMP was stronger than the pool here, and no confidence interval is reported. The original models therefore remain active and separately graded; the untrained pool is retained as an additional experiment.
