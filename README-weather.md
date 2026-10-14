# Weather research and Kalshi on Cold Red Gate

The existing fast index publisher keeps a qualified pre-measurement forecast during
the measurement-to-close window, at most five minutes, when the current exact rules,
certified law and calibration still match and no contract blocker is present.
It retains the original model probabilities, issue/availability clocks and source
archive references; the original forecast surface must remain within twenty minutes.
Current source-scoped grades requalify the same models, expired model declarations
drop, and the original market anchor expires on its own twenty-minute clock.
New qualified predictions or truth replace old rows. Changed rules/calibration,
blocked sources and closed markets cannot retain them. Republishing does not renew
the original forecast clock, and pending index observations do not become truth.

The existing `kalshi-weather-forecast` / `kalshi-weather-score` operations and `forecast-weather-markets-cli.mjs run|score|calibration` keep their configured NWS model, semantic journal, calibration and paper-sizing behavior. The general forecasting daily cycle continues to consume those records.

The supplemental research and market collector: `node apps/weather.mjs cycle`, or the authenticated Cold Red Gate `weather_weather_cycle` tool. `weather_weather_status` shows coverage, gaps, scored model skill and available opportunities. `weather_weather_forecast` reads a specific contract. `weather_weather_model_admit` contributes a model experiment. `weather_weather_allocate` creates a depth-limited capital plan. These tools do not place orders; execution remains the custody-bound Kalshi desk.

The collector discovers every Climate and Weather series from Kalshi, paginates its open markets, binds the actual contract rules, collects one NBM run for all required stations, NOAA LAMP v2.7 short-range station guidance through 38 hours, NWS hourly trajectories, timestamped observations and active hazards, reads the domestic and international official-report endpoints used by weather.com/kalshi, and archives the evidence compressed in machine state. Official, revised, preliminary and missing statuses remain separate; only definitive binary venue settlement with its actual settlement timestamp scores a market; forecasts issued after settlement or under changed rules are excluded. Daily high/low and daily rain models are recovered from the existing fitted implementations. A competing NBM v5 QMD model reads the published 10/25/50/75/90th percentile station temperatures from NBP, preserves asymmetry, and labels its outer-tail extrapolation explicitly. NBM v5 includes AIFS/AIGFS inputs; no separate global AI inference is claimed. Rain P06 is now retained by the NBS parser. The configured NWS forecasting route remains available alongside these additional models. Its journal and calibration history continue through their existing consumers; the supplementary collector keeps its own source archive and model comparisons.

`KALSHI_WEATHER_STATE_DIR` selects persistent state; default `~/.local/state/561-group/settlements/kalshi-services-section/weather`. The timer invokes the declared weather-engine export from a separately pinned deployed weather revision, so unrelated host release changes cannot silently replace the producer or drop its CLI path. The CLI and replay entrypoints are explicit package exports. Original operation names continue to call their configured forecasting functions; `kalshi-weather-research-cycle` and `kalshi-weather-research-score` are separate supplemental operations. The timer starts another cycle ten minutes after the previous one finishes. A web-triggered cycle returns immediately; status reports its running state and latest result. `latest.json` contains exact live rules and source bindings, probabilities per model, SignCell witnesses for and against, research gaps ranked by current traded volume, and qualified opportunities. Evidence objects are addressed by SHA-256 and compressed; `pending.json` holds first forecasts per contract/horizon/model-set, and immutable score files recover scoring after interruption. Kalshi's settlement, including an early rain settlement, determines the outcome. Missing or non-binary results are left unresolved.

Weather observations are not settlement truth. The live contracts inspected on October 6 name The Weather Company for daily extremes and rain, and Synoptic for hourly directionals. NWS is a forecast/observation source; proxy observations never force TWC probabilities to zero. A climate day's standard-time boundary is used for station estimates, with source/window uncertainty remaining in validation. Rules hashes accompany model experiments and opportunities. Skill groups preserve the full measurement and revision rules while normalizing dates and ladder strikes; a source or methodology change resets eligibility. Contract changes are visible and external contract forecasts must match exact current rules.

## Adaptive reasoning cadence (2026-10-12)

