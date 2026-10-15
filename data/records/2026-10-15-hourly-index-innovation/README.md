# Hourly city index: fitted recent-reading persistence — October 15, 2026

Replaces the labelled "uncalibrated three-hour decay" of `recent-innovation-v1` with a gain and decay fitted per city on past outcomes, as the new experiment `recent-innovation-v2`. Measured on 29 held-out days, four cities, 11,099 scored hourly targets: **mean CRPS 1.021 F → 0.974 F (-0.047 F, 4.6%)** and **mean Brier 0.166 → 0.157** against the deployed v1; against guidance alone (`nbh`) 1.150 F → 0.974 F.

## Where this came from

Three notes written by an AI (Foundational Architecture iteration 4, Adaptive Micro-Scale Station Metrology iteration 5, Omnivorous Planetary Telemetry iteration 6) were supplied on 2026-10-14 and again on 2026-10-15 with the Leader's judgement that their mathematics is weak and flawed in parts but their notions are good. Lenticule Climate Science already separated the notions from the unsupported constants in [its 2026-10-14 study](https://github.com/lenticule-science/climate-science-services-section/blob/main/content/text/documents/articles/2026-10-14-source-bound-hourly-temperature-forecast-science.md); this record does not repeat that work. It measures which notion buys the most on the hourly city indices and lands that one.

| Notion in the notes | State on 2026-10-15 |
|---|---|
| Settlement operator (rounding, preimage of whole-°C reports) | Done: `station-observations.mjs` (Lenticule §2); the index's own operator is `reproduceIndex` |
| Fixed-share hypothesis weights scored by CRPS | Done: `weather-family-learning.mjs`, `paired-family-fixed-share-v2` |
| Station-quirk bases that drift, tracked by a Kalman filter | **This change**, in its measurable core: an Ornstein-Uhlenbeck error process observed at the latest index minute, fitted per city |
| Station-quirk bias by time of day, changepoint detection | Measured here, mixed result; requirement `hourly-index-bias-by-hour-with-changepoint-detection` |
| Reference-network isolation of the synoptic error | Requirement `hourly-index-nowcast-per-station-innovations` |
| Quantile averaging (Wasserstein barycenter) | Requirement `hourly-index-quantile-average-competes-with-the-linear-pool`; Lenticule §4 proves it is a different hypothesis from the mixture |
| Bracket coherence | Requirement `hourly-index-ladders-are-checked-for-nested-coherence`; Lenticule §4 corrects the partition claim: strikes are nested |
| Ambiguity-averse fractional Kelly | Requirement `hourly-index-sizing-reads-the-measured-predictive-band` |

## The model and what math forces

Let `b(t)` be the guidance proxy of the index (`Σ w_i (TMP_i + 1.8 (c_ref − o_i))` over the certified roster) and `y(t0)` the latest published index minute. The forecast error `e(t) = y(t) − b(t)` of numerical guidance is positively autocorrelated; modelling it as a mean-reverting Gaussian process (Ornstein-Uhlenbeck, the continuous-time AR(1)) with a noisy observation at `t0` gives the conditional mean

    E[y(t)] = b(t) + a · exp(−(t − t0)/τ) · (y(t0) − b(t0)),

where `a` is the Kalman gain (at most 1 when the reading carries no noise and the process is stationary) and `τ` the correlation time. The deployed v1 is the point `a = 1, τ = 3 h`. Fitting minimizes squared error over past rows by closed-form least squares in `a` for each `τ` in {0.5, 1, 1.5, 2, 3, 4, 6, 8, 12} h, with `a` clamped to [0, 1.2]. Anchors: Gelb, *Applied Optimal Estimation* (1974) for the scalar Kalman gain; Gneiting & Raftery (2007) for CRPS and Brier as strictly proper rules; Herbster & Warmuth for the experts learner already in place. **recheck** these citations against primary text.

Fitted constants through 2026-10-14 (`src/weather-index-innovation-fit.json`):

| City | Gain a | Decay τ | Settled rows |
|---|---|---|---|
| Miami | 0.873 | 8 h | 4,098 |
| NYC | 1.012 | 6 h | 3,945 |
| Chicago | 1.172 | 4 h | 4,002 |
| Coastal LA | 0.943 | 12 h | 3,986 |

