# Relational weather metrology: empirical temperature experiment

The scientific question is whether relations between measured processes carry useful predictive information beyond a process's own history. The larger aim is to derive climate descriptions from empirical relational metrology using Obsmetrologia. This experiment realizes one finite numerical instance of that aim; it does not establish a new foundation for climatology.

## The actual foundations and their scope

Obsmetrologia's measured reading keeps a value together with the evidence from which it was read. `measure_measured`, `no_denial` and `measure_contradictory_negate` in the measured-reading carrier distinguish absence, contrary evidence and conflicting tellings. A weather temperature is a numeric measurement, not a FOUR reading or a probability. Its source report is retained independently of a fitted forecast and a claim about that forecast's skill. A duplicated source report supplies additional provenance without supplying an additional physical case; two incompatible values for the same station/report clock remain explicit conflicting witnesses and are withheld from fitting.

The relevant source is `ObsmetrologiaManual/BookII/MeasuredReading.lean` in the repository's Obsmetrologia library, with `Obsmetrologia.Language.Spine`, `Identification` and `Positing.Measure`. This JavaScript experiment is a numerical implementation informed by those carriers; it is not extracted Lean code and carries no Lean proof of its statistical conclusions.

The concurrent-game work supplies the distinction between events, causal access to them and strategies. Here an issued forecast can use reports observed no later than its issuance boundary; a day's fitted strategy can use only earlier truth labels. `ObsmetrologiaComputing/Calm.lean` supports the narrower distinction between accumulating evidence and coordinated selection. The archive is lossless and content-addressed; selecting the last admissible report and fitting a new predictor are explicit nonmonotone operations. We do not infer statistical independence or general strategic convergence from CALM.

A numerical cellular sheaf requires explicit maps between comparable measurement carriers. Here the numerical relations are directed differences between station temperature coordinates and temporal increments, rather than equality of temperatures at airports with different elevation, coastal exposure and instrumentation. This is an empirical directed relation model, not an implementation of every sheaf construction or an identification of numerical spectral energy with Obsmetrologia's order-valued closure. The repository's `CRDTCohomologicalCALM.lean` explicitly leaves the general cohomological equivalence open; no H1 claim follows from this experiment.

## Measurement and mathematical realization