The supplemental weather collector now exposes a read-only IANA-zone phase plan and
an optional cadence-gated entrypoint. The scientific heuristic proposed for
daily temperature extremes is **hourly at each station's local HH:00**, switching
to **every five minutes between 14:30 and 17:30 local civil time, inclusive**.
The peak window is a research-attention policy, not an assertion that the
maximum has occurred or that extremes cannot happen overnight. In contrast,
the actual station climate-report day may be defined using **local standard
time**; that remains governed by each contract's source rules and is never
replaced by the scheduling clock. Arizona and daylight saving changes use
IANA time zones, never fixed US UTC offsets.

The policy is in the existing forecasting package:
[weather-reasoning-cadence.mjs](src/weather-reasoning-cadence.mjs).
Its zone list is derived from the established temperature-market series
registry and additional live contract bindings. A market in an unusual zone
widens this list automatically. No second list of cities, weather models,
probabilities, source truths or autonomous schedulers has been invented.

From the already-pinned weather runtime and its state root:

    node apps/weather.mjs cadence-plan
    node apps/weather.mjs cadence-cycle

Pass `--state DIR` to either command when working against a non-default weather state root.
The plan is read-only: current due local zones, the UTC five-minute slot,
next slots and policy. The gated cycle invokes the exact same existing
runWeatherCycle, weather-cycle lock, evidence archive, source collection,
forecast surface and settlement grading. It does **not** place orders.
One completed acquisition started during a slot satisfies that slot; a
cycle that merely *finished* after the slot began does not, because its
weather sources could have been collected before the slot opened.
Missing source-start timestamps do not certify that a slot was covered.
If a run is already in progress the existing single-flight lock suppresses
overlap, and missed slots are not backfilled as independent forecasts.

**Deployment receiver requirement.** The previously documented host timer
starts full cycles ten minutes after the previous completion. That existing
timer does *not* execute this new five-minute behavior just because the code
is committed. For actual operation, update the **existing** host trigger to
invoke cadence-cycle on one UTC five-minute wall-clock grid (e.g. one
systemd OnCalendar every five minutes), replacing rather than multiplying
the prior ten-minute trigger. Verify the running installed release exposes
the new CLI before changing the trigger; do not add a parallel weather
timer or schedule ChatGPT tasks at unsupported five-minute frequency.
Observe duplicate suppression, completion time, provider rate limits and
the source-availability stamps before declaring five-minute production
receiving. Keep the ordinary cycle entrypoint unchanged as rollback.

The current single-flight collector is **whole-venue**: the due-time-zone
list decides *whether* to run the global collector, not which stations it
fetches inside a successful run. Thus a five-minute NYC peak tick may also
revisit Chicago's markets. This is intentionally conservative for
downstream correctness; physical per-zone selective acquisition and
conditional incremental modeling are separate future optimizations.
Five-minute reasoning does not imply five-minute upstream weather reports:
duplicate observations carry their actual receipt times, and a repeated
look at one city-day does not create an independent validation case.

## Station science without a market

`weather_weather_station_evidence` accepts station ICAO codes, IANA time zones and optional target dates. It collects the same raw model guidance, probabilistic quantiles, hourly forecasts, observations and climate reports used by the market collector, without requiring a Kalshi listing. NOAA LAMP preserves temperature, dewpoint, wind, and the separate hourly occurrence, measurable-hour and measurable-six-hour precipitation probabilities; occurrence is never substituted for measurable daily rain. It archives the evidence with source provenance and returns its content address. It leaves the market census, prediction journal and capital allocation unchanged.

For example: `{"stations":[{"station":"KSEA","timeZone":"America/Los_Angeles"}]}`. Without dates it uses the current local standard-time climate day. The library export `@red-cup-engineering/forecasting/weather-evidence` exposes `collectStationWeatherEvidence`; `@red-cup-engineering/forecasting/weather-quantiles` exposes the bulletin parser and quantile CDF for other forecasting and scientific consumers. Current station products support weather research; they do not constitute a long-range climate simulation or climate validation.

`weather_weather_station_skill` reports physical temperature bias, MAE, RMSE, approximate CRPS and 90% interval coverage by station, model and lead-time cohort. NWS hourly, NBM hourly and LAMP hourly forecasts are recorded before the target hour; scoring uses the nearest timestamped NWS observation within fifteen minutes and waits until fifteen minutes after the target. Observations are paginated, units checked, duplicates removed, and timestamp/QC provenance preserved. Today's observations are collected even if the market only lists tomorrow. Retries do not add extra samples. Missing observations expire visibly after seventy-two hours.

