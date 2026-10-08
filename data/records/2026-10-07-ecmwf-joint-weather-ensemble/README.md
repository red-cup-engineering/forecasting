# Operational AI ensembles as relational weather scenarios

The carrier is a family of indexed GRIB2 fields, verified NWS station geometry and prospective physical outcomes. The transformation retains each ECMWF member across sites and forecast times, projects its 2m air temperature bilinearly onto the station, and publishes the resulting empirical marginal law through the existing station-science consumer. Existing NOAA, relational and Kalshi forecasting/admission capabilities remain in use. There is no additional scorer, market registry or trading worker.

## Scientific source and scope

[ECMWF's AIFS data description](https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data) documents operational AIFS ENS v2, introduced 12 May 2026, four cycles per day, six-hour output, and a public regular 0.25-degree grid. The [official ecCodes SDK](https://github.com/ecmwf/eccodes-python) supplies the binary decoder. Attribution is ECMWF, under CC-BY-4.0 and ECMWF Terms of Use. Our live public S3 index and decoded messages independently establish the actual field parameter, units, level, ensemble identities and availability used here.

For site s, member m and available six-hour target t, the forecast is the bilinear projection T(s,m,t) of the four bracketing grid corners. The Fahrenheit marginal is the uniform empirical law over m=0..50. The full member/site/time array remains available: the marginal distribution does not discard or replace the original joint scenarios. The control and fifty perturbed members receive equal experimental weights; neither independence nor local calibration is assumed. Missing members, malformed ranges, field/index metadata disagreement and late receipt prevent publication.

No temporal interpolation fills the six-hour gaps. A grid air-temperature projection is an experimental proxy for a station sensor. Coastal land/sea mixing, elevation, sensor representativeness and model regime error remain open calibration problems. A few future grid samples do not determine a daily maximum or minimum, and these publications do not qualify venue trading.

## Implemented path

`weather_ecmwf_evidence` accepts `{stations:[{station:"KJFK",timeZone:"America/New_York"}],validCount:2}`. The federated name is `weather_weather_ecmwf_evidence`. The CLI is `node apps/weather.mjs ecmwf-evidence --stations stations.json --valid-count 2`. The input supports 1..16 stations and 1..4 future six-hour slots.

The normal station collector also adds the available family when the decoder is installed, using the NWS station metadata it already retrieved. It requests one next six-hour slot for all verified requested stations, and its immutable field cache is shared with the explicit source tool. Reusing a deterministic projection is keyed by raw field hash, geometry, expected forecast identity, operator and ecCodes version. Field hashes and first receipt times never move during reuse.

`weather_evidence` retrieves lossless index text and full scenarios. With `rawFieldSha256` it returns one matching archived GRIB2 field as base64 after checking its hash. A field must belong to the supplied evidence ID. Raw fields remain in `weather/ecmwf/raw/<sha256>` on Cold Red Gate. New downloads require a 512 MiB operating reserve; cached-field reuse requires 128 MiB. Capacity refusal is a source error, preserving the other forecasting families.

The existing family pool now preserves empirical atoms, uses their actual variance and scores the full mixed law, including between-family disagreement and cross-component CRPS terms. A pool that includes AIFS uses a distinct `station-family-pool-with-aifs-v2` identity. The original pool identity and calibrations stay separate. Station scoring uses seeded randomized PIT for empirical atoms and labels correlated hours/members appropriately.

## Observed operation

At 17:17:12 UTC, Cold Red Gate published fourteen prospective physical forecasts: JFK, LGA, EWR, HPN, MIA, FLL and OPF at 18:00 UTC October 7 and 00:00 UTC October 8. The source was the actually available 06:00 UTC cycle; the 12:00 cycle's index returned 404. All 102 required fields, four index responses, 51 member identities, station metadata, grid corners and actual receipt clocks were retained. The fields totaled 63,912,333 bytes. An existing evidence-tool retrieval reproduced a raw GRIB2 message and its SHA-256. The repeated call reused all field receipts and published zero duplicates. These are future targets, not scored skill or profit. The live receipt preserves the precise evidence IDs and forecasts.

The native tool catalog grew from thirteen to fourteen tools, and the isolated retained weather runtime includes the Python decoder source. The installed external binary dependency is pinned by `requirements-weather-eccodes.txt` and retained separately as the private ecCodes 2.49.0 environment at `~/.local/share/561-group/weather-research/eccodes`. The shared house was not restarted. Public health returned 200, but an unauthenticated public MCP catalog request returned `invalid_token`; native success does not prove authenticated public catalog reload.

The controlled consumer experiment publishes an AIFS law, an existing NWS law, and their full mixed pool before a synthetic target, then grades them on the same physical observation through `updateStationScience`. It verifies member completeness, future-receipt refusal, exact empirical variance, affine CRPS scaling, preserved atoms, paired scoring and idempotent outcome grading. Projection checks verify affine reproduction, date-line wrapping and grid boundaries against a real decoded field. Synthetic scoring results are engineering checks, not prospective scientific skill.

## Connection to adaptive strategy research

Public operational AI weather data should be treated as information adaptive rivals can also obtain. This source supplies shared member scenarios for the ecosystem's generator/selector and concurrent-game experiments; it does not assume private information merely because our system processes them. The next empirical question is whether local observations, regime-aware correction and alternative generated models add calibrated predictive information beyond this public family, after computation latency and executable market costs. Any rival pricing or market-feedback claims require actual market receipts and executable quotes, separate from physical scores. No new claim about Nash equilibria, sheaf cohomology, coordination-free trading or AI-generated source-code improvement follows from adding the ensemble.

## Existing collector demonstrated

At 17:25:39 UTC the unchanged station-evidence entry point for JFK retained all six families (NWS, NBM, NBH, LAMP, relational and AIFS), returned no source errors, and published one new mixed-law pool for 18:00 UTC. That pool contained AIFS, LAMP and NBM family components and preserved all 51 AIFS atoms. The call took 9.3 seconds. Original field receipt times were retained separately from the newly assembled projection's availability. This is the actual consumer path used by ordinary weather cycles, not only an isolated source demonstration. [The consumer receipt](station-consumer-receipt.json) records its archive identity.