[Iowa Environmental Mesonet's station archive](https://mesonet.agron.iastate.edu/request/download.phtml) supplies routine METAR near-surface air temperature in Fahrenheit, report clocks, latitude, longitude and elevation. The [source documentation](https://mesonet.agron.iastate.edu/ASOS/) describes the underlying observing network. IEM cautions that the processed archive receives limited quality control. It is an archive of sensor reports, not an independent second observing system alongside NWS, and its historical observation clocks do not establish historical publication/receipt clocks.

For this record, the bounded source window is July 1 through October 6, 2026 UTC. New York uses JFK, LGA, EWR and HPN; South Florida uses MIA, FLL and OPF. An initial request also included PBI, which supplied no rows; it is not silently imputed or counted as an observing site. The live tool names the exact available network. A request whose required stations lack reports reports that gap and no comparable cases.

Let T_s(t) denote the Celsius value of the last routine report for station s at or before UTC boundary t, no more than 20 minutes old. Missing reports are not interpolated, and incomplete histories are excluded. Thus this observable is a reporting-bin value; it is not an instantaneous exact-hour temperature.

The response is the next-bin increment:

    y_s(t) = T_s(t+1h) - T_s(t).

The target-only control uses its two most recent increments and sine/cosine of UTC hour. The relational predictor adds, for every peer j:

    T_j(t) - T_s(t),   T_j(t) - T_j(t-1h).

Each daily fit centers and scales features using only its training examples, then minimizes:

    sum_i (y_i - mean_training(y) - beta · standardized(x_i))²
        + 10 ||beta||².

The ridge parameter is fixed, without selection on the held-out window. Absolute predictions anchor the predicted increment on the target's actual report. UTC diurnal phase is a declared time reference, not a learned causal law. The last 60 days supply the fitting scope: its last 14 days are reserved for calibration, and all training and calibration response labels precede the held-out day's midnight. Persistence, target-only and relational predictors use identical held-out cases.

Each forecast's full predictive distribution is the empirical law of earlier signed calibration residuals shifted by its predicted increment. CRPS is exact for that finite distribution:

    CRPS(F, y) = mean_i |z_i-y| - 1/(2n²) sum_ij |z_i-z_j|.

This preserves distribution shape without assuming Gaussian errors. Its finite support cannot represent unobserved extremes. The 90% radii are empirical recent residual quantiles; serial dependence prevents an exchangeability guarantee.

This construction is equivariant under affine changes of temperature coordinates and independent constant changes of station reference: predictions transform with the reference, while appropriately transformed errors and scores agree. That is a numerical representation property, not a license to erase real spatial gradients, thermometer calibration or absolute energy balance. Physical temperature scales and long-term climate trends still require empirical calibration relations and stable reference measurements.

## Demonstrated effect

Chronological held-out issuance dates are August 31–October 6: 37 UTC dates per region. Sources contain 9,391 NYC reports and 7,048 accepted South Florida reports. Paired uncertainty resamples seven-day contiguous blocks of UTC issuance-day means, retaining simultaneous station dependence. Its approximate intervals assume representative day blocks and are exploratory, without multiple-comparison adjustment.

| Network | Held-out cases | Persistence MAE °C | Own-history MAE °C | Relational MAE °C | Own-history CRPS °C | Relational CRPS °C |
|---|---:|---:|---:|---:|---:|---:|
| New York | 3,453 | 0.6213 | 0.5365 | 0.4923 | 0.3885 | 0.3564 |
| South Florida | 2,651 | 0.6908 | 0.6921 | 0.6287 | 0.5161 | 0.4694 |

The exploratory 95% intervals for mean paired daily CRPS improvement over own history are 0.0284–0.0331°C for NYC and 0.0403–0.0562°C for South Florida. Relational 90% interval coverage is 90.15% and 91.89%, respectively. Station-level results and all fitted parameters are in `nyc-result.json` and `miami-result.json`.

The result supports the narrower empirical statement that these nearby-station relations contain useful next-report predictive information in these samples. It establishes neither superiority to NBM/LAMP at matched historical issuance nor live feed timeliness, daily-extreme probability calibration, climate-breakdown forecasting, causal transportability or profitable market trading. Two airport networks over one season cannot settle a climatological foundation.

## Finding and using the capability

Cold Red Gate exposes `weather_weather_relational_science` with `{"region":"nyc"}` or `{"region":"miami"}`. It fetches a bounded 98-day window ending at today's UTC midnight, executes this experiment, and returns an evidence ID and numerical results. `weather_weather_evidence` with that ID retrieves the lossless source text and report. The equivalent CLI is:

    node apps/weather.mjs relational-science --region nyc

This works without a Kalshi listing or order. Existing NWS/NBM/LAMP collection, forecasting and forward verification remain active. Archive experiments do not enter live station-skill counts, fit operational calibration state or grant trading admission. The source transform is exported separately as `@red-cup-engineering/forecasting/weather-relational-temperature` for other science and engineering consumers.

The source carrier, learner, exact distribution scorer and archive consumer are implemented. There is no extra framework, external data subscription or duplicate operational weather loop. Reproduce the frozen experiment and its unit/reference, causality, duplicate/conflict and archive checks with:

    node data/records/2026-10-07-relational-weather-metrology/scripts/verify-engineering.mjs

Fixtures are compressed source bytes with SHA-256 receipts; the script regenerates the scientific results. `engineering-receipt.json` records observed checks. `live-tool-receipt.json` and `deployment-receipt.json` record the deployed effect: both native source calls reproduced these results, the source/archive hashes matched, all ten prior weather tools remained available, and the public host returned HTTP 200. Hosted station replay skipped both scientific packets, created no calibration state, and produced no scores or forecasts.

The remaining scientific issue is identification: which measurement transports, constraints and latent process descriptions survive changes of site, instrument, temporal support, season and physical regime? Obsmetrologia can give that inquiry a language of evidence, contradiction and closure. The empirical content must still determine the admissible relations and test them against withheld measurements, including the cases where current models fail. Market settlement is one additional observable with its own source and aggregation operator.