LAMP daily-extreme v2 retains the final partial hour of the climate day, joining a recent timestamped observation to fresh guidance when necessary. Separate observation-proxy mixture experiments recover the existing one-degree-loose observed bounds while keeping a 1% unconditioned component for source disagreement. That weight is an uncalibrated prior; original forecasts remain available for future comparison. Historical venue learning streams earliest forecasts into event/date statistics without retaining full history objects, sorting them, or copying evidence for each model. The immutable journal remains independently replayable.

The local residual postprocessor learns date-weighted bias with ten prior days of shrinkage and widens underdispersed uncertainty. It starts a separate experimental model only after seven distinct observed dates; original model outputs remain alongside it. This is regularized residual postprocessing, not a fitted EMOS system. Hourly-to-daily extrema and default 2.5F Student-t scales remain explicit experiments. Physical scores against NWS observations never qualify TWC or Synoptic market predictions. Production science state stores ninety days of daily statistics; immutable evidence keeps the actual forecasts and observed outcomes.

For reproducible archival science, `node apps/replay-station-weather-science.mjs --archives EVIDENCE_DIRECTORY --universe LATEST_JSON --output NEW_REPLAY_DIRECTORY` replays recorded packets in filesystem-write order and refuses an existing output directory. It conservatively treats file write time as availability, skips enriched duplicate packets and preserves source addresses. This isolated retrospective experiment does not seed live calibration or trading eligibility.

The [chronological rain check](data/records/2026-10-06-weather-prediction-improvements/README.md) excludes the reverse-time fold of the earlier rain study. Day-before equal-log-odds pooling has lower point-estimate Brier scores, but its date-bootstrap intervals include no gain; same-day pooling was worse on the chronological subset and is not added. The collector records the day-before pool as a competing version for forward validation. Temperature pooling remains excluded because the existing temperature study found no gain.

Kalshi provides one source of external pressure and realized outcomes within broader climate science and engineering. Scientific source records can serve other research and engineering work independently of trading eligibility.

## Scientific experiments

Submit a model/version, HTTPS source provenance, current issue and expiry, and either probabilities for exact contract/rulesHash pairs or daily station high/low ensemble samples in Fahrenheit. The same inlet accepts HRRR/RRFS downscaling, ECMWF IFS/AIFS, GenCast, radar-driven rain nowcasts, local surface-energy models, storm-track simulations and agent-developed models. Their outputs compete against market probabilities under the same future settlement scoring. Correlated ensemble members are forecast samples, never independent validation trials. This inlet is implemented; the named large simulation producers are not deployed by this change.

Example station experiment:

```json
{"model":"station-surrogate","version":"v1","sourceUrl":"https://example.org/experiment/v1","issuedAt":"CURRENT_UTC_TIMESTAMP","validUntil":"FUTURE_UTC_TIMESTAMP","ensembles":[{"station":"KNYC","targetDate":"CURRENT_MARKET_DATE","kind":"high","unit":"F","samples":[65,66,66,67,67,68,68,69,69,70]}]}
```

A forecaster can retrieve exact contracts with `weather_weather_forecast` and submit contract probabilities for other weather families without inventing a station binding. Unimplemented source transformations remain explicit gaps. A submitted forecast is an experiment, not a grant of execution authority.

## Skill and capital

One independent validation unit is a station event and forecast horizon on a distinct target date. Repeated looks and ladder rungs do not manufacture independent days. Model versions are evaluated at five close-time horizons. Admission needs thirty target dates, positive date-clustered lower-bound improvement in Brier score against the recorded market midpoint, and thirty days in the relevant probability bin. The bin's conservative Wilson bounds and disagreement between qualified models bound the proposed win probability. This is a screening method, not a promise of consistent profit or a full correction for adaptive model selection.

An allocation request refreshes live markets and executable book depth using qualified forecasts from an evidence cycle no older than fifteen minutes. Expired experiments, changed rules, closed contracts and changed forecast horizons are excluded. The planner reads fresh executable book depth and the series' quadratic fee multiplier, gives quotes a sixty-second lifetime, consumes available cash once, applies fractional Kelly to conservative probabilities, and caps each event and date. With no capital argument the web allocator reads primary-account cash and resting-order commitments in the exchange shard named by the live weather contracts. It conservatively deducts gross commitments and does not move cash between shards. Explicit capital and encumbered amounts support scenario plans. The actual execution desk must reread its account and the venue quote before acting. Liquidity and forecast skill can limit coverage even when capital is plentiful.

