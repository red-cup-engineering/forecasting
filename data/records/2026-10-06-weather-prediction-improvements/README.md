# Weather prediction improvements, October 6–7, 2026

The existing NWS forecasting operations, semantic journal and daily-cycle consumers remain intact. This work supplements those models with a new short-range station source, independent physical verification and separately versioned adaptive local postprocessing. Kalshi outcomes remain one evaluation carrier within broader weather and climate science; station research can run without a market or venue read.

## Research recovered and checked

The [temperature-tail backtest](../2026-10-03-kalshi-temperature-tail-backtest/README.md) found that unconditional temperature forecasts and temperature/market pooling did not beat market probabilities overall. Its selective tail evidence and regime hazards should not be generalized into universal forecast superiority. No temperature pooling was added.

The [rain study](../2026-10-04-weather-coverage/README.md) reported gains from equal-log-odds pooling. Its scored CSV contains both temporal directions of a two-fold cross-fit. [The reproducible chronological check](scripts/check-rain-chronology.py) retains only September 2–October 2 predictions trained on the earlier half. The 2,298 rows span 31 settlement dates and three decision times; they are not 2,298 independent days.

| Decision time | Weather Brier | Market Brier | Pool Brier | 95% date-bootstrap interval for pool improvement |
| --- | ---: | ---: | ---: | ---: |
| Day before, 15h | .08093 | .07794 | .07734 | [−.00243, .00360] |
| Day before, 21h | .07815 | .07773 | .07566 | [−.00013, .00407] |
| Same day, 07h | .07559 | .05431 | .05462 | [−.00299, .00200] |

Lower Brier is better. Intervals use paired daily-mean differences and 10,000 bootstrap date resamples, fixed seed 561. Day-before pooling has favorable point estimates but no positive 95% lower bound. Same-day pooling has an unfavorable point estimate. Only the day-before pool is added as a forward experiment; it does not receive trading eligibility from this retrospective selection. [Raw results](rain-chronological-results.json) include the exact input hash. The engineering pool reproduces the historical log-odds calculation to floating-point precision; frozen early coefficients reproduce the CSV probabilities within 1.43e-7 rounding error. Existing frozen rain forecasts remain separately visible.

## External science used in engineering

