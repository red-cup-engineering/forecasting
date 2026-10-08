# Prospective relational weather forecasts — 2026-10-07

The prior relational and learner-generation studies supplied exploratory archive evidence. This implementation makes their hypotheses falsifiable on future observations using the existing station-science consumer, content-addressed evidence archive and scheduled weather collection. It supplements the existing weather forecasting and trading paths.

## Carrier and publication

The predicted value is the last uncontradicted routine METAR temperature within twenty minutes before the next UTC reporting-bin boundary, at JFK, LGA, EWR or HPN, or MIA, FLL or OPF. It is neither an exact-hour instantaneous temperature nor a venue settlement value. Site geometry, raw reports, absence and conflicting witnesses are retained.

Once per region and UTC day, a content-identified frozen training packet holds the original raw archive, actual retrieval clock, six hourly fitted learner specifications, a separately fitted irregular-report learner, and the selected generator's weights. Training labels precede the fourteen-day residual-calibration window; all calibration labels and selector-validation outcomes are strictly before the issuance day. The archive-based selector is exploratory research evidence available at issuance, not historical live skill. Atomic installation of the daily fit packet preserves its first receipt and prevents competing calls from silently replacing it.

Current routine reports come from a separate bounded three-day request. Their actual receipt time precedes publication. Each forecast carries the input witnesses, fit identity, observed-report clock, true issuance time and earliest possible target observation time. The hourly learners require three complete recent bins. The additional irregular-report learner uses the actual durations between three supported target reports and two peer reports within four hours, with temporal rates and duration features fitted through the same earlier train/calibration split. Missing hourly bins are preserved; they are not filled or treated as fresh reports. Missing required inputs or contradictory recent reports withhold the affected publications. The live archive lacked the 13:00 UTC report hour in both regions; this exposed the need for that distinct observation-clock model. Collection or fitting that misses the entirely future target-report window also withholds publication. The UTC bin reference can be later than the already-observed input report; it is not used as a fictional issuance clock.

## Predictive laws and measurements

Every generated learner publishes the complete empirical law of earlier signed residuals, in Fahrenheit, around its current predicted increment. The recursive selector publishes a weighted mixture of these laws. The existing temperature distribution consumer now evaluates empirical atoms directly, including cross-component CRPS; Student-t components retain their existing quadrature. A mean and spread are descriptive summaries, not a replacement distribution. Finite residual support still misses unseen extremes.

PIT for an observed atom uses its interval from F(y-) to F(y), with deterministic pseudorandom jitter derived from the forecast identity fixed before the outcome. This avoids making every tied observation appear at the upper edge of the atom. It is a reproducible diagnostic, not a proof of independent randomization, exchangeability or calibration. Central-interval coverage includes boundary atoms. These checks follow the distinction between calibration, sharpness and proper scoring in [Gneiting, Balabdaoui and Raftery](https://academic.oup.com/jrsssb/article/69/2/243/7109375).

The existing station-science path stores the first forecast per station, model, target and routine-bin cohort, and scores it once when the later target report is available. Routine-report metrics and comparisons remain distinct from NWS nearest-hour observations and canonical city-index observations. A contradictory target-bin report cannot be silently replaced by an older report. The original learner and the recursive selection are scored on the same target observation. Where fresh NBH, LAMP or NWS boundary guidance is collected concurrently, separate comparator forecasts disclose their up-to-twenty-minute temporal approximation and are frozen with the selector. Their error is observable rather than presumed equivalent to a routine-report prediction.

Routine-bin results cannot train existing NWS or venue calibration parameters. They do not create trade admission, map a forecast to a Kalshi contract or send orders. Prospective date-weighted comparisons measure physical predictive improvement; exact settlement projection and execution-aware alpha remain separate requirements.

## Actual consumers and engineering

`collectStationWeatherEvidence` automatically collects the relational network when a requested airport belongs to it, including the normal scheduled market-weather route when official city-index bindings request those airports. Failure is recorded as a source error and preserves the other weather evidence. Daily fitted learners are reused; later calls fetch only the bounded current reports.

`weather_weather_relational_nowcast` accepts `{"region":"nyc"}` or `{"region":"miami"}`. It shares the normal station-science lock and evidence archiver. The equivalent CLI is:

    node apps/weather.mjs relational-nowcast --region nyc

`weather_weather_station_skill` reads prospective metrics and pending counts. `weather_weather_evidence` reads the full archived source, frozen fits, input witnesses, published laws and outcome receipts by evidence ID. The selector's comparisons group the fixed learning procedure across dates, while preserving each forecast's actual learned weights. Changing weights does not fragment its evaluation into one-day cohorts.

The transform is exported as `@red-cup-engineering/forecasting/weather-relational-nowcast`.

The observed controlled check publishes thirty-four forecasts: twenty-eight hourly-family relational forecasts, four irregular-clock forecasts, one NBH comparator and its original station forecast. Thirty-three routine-bin forecasts score at the later reporting boundary; the original nearest-hour NBH forecast waits for its own verification time. Repeated calls publish or score none of those records again. All scores are finite, and paired original-learner and NBH comparisons are recorded. No routine result enters venue or existing station postprocessing. Exact atom/mixture scoring, affine transformations, fit equality at the same historical cutoff, missing and contradictory peer refusals, and expired-window refusal also pass.

Reproduce this effect through the actual consumer with:

    node data/records/2026-10-07-prospective-relational-weather/scripts/verify-engineering.mjs

`engineering-receipt.json` records those controlled checks. Deployment and hosted receipts distinguish installation and actual prospective publications from measured future skill and public web availability. No claim of prospective gain is justified merely by successfully publishing the first forecasts.

## Hosted prospective publication observed

At 16:36 UTC the hosted native consumer published four NYC and three South Florida irregular-clock forecasts for the 17:00 UTC reporting boundary. Every publication preceded 16:40 UTC, the earliest report allowed by the target measurement window. The hourly family remained withheld because the source omitted the 13:00 UTC report hour. The forecast laws, raw archives, actual receipt clocks, fitted learners and input witnesses are recoverable from the recorded evidence IDs.

A second call in each region reused the same frozen training identity, made one bounded current-report request and published zero duplicates. An independent read of the actual station-science state at 16:40 UTC found all seven pending routine-bin forecasts with their original publication clocks and no trade eligibility. Their outcomes were still in the future at that read; no prospective skill gain is claimed.

The deployment retained all twelve prior native tools and added `weather_relational_nowcast`. The independent weather runtime retains fifty required files and the normal scheduled source collector consumes the new transformation. This installation did not restart the shared house. Its public endpoint timed out during the final check, while its process was running; the successful backend calls do not establish public web availability. `live-tool-receipt.json` and `deployment-receipt.json` retain these separate observations.

## First prospective outcomes

At 17:09 UTC the existing scorer graded all seven initial irregular-clock forecasts against routine reports observed at 16:51–16:56 UTC, after their 16:36 publications and inside the target measurement window. NYC mean absolute error was 0.3351F and mean CRPS 0.2858F; South Florida mean absolute error was 1.0451F and mean CRPS 0.6618F. This is a single target hour. No simultaneously issued guidance comparator existed for these irregular forecasts, so it does not establish superiority over a baseline, independent calibration or executable alpha. [The outcome receipt](first-outcomes.json) identifies the immutable enriched archives that retain the full forecast laws and observation witnesses. At that collection, the restored hourly input support also permitted 49 new six-learner/selector forecasts for the next reporting boundary.