Cold Red Gate coordinates collection and small station models; its memory does not fit training global models. Public operational model output is the immediate substrate. Larger compute contributes versioned output through the same inlet. NOAA's HRRR/RRFS are short-range convection-resolving models; ECMWF AIFS and GenCast supply longer-range ensembles, whose temporal/spatial resolution needs station-specific downscaling before daily extrema or hourly prices can be trusted.

Sources: [Kalshi public API](https://docs.kalshi.com/getting_started/quick_start_market_data), [NWS API](https://www.weather.gov/documentation/services-web-api), [NOAA LAMP v2.7](https://vlab.noaa.gov/web/mdl/lamp-card-2.7.0), [HRRR](https://rapidrefresh.noaa.gov/hrrr/), [RRFS](https://gsl.noaa.gov/rrfs/), [ECMWF AIFS data](https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data), [GenCast paper](https://arxiv.org/abs/2312.15796). Actual contract rules govern over general Help Center summaries.

## Hourly city indices

`weather_weather_index_evidence` accepts `cities` from `miami`, `nyc`, `la-coastal`, and `chicago`. It reads the public minute audit and append-only calibration configuration, archives both, forecasts the weighted city temperature from constituent airport guidance, and scores future physical index readings separately from binary market settlements. `weather_weather_station_skill` accepts `index:miami` and the other city labels. This does not require reading market quotes or placing orders.

NOAA NBH supplies 25 hourly TMP/TSD points alongside the existing three-hour NBS, LAMP and NWS products. TSD is converted from standard deviation to Student-t scale. Index uncertainty uses a common station shock without independence-based narrowing; sensor proxies and the optional recent-reading innovation with uncalibrated three-hour decay remain explicit experiments. Contract probabilities preserve 0.01F rounding rather than daily integer rounding. Verification uses the latest eligible canonical index minute at/before the target, within 60 minutes, and checks local receipt deadlines, quorum and the configuration available at forecast time. Backfilled and late readings remain evidence but cannot become canonical truth.

Certified index methodology and operational configuration identifiers are distinct.
All four original documents authorize prospective offset refreshes as new published
configuration records under Section 6; Section 9 calls those updates operation,
not amendments. The certified PDF's roster, base weights, quorum, 300-second
receipt deadline and precision bind the index. A selected original city API
configuration must retain that roster and those weights, contain finite offsets
and their weighted city reference, and be published no later than its effective
time and available before use. Its actual identifier and vector remain in the
source law and calibration cohort; identifier prefixes do not establish a conflict.
Chicago's retained seven-record history begins with the certified initial vector
and preserves its roster and weights through the prospective weekly updates,
although its operational identifiers retain v1.0 and the PDF initial identifier
is v1.1. Those identifiers are preserved without relabeling. Roster, base-weight
or other fixed-parameter changes require certified amendment authority. Original
source fixtures remain under `data/records/2026-10-07-joint-weather-index`.

## Supplemental family ensembles and calibration diagnostics

The retained paired physical-score learner also emits `paired-family-fixed-share-v2`: it sequentially updates weights once per complete matched target date, then mixes toward uniform weights with a fixed share, using only already-available CRPS comparisons. This matches the [Lenticule Climate Science 2026-10-14 source-bound hourly study](https://github.com/lenticule-science/climate-science-services-section/blob/main/content/text/documents/articles/2026-10-14-source-bound-hourly-temperature-forecast-science.md). It is a distinct forward experiment; no assertion of calibration, trading eligibility or profit follows from a stable weight calculation.\n\nStation and city evidence now include `station-family-pool-v1` and `kalshi-index-family-pool-v1` experiments. They preserve the full LAMP/NWS/NBM distribution mixture; NBH takes the NBM weight in preference to NBS when available. City probabilities use the mixture CDF, and physical CRPS includes its cross-component distances. Daily high/low research records also include `weather-family-pool-high-v1` / `weather-family-pool-low-v1`, combining probabilities for the same bracket and preserving published quantile asymmetry. Every constituent model remains available. Pool weights are equal, untrained and make no independence claim.

`weather_weather_station_skill` includes PIT histograms and date-weighted paired CRPS comparisons against the constituent forecasts frozen at the same issuance. Confidence intervals require thirty dates; physical comparisons do not admit market models or place orders. Historical aggregates without diagnostics do not acquire invented PIT counts. Model disagreement can broaden a forecast; a linear pool is not automatically calibrated. See `data/records/2026-10-07-weather-ensemble-calibration` for research, verification and hosted receipts.

## Hourly guidance to daily extrema

Station evidence now exposes `dailyExtremes.forecasts` and `dailyExtremes.gaps`, compiled at local availability after the raw source archive is written. `nbm-nbh-comonotone-high-v1` and `nbm-nbh-comonotone-low-v1` preserve every remaining NBH hourly temperature and spread. Their daily CDF is the exact maximum/minimum pushforward under one common Student-t rank shock on a piecewise-linear path. This is an experimental proxy, not recovered raw ensemble dependence. Conditional Fréchet/union bounds allow arbitrary dependence among the declared hourly marginals; these bounds widen the actual candidate probability band and never bypass empirical admission.

The climate day uses local standard time. Missing hourly temperature/spread or uncovered final boundary produces an explicit gap. A first future hour may be held back at most one hour, explicitly labelled. Current-day forecasts require at least three contemporaneous observations; loose proxy floor/ceiling witnesses use an untrained 1% source-disagreement mixture and never force TWC outcomes to zero. Instantaneous hourly samples do not resolve subhour extremes or source/station discrepancies. Tomorrow often exceeds NBH's 25-hour horizon. Existing quantile, daily, LAMP and family-pool models remain available; these new competitors have no independent daily physical grade or demonstrated market edge. See `data/records/2026-10-07-hourly-to-daily-extremes`.

## Relational metrology experiment

`weather_weather_relational_science` accepts `{"region":"nyc"}` or `{"region":"miami"}`. The equivalent command is `node apps/weather.mjs relational-science --region nyc`. It obtains a bounded 98-day IEM routine-METAR archive and tests next-report temperature increments using temporal and inter-station relations against persistence and a target-only control. All models fit and calibrate on earlier labels, and comparisons use identical cases. Raw reports, geometry, retrieval clocks and source hashes remain recoverable through `weather_weather_evidence`; contradictory reports remain explicit. This research does not register archive replays as forward forecast skill or trading admission.

The [empirical science record](data/records/2026-10-07-relational-weather-metrology/README.md) gives the mathematical scope, measurements, reproducible results and limitations. This supplements operational NWS/NBM/LAMP forecasting and supports research without requiring any Kalshi market.

## Frozen participation and conditional cash scenarios

`weatherParticipation` and `node apps/weather.mjs participation --capital USD` preserve the October 7 participation capability at the current common software owner. Capture freezes the complete existing weather probabilities, exact rule hashes, freshly received metadata, executable books, legal price ticks, event fee overrides and each response clock. Take, rest and wait alternatives remain scenarios. Explicit cash is consumed once only when a joint proposal is verified; independent alternatives do not reserve an account balance. The existing 2,000-contract selection envelope bounds automatic selection and listing discovery, and incomplete coverage is recorded. A `snapshotId` reviews at most three pages of public nonblock trades per exact ticker or verifies explicit proposed actions. Optional `carryPolicy` supplies conditional win and usable-cash-time intervals, priority cash, a holding hurdle and a worst-loss budget. It remains a greedy, unvalidated proposal, with no order effect, forecast admission or authority grant.

The current fee provider owns four-decimal fee accumulation and rounding. Participation reserves against hundredth execution fragments using that provider; the reserve is not the fee actually charged. The existing graded gaming book walk owns depth and slippage. The mandate allocation provider owns joint win/fill Fréchet bounds and their conditional probability projection; no independent weather fill model is fitted or inferred. Public counterparties' purchase-equivalent gross exposure, hypothetical queue replay, actual member net profit and our own fill law remain distinct. Inconsistent trade directions/prices, identities, cursor scope and venue final labels are retained or refused, never silently made complete.

Snapshots, reviews, proposals and carry packets use the existing `evidence/<sha256-of-original-JSON>.json.gz` archive. `weatherParticipationEvidencePage` reads those original bytes, verifies their hash and returns the existing bounded weather page envelope with a source revision, collection count and next offset. The complete library reader and archive remain available. Native Group operations use the common installed package, with row/field selection for large records; they no longer load a mutable retained weather runtime.

Source custody: the recovered carriers are committed under `data/records/2026-10-07-weather-source-admission` by `63fc06a178da69a7e35d6fc1ad729ec25ca4716a`. Original participation SHA-256 is `d3f03dec50075a9a95e6cea1b81c4006f49740c5c44bf2dc89b3e5eefe64bef1`; original capital carrier is `8b621b86026d6497aa2008c0afb0c233b9736a30ecbfb4bd7c09c96f0f6f9430`. Their captured promotion receipt explicitly has `liveAdmission:false`. Historical duplicated fee and Fréchet implementations are replaced by the current owners. This source reconciliation does not certify production receipt or profitable participation. Receiving requires the fabricated shared release, native source-pinned pages and bounded fresh capture/review observations; old captures can be reviewed but cannot pass fresh proposal expiry checks.


2026-10-13 source receiving: the shared climateDate export is restored from the original climate-day change (ffb2055), preserving the later bounded METAR source. The existing weather loop now receives the retained 2026-10-07 same-day precipitation design at src/weather-precipitation.mjs, from the source-admission rescue body (a71b1e317a7b46aa903b7ab02a5ad7a8fd6913a31a5fada4c282ed319a8d4de3). Observation pages are read once through the native bounded HTTP body reader under the original request deadline, retained as decoded original bytes by NI identity and compressed source, and interpreted for validated accumulations independently of temperature presence. No second observation request, worker or state root is introduced.

The NOAA ASOS guide defines Prrrr as precipitation since the previous scheduled hourly report, P0000 as trace and PNO as unavailable gauge information (https://www.weather.gov/media/asos/aum-toc.pdf). Validated millimetre fields and supported Prrrr intervals can witness proxy wetness wholly inside the standard-time climate day; overlapping intervals are not added, missing values are not dry, and contradictory witnesses are excluded. Future-hour P01 marginals supply conditional union bounds, with a partial elapsed hour left unidentified. This does not prove The Weather Company's reporting equivalence. The original fixed 1% and 5% failure assumptions remain separately identified forward experiments; their exact model/source/rule/stage outcomes must support a positive measured skill bound before affecting the existing surface. The fitted D-1 rain lane remains within its original window.

The source-scoped grade report version 2 removes unsupported 10/30-date thresholds. Earliest original pre-close forecasts and verified matching-rule venue outcomes are regraded in the existing scorer, with independent dates (not ladder rungs) and the original one-sided 95% improvement bound. One date cannot estimate between-date variance. A positive bound supplies weight lower-improvement/mean-improvement, shrinking the model's log-odds contribution toward the market. The calibration bin still contributes its conservative Wilson endpoints; sparse evidence does not become a narrow probability band. Old wildcard hourly grades and old report versions cannot automatically confer eligibility. Original outcomes and pending packets remain intact; the first actual current-source regrade, not a restarted prospective clock, produces the new receipt. All capital, fee, depth and event/date exposure guards remain owned by their existing consumers.

Independent receiving after complete common fabrication must inspect all importing consumer modules, climate-day boundary selection, exact retained original/outcome regrading with finite probability inputs, positive and negative scoped skill, original-byte identities and clock/interval conflicts for precipitation, and the existing no-order cycle/surface. No source merge establishes current model admission, a venue fill or realized profit.

The shared NWS transport consumes Code's existing retryWithBackoff operation (its default three attempts and 100 ms exponential backoff), rather than wrapping another retrying venue client. A returned Retry-After is parsed at the HTTP owner and shared among this process's calls to the same origin. Cooldown, waits, retries and response-body acquisition remain inside each original 10-second or 30-second NWS deadline; if the server delay cannot fit, the source remains an explicit partial failure with its actual status, response receipt and cooldown metadata. Observations retain successful retry receipts alongside their original source bytes. Climate reports, hazards, station/point/hourly evidence and ECMWF station metadata use this same transport. No caller raises the 840-second host job bound or omits a requested station by inventing a policy hold. Kalshi's existing canonical retry owner also cancels consumed 429 bodies and respects optional Retry-After inside its original request timeout; the documented headerless case retains its exponential policy (https://docs.kalshi.com/getting_started/rate_limits).
