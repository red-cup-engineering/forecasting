# Hourly weather prediction additions — October 7, 2026

Supplemental city-index forecasting and NOAA NBH strengthen the existing daily forecast and broader independent station-science capability. Existing configured forecasts, operations, journal consumers and concurrent Kalshi desk work remain available.

## Research and source bindings

The [official city-index endpoint](https://docs.kalshi.com/api-reference/live-data/get-weather-index) publishes minute event times and detailed receipt audits; the [calibration endpoint](https://docs.kalshi.com/api-reference/live-data/get-weather-index-calibrations) provides effective and publication times, station weights and Celsius offsets. Exact active contracts bind [Miami](https://assets.kalshi.com/contract_terms/MIAWINDEX.pdf), [NYC](https://assets.kalshi.com/contract_terms/NYCWINDEX.pdf), [coastal LA](https://assets.kalshi.com/contract_terms/LAWINDEX.pdf), and [Chicago metro](https://assets.kalshi.com/contract_terms/CHIMETROWINDEX.pdf). Chicago requires v1.1 while its public configuration currently supplies v1.0; both witnesses are preserved in a conflicted SignCell and dependent forecasts are blocked.

[NOAA text-card documentation](https://vlab.noaa.gov/web/mdl/nbm-textcard-v4.1) describes the hourly NBH product, TMP and TSD. [NOAA's v5 changes](https://vlab.noaa.gov/documents/6609493/49238491/NBM_v5.0_NOMADS_Changes_Text.pdf) and the archived actual v5 bulletin blocks ground this implementation. NBH contributes 25 hourly temperature/spread points rather than interpolating three-hour NBS alone. The runtime selects requested station blocks before splitting a roughly 28 MB bulletin, and successive subset requests preserve earlier cached stations.

A [September 2026 preprint](https://arxiv.org/abs/2609.23969), read at abstract level, reports markets outperforming a single NBM forecast across its sample. This agrees with the ecosystem's existing chronological temperature/rain comparisons: adding a public weather source is not evidence of an executable advantage. These additions are separate prospective experiments.

## Implemented effects

The collector binds exact current hourly contract rules and 0.01F thresholds. City predictions combine all configured station forecasts using the published offsets and weights. A common Student-t shock retains station uncertainty without an unjustified independence reduction. A separate recent-reading innovation experiment retains spread and labels its uncalibrated three-hour decay. Raw NWS, LAMP, NBS and new NBH models remain distinguishable.

Forward physical outcomes use canonical normal/degraded city minutes with verified receipt deadlines, quorum and available configuration; late, backfilled, pending and incomplete readings cannot become truth. Verification selects the latest eligible minute at or before the target within sixty minutes. Immutable forecast evidence and independent physical CRPS/MAE/RMSE/coverage stay separate from binary venue settlement.

On Cold Red Gate, `weather_weather_index_evidence` takes `{"cities":["miami"]}`. `weather_weather_station_skill` takes `{"station":"index:miami"}`; existing station tools continue to work without any market reads. The native catalog now has ten weather tools.

## Verification

`node scripts/verify-index-engineering.mjs` reproduces 345 archived published readings, including two degraded minutes, and checks receipt availability, future calibration exclusion, hundredth-degree probability mass, no hindsight anchors, correlated spread, pre-target outcome selection and retry idempotence. `node scripts/verify-nbh-engineering.mjs` checks three actual station blocks, midnight rollover, missing sentinels and cache preservation. Existing prediction-engineering checks also pass. Frozen fixtures and their retrieval metadata accompany these checks. Synthetic scoring fixtures are isolated from production outcomes.

The hosted native-tool receipt records ten tools, fresh 25-hour NBH guidance for five Miami stations, 166 future city-index forecasts across seven distinct variants, zero market-price reads and no source errors. The Chicago read records both conflicting witnesses and no dependent forecasts. The archived deployment receipt retains 45 actual dependency files totaling 350,035 bytes, independent of future host-release cleanup. The frozen 40-contract snapshot binds all hourly contracts, with 30 compatible configurations and ten Chicago contracts blocked. No long-run accuracy improvement, portfolio return or profitable edge is established by these checks. No orders are placed by this capability.

The complete hosted cycle succeeded: 318 of 1,241 live contracts modelled, including 30 hourly contracts across Miami, NYC and coastal LA; all six LAMP/NBH/NWS raw and recent-innovation variants covered those contracts. Source and settlement errors were empty, the timer remained active, and peak service memory was 215,670,784 bytes (about 206 MiB). Physical verification retained 8,820 pending forecasts and 258 metric groups; these counts are operational observations, not independent completed dates or evidence of an established edge. `live-runtime-receipt.json` records the exact model coverage and service state.