[NOAA LAMP v2.7 documentation](https://vlab.noaa.gov/web/mdl/lamp-card-2.7.0) specifies hourly station guidance using recent observations and numerical-model inputs, with selected elements extended through 38 hours. The implemented parser reads standard and extended bulletins, validates UTC rollover and coherent issue times, rejects incomplete station blocks, handles absent runs and bounded fetch failures, and preserves temperature, dewpoint, wind and precipitation fields. NOAA's precipitation-on-the-hour probability may include unmeasurable precipitation; measurable-hour and six-hour probabilities remain distinct. They are not silently substituted for daily measurable-rain probabilities. [NOAA's webservices page](https://vlab.noaa.gov/web/mdl/lamp-nws-webservices) describes product availability.

[Ensemble model output statistics research](https://sites.stat.washington.edu/people/raftery/Research/PDF/gneiting2005.pdf) motivates fitting forecast bias/spread and evaluating distributions with proper scores. Our implemented method is regularized, date-weighted residual correction, **not full EMOS**: seven distinct scored dates, ten prior days of bias shrinkage, a ±5F bias cap and spread expansion only. The algorithm fits completed observations before issuing another forecast. Baseline outputs remain available for comparison. Default Student-t scales and hourly-to-daily extrema are explicit experiments, not NOAA probabilistic products.

[NOAA precipitation postprocessing research](https://repository.library.noaa.gov/view/noaa/14608) uses a distribution with a zero atom and calibrated positive accumulations. That supports retaining a distinction between rain occurrence and precipitation totals. A trained censored-gamma accumulation model is not claimed or deployed here; the current evidence preserves the source fields necessary for that work.

## Observable engineering effects

The station collector records first-available NWS, NBM and LAMP hourly temperature forecasts by station, valid hour and lead cohort. NWS observations retain timestamp, units, quality-control metadata and source URL. Pagination avoids silently losing dense station reports; duplicates and out-of-window values are filtered. Even future-only market listings collect today's observations, so market calendars do not suppress scientific feedback.

After each target hour plus fifteen minutes, the scorer records physical error, MAE, RMSE, 41-point quadrature CRPS and 90% interval coverage. Retrying a packet cannot score an outcome twice. Missing observations expire explicitly after 72 hours. The native Cold Red Gate tool `weather_weather_station_skill` reads those metrics without requiring a Kalshi listing. Physical verification is against NWS observations and never substitutes for venue settlement or grants market qualification.

`apps/replay-station-weather-science.mjs` provides isolated archival verification: packets run in actual file-write order, available time is conservative, and the output must be a new directory. Forecast source addresses and actual observation witnesses are retained. Retrospective replay is labeled and cannot seed production calibration or trading eligibility. Live collection and deployment evidence are saved beside this record after verification.

## Live demonstration

The first full cycle completed at 03:56 UTC on October 7 without source errors. Of 1,518 open weather contracts, 603 had model forecasts, up from 513 in the preceding cycle. LAMP contributed 288 high and 288 low estimates, overlapping existing models; the day-before rain pool contributed 27 competing forecasts. Coverage is not evidence of improved accuracy or execution eligibility.

The native station tool returned Seattle's fresh 03:30 UTC LAMP run through 38 hours, 234 timestamped observations and 53 physical forecasts, with zero Kalshi reads. The full collector registered 2,986 pending physical forecasts across 33 stations. [Station receipt](live-station-receipt.json) records source URLs and content addresses; `weather_weather_evidence` retrieves the archived packet.

The [isolated archival replay](archival-physical-results.json) scored 24 earlier NWS hourly forecasts across 24 stations against later actual observations. Each station has only one scored hour on one date. [Forecast/observation pairs](archival-physical-outcomes.jsonl) retain source addresses, timestamps, model means/scales and physical errors. This demonstrates the measurement path; it does not establish station skill, a correction benefit, or a market edge. Production calibration begins with fresh forward forecasts and does not import these retrospective scores.

[Engineering verification](scripts/verify-engineering.mjs) exercises actual NOAA bulletin fixtures, UTC rollover and daily coverage, unit conversion and deduplication, refusal to score future observations, idempotent retries, seven completed dates before a separate correction model, and exact reproduction of the historical rain pool. Run it with Node; [verification facts](verification.json) distinguish the fixtures from real observed outcomes. The configured NWS model, semantic journal and daily-cycle consumers remain intact. Original operation names still call that model; separate `kalshi-weather-research-cycle` and `kalshi-weather-research-score` names call the supplemental engine. Scoring incorporates the concurrent definitive-settlement checks, including issuance before the venue settlement clock and matching rules.

[Final runtime verification](live-runtime-receipt.json) confirms the weather federation alive, host readiness and active collector timer after a concurrent host release. [Final station verification](final-station-receipt.json) checks the deployed ninth tool, archival round-trip, fresh LAMP source and market-independent collection.

## Deployment continuity

Final verification found that a concurrent release omitted unreferenced standalone scripts and routed the original operation names into the supplemental engine. The timer now invokes the declared `@red-cup-engineering/kalshi-services-section/weather-engine` export from a retained weather runtime, eliminating the standalone script dependency. Its actual imported modules and required configuration are hard-linked into a separate weather revision; module resolution is verified entirely inside that revision. This also prevents host release garbage collection from deleting the producer, a failure observed at 05:06 UTC. A weather deployment advances the weather revision pointer. CLI and archival-replay entrypoints are also explicit package exports so normal closure packaging can discover them. Both original operations were restored; supplemental operations have distinct names. The installer preserves the concurrent research-ranking operation and stronger settlement checks instead of replacing those additions.

The [first production forward outcome](first-forward-station-outcome.json) is a LAMP Seattle forecast recorded at 03:53 UTC for 04:00 UTC on October 7, subsequently compared with a real station observation: 1.4F absolute error. The model is not locally corrected yet and has only one scored date; this observation cannot establish skill. Unlike the archival replay, this forecast was registered prospectively in production.

The [preserved-operation receipt](preserved-operations-receipt.json) records an invocation through the actual operation executor: 18 original-model forecasts, 18 semantic receipts and 18 questions discovered by the existing daily-cycle consumer. Both supplemental verbs and the concurrent research-ranking verb remained in the same operation catalog. The worker's separately pinned module resolved through the package's declared name.

## Daily boundaries, observed bounds and learning scale

LAMP daily-extreme v2 integrates the remaining partial hour through the climate-day boundary. A timestamped NWS reading within thirty minutes can anchor a fresh bulletin that begins next hour; otherwise the first point is explicitly backfilled as a constant. Piecewise interpolation includes the boundary temperature and all remaining interior points, and recorded earlier extrema remain part of the daily estimate. This removes the final-hour coverage gap. It is an hourly-trajectory approximation with experimental uncertainty, not a NOAA daily-extreme probability product.

Existing Student-t observation-bound engineering is recovered as separate `/observation-proxy-mixture-v1` forecasts. After three readings, the one-degree-loose observed maximum/minimum constrains 99% of the distribution; 1% retains the original distribution to allow source disagreement. The 1% weight is an uncalibrated experimental prior, not an empirical failure estimate. Original forecasts remain available; each new version needs its own future venue outcomes. Disjoint temperature brackets conserve total probability, including positive support outside the proxy bound.

Venue model grading now streams the immutable outcome journal. It retains only the earliest timestamp per contract/stage/rule/model, then accumulates event/date and probability-bin statistics. Full evidence payloads, sorting and per-model history copies no longer occupy the learning heap. A replay of all 2,298 chronological rain observations exactly preserves the previous Brier improvement and calibration bins. An invocation through `scoreWeather` also verifies out-of-order records, timestamp ties and repeated forecasts: 62 correlated ladder contracts contribute 31 effective dates. Journals remain available for independent replay.


[Retained runtime verification](retained-runtime-receipt.json) exercises live collection from the producer's own revision: 31 imported modules resolve inside it, the station collector registers 52 physical forecasts and retrieves 252 observations without reading Kalshi, and archived source provenance round-trips. The retained runtime consists of 43 code/configuration/manifest files (326,682 bytes); unrelated host assets are excluded. Hard links preserve these files after the original house revision is removed.


The final full cycle completed at 05:23:56 UTC on October 7 from the retained weather revision while the shared host moved to a newer release. It forecast 468 of 1,408 open contracts, recorded 312 separate observation-proxy mixtures, and reported no source or settlement-scoring errors. Production physical learning had 3,521 pending forecasts and 59 station/model/horizon metric groups. The worker exited successfully with a 151,457,792-byte memory peak, below its 384 MiB limit; its timer remained active. The public health endpoint reported ready with the weather federation alive. The newly published host still offered all nine native tools and preserved both original operation routes plus the supplemental and concurrent ranking routes. These are operating and coverage facts, not proof of improved predictive skill.
