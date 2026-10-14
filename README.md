# Forecasting Services Section

`@red-cup-engineering/forecasting` — a forecasting capability intended for
skill-for-fee work and for the separate Kalshi stake path when calibration
supports it. This package does not establish a buyer or a profitable stake.
It provides question ingestion, SignChain claim
fusion, proper scoring rules, and calibration tracking.
Stakes go through `kalshi-stake-path-service` inside its capped envelope.

## Present source ownership and extraction boundary (2026-10-14)

This is currently the **mixed legacy implementation** at
`red-cup-engineering/kalshi-engineering-services-section/services/forecasting-service`;
its published package identifier is `@red-cup-engineering/forecasting`.
This is **not** a standalone `red-cup-engineering/forecasting` GitHub repo.
The public x402 seller consumes its `./station-observations` and
`./coops-water-level` exports in two held NOAA candidates. Do not treat
location under Kalshi as engineering/scientific ownership of NOAA observations.

The target weather-specific section is
`red-cup-engineering/weather-system-engineering-services-section`:
it should own meteorological source admission, station readings, physical
data transforms, measured uncertainty, forecasts and their original data
provenance, independently of which market buys the result. **General**
question forecasting, evidence fusion and proper scoring remain reusable
forecasting capabilities, not exclusively a weather service. Kalshi owns
market-specific settlement rules, quotes, positions, and trading behavior;
it should consume weather rather than own the source data provider.

The **extraction is not yet complete**: preserve the original current exports,
the Kalshi consumer, and Causeway marketplace PR #5 until a single properly
owned package, repository and installed parent mount are independently
received. Required receiving checks: exact exports and their consumers;
NWS METAR and CO-OPS request bounds, source bytes/NI, timestamps,
quality/datum/units, rights and CARE authority where applicable;
unchanged caller-facing inputs and outputs; source and actual network
test failures; then canonical x402 SKU/ActivityPub compilation and real
seller/Node receiving. Do not implement another NOAA fetcher or clone the
forecasting package to meet a naming criterion.