Long decays (4–12 h) mean most of the forecast error is a slowly changing offset, not a fast-decaying transient. That is the "non-stationary station quirk" of the second note, observed directly.

## Protocol

`scripts/hourly-index-backtest-data.mjs` freezes the inputs into one cache: Kalshi's published minute index per city (`live_data/weather/<city>`, `from`/`to` in milliseconds, 45 days available), the append-only calibrations, and the NOAA NBM hourly (NBH) text bulletin of every third cycle (344 cycles, 2026-09-02 to 2026-10-14, about 28 MB each). `scripts/hourly-index-backtest.mjs` makes a decision at cycle + 2 h (observed bulletin lag 0.7 to 1.7 h), anchors on the latest index minute at or before it, and scores the whole-hour targets 1 to 12 h later. On each evaluation day every parameter is refitted on rows whose targets settled before that day started. Truth is the index minute at the target; configuration is the one in force at decision time. Scores weight each (city, local date) once. Student-t, 5 degrees of freedom, with the guidance spread, as in production. Brier uses the events `index > K` for the five integers K nearest the guidance mean.

Reproduce: `node scripts/hourly-index-backtest-data.mjs <dir> 2026-09-02 2026-10-14` then `node scripts/hourly-index-backtest.mjs <dir> 2026-09-16 2026-10-14 report.json --fit src/weather-index-innovation-fit.json --record data/records/2026-10-15-hourly-index-innovation/README.md`. The full numbers are `backtest-report.json`.

## Results (29 dates, lower is better)

| Model | CRPS (F) all | 1–3 h | 4–6 h | 7–12 h | Brier all |
|---|---|---|---|---|---|
| `nbh` guidance only | 1.150 | 1.123 | 1.133 | 1.173 | 0.190 |
| `innovation-v1` (deployed) | 1.021 | 0.749 | 1.030 | 1.153 | 0.166 |
| **`innovation-fit` (v2)** | **0.974** | **0.706** | **0.967** | **1.111** | **0.157** |
| + hour-of-day bias | 0.967 | 0.726 | 0.960 | 1.091 | 0.156 |
| + lead-time spread | 0.962 | 0.709 | 0.961 | 1.088 | 0.155 |

Paired date-block bootstrap of v2 minus v1: CRPS -0.047 F (indicative 95% interval -0.074 to -0.023), better on 21 of 29 dates; Brier -0.0090 (-0.0137 to -0.0044), better on 20 of 29. By city, the gain is concentrated where persistence is long: Miami -0.062 and Coastal LA -0.124 (both intervals exclude zero); NYC +0.002 and Chicago -0.005 are indistinguishable from v1. The repository's rule withholds confidence intervals below thirty dates and this window has 29, so the intervals are indications, not admissions.

Not shown to help, so not landed:

- **Hour-of-day bias** helps Coastal LA (-0.063 further) and barely Miami, but hurts Chicago (+0.036) and short leads overall. The fit needs a changepoint-aware or longer-memory form; recorded as a requirement.
- **Lead-time spread** multipliers of 0.6–0.7 at 1–3 h show that once the recent reading is used, the NBH spread is too wide for short leads. The gain is 0.005 F, and `postprocessTemperature` in production refuses to narrow, so this is left to the requirement on spread calibration.

## What this does not establish

- It is a **physical** forecast score on NBH only. LAMP, NWS and ECMWF components are not backtested (LAMP and NWS archives are not in the open NBM bucket), so `recent-innovation-v2` is added for the NBH proxy and not for the family pools.
- It does not show market edge. The desk's forecast surface admits only models whose settlement grades beat the market mid, and `recent-innovation-v2` starts ungraded; the earlier v1 keeps its record. v1 is retired when v2's own grade supersedes it.
- The final constants are fitted on the whole window, so the in-sample score of the shipped constants is optimistic; the table above is the rolling past-only score. Refit weekly with the same two commands, since seasonal change moves persistence.
- 29 dates in one autumn month; no summer convective regime, no frontal passage sample worth reporting separately.

## Found while doing it

`parseNbhBulletin` accepted only a two-digit month in the bulletin header (`10/13/2026`), but NOAA prints `9/20/2026` for January through September. Every NBH bulletin before 2026-10-10 parsed to nothing, and the same would have happened from 2027-01-01. Fixed in place; `test/nbm-hourly-guidance.test.mjs` fails on the old pattern.