Scientific authority and distinctions are maintained in
[Lenticule Climate Science's current hourly-temperature article](https://github.com/lenticule-science/climate-science-services-section/blob/main/content/text/documents/articles/2026-10-14-source-bound-hourly-temperature-forecast-science.md).
This README controls today's actual package consumers, not semantic proof,
permissions or an uncompleted repository migration.

## Pipeline

1. **Ingest** (`scripts/ingest-forecasting-question.mjs`) — validates and
   normalizes a raw question definition into a canonical
   `ForecastingQuestion` (`src/forecasting.mjs`'s `normalizeQuestion`).
2. **Supply estimates** — give the run command a JSON array of estimates.
   Each row has `source`, `probability`, `confidence`, and either a source
   `url` or a `note` identifying the material or judgment used. A question
   alone supplies no evidence or probability. The caller is responsible for
   the claims and the cited material; admission here validates their shape.
3. **Fuse** (`scripts/fuse-forecast.mjs`, `src/evidence-fusion.mjs`) —
   combines one or more evidence estimates into a single forecast: the
   probability point-estimate is a confidence-weighted mean (ordinary numeric
   aggregation); the qualitative support/refutation charge uses SignCell and
   SignChain's `knowledgeJoin`,
   kept honestly separate from the numeric mean rather than one dressed up
   as the other.
4. **Record** (`scripts/record-forecast.mjs`) — writes the canonical
   `ForecastRecord` with `put` of `@red-cup-engineering/semiotic-eavt-services-section/store`,
   landing at this section's own `data/records/forecast-records/`.
5. **Score** (`scripts/score-forecast.mjs`) — once a question resolves,
   scores the recorded forecast with the Brier score (always) and the log
   score (whenever the stated probability isn't exactly 0 or 1 — `logScore`
   is undefined at those boundaries), and journals a calibration-tracking
   record.

`apps/forecasting-cli.mjs` composes the full pipeline as two commands: `run
<question.json> <estimates.json>` (ingest → fuse → record) and
`score <forecastId> <outcome 0|1>`.

## Exports

- `@red-cup-engineering/forecasting/forecasting` — `src/forecasting.mjs`:
  `normalizeQuestion`, `createForecast`, `brierScore`, `logScore`,
  `calibrationBuckets`.
- `@red-cup-engineering/forecasting/evidence-fusion` — `src/evidence-fusion.mjs`:
  `evidenceOfEstimate`, `fuseEvidenceToForecast`.

## Thread

Forecasting research—including economic context, scoring theory, and the
obsmetrologic reading of gathered evidence—remains in Science. This package
is its engineering realization: it accepts bounded question and evidence
carriers, produces forecast and calibration records, and composes with the
Kalshi market-read and stake-guard services without taking a market position.
It does not claim theory ownership or an operations/public product boundary.

## Actual joint-scenario signals and partially identified market sheaves

The read-only `aaa-gas-study.mjs participation PACKET.json` now supports
`signalObservation` alongside the existing source-scoped `signalStudy`.
This is the observed-result continuation of the already implemented
expected-value-of-information decision, not a new probability engine:

- `signalStudy.model.conditionedOnForecastId` names the supplied original
  joint forecast. The model was published before observing the signal.
- `signalObservation` contains its `id`, a known `signalId`, absolute
  `observedAt` and `availableAt` clocks, and source `evidenceIds`.
- The shared Prediction Market Engineering Bayes operator produces the
  entire joint posterior. Every AAA threshold, pairwise covariance and
  research action is recalculated from that ONE scenario distribution.
- The independently received `settlementBand` must include
  `forecastId` equal to that posterior's `id` and must contain its
  selected rung probability. This is a consistency requirement, not proof
  that the settlement model has been calibrated.
- The result supplies `posteriorForecast`, `observedSignalDecision`,
  the conditional research `signProjection` with an actual canonical
  SignCell address and SignChain proof predecessor IDs, and the usual
  fee-aware participation menu. No Kalshi order is placed.
- A source report impossible under the frozen likelihood or published
  after the decision gives a gap, not an executable signal. Journal
  publication and independent causal receiving remain external.

The cellular sheaf now also offers
`partiallyIdentifiedHarmonicExtension`. The live shadow and historical
backtest consume it to recover numerically identifiable stalk coordinates
from constrained graph components without inventing estimates for gauge
modes and disconnected free components. The backtest records withheld
targets in `energy-by-day.json`. These are numerical research estimates,
not empirical forecasting skill or calibrated opportunity admission.

Both `aaa-gas-participation` and `kalshi-sheaf` are package exports.
The mathematical shared signal update is owned by Prediction Market
Engineering; Kalshi owns the venue rules, quote, fees, source population and
event-specific projection.

## Entanglement

Checked against the house primitives named in the 2026-09-01 five-custody
ruling:

- SignCell and SignChain — `src/evidence-fusion.mjs` carries each supplied
  estimate as an attributable claim and joins conflicting claims without
  silently resolving their disagreement. Proper scoring remains in
  `src/forecasting.mjs`.
- `@red-cup-engineering/semiotic-eavt-services-section` (`./store`) — the sole
  writer in `scripts/record-forecast.mjs` and `scripts/score-forecast.mjs`
  (`put`); no hand-rolled record/receipt writing.
- Inference — the old question-only free-first loop has been retired. An
  inference-generated estimate can be supplied with its source material, but
  this forecasting pipeline currently has no admitted inference customer or
  model execution contract. A source note is an attribution claim, not
  independent verification of its contents.
- `@red-cup-engineering/eavt-services-section` — no hand-rolled EAVT-shaped rows anywhere in
  `src/` or `scripts/`; none needed.
- `@red-cup-engineering/image-generation-inference-team` — this package does
  no image generation anywhere; none needed.

The question-only free-first inference loop was removed from this pipeline.
