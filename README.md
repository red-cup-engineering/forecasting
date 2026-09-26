# Forecasting Services Section

`@red-cup-engineering/forecasting` — forecasting as skill-for-fee and as the edge
behind the Kalshi stake path: calibrated-judgment forecasting sold as a
service, and staked on the venue wherever the calibration record shows the
house beating the market after fees. Question ingestion, metrologic
bilattice evidence fusion, proper scoring rules, and calibration tracking.
Forecasting itself costs compute and time on the house's free-inference
rails; stakes go through `kalshi-stake-path-service` inside its capped
envelope.

## Pipeline

1. **Ingest** (`scripts/ingest-forecasting-question.mjs`) — validates and
   normalizes a raw question definition into a canonical
   `ForecastingQuestion` (`src/forecasting.mjs`'s `normalizeQuestion`).
2. **Gather** (`scripts/gather-question-evidence.mjs`) — dispatches the
   question through the free-first provider order
   (`@red-cup-engineering/openai-compatible-chat-completion-service`),
   parsing a `PROBABILITY:`/`CONFIDENCE:` estimate from the completion. Never
   falls back to a paid or frontier provider.
3. **Fuse** (`scripts/fuse-forecast.mjs`, `src/evidence-fusion.mjs`) —
   combines one or more evidence estimates into a single forecast: the
   probability point-estimate is a confidence-weighted mean (ordinary numeric
   aggregation); the qualitative support/refutation charge is real
   `@lenticule-science/metrologic/bilattice` fusion (`aggregate`/`isTop`),
   kept honestly separate from the numeric mean rather than one dressed up
   as the other.
4. **Record** (`scripts/record-forecast.mjs`) — writes the canonical
   `ForecastRecord` via `@red-cup-engineering/semantic-record-journal-service`
   (`createSemanticRecordJournal`), landing at this section's own
   `data/logs/`.
5. **Score** (`scripts/score-forecast.mjs`) — once a question resolves,
   scores the recorded forecast with the Brier score (always) and the log
   score (whenever the stated probability isn't exactly 0 or 1 — `logScore`
   is undefined at those boundaries), and journals a calibration-tracking
   record.

`apps/forecasting-cli.mjs` composes the full pipeline as two commands: `run
<question.json> [--catalog <path>]` (ingest → gather → fuse → record) and
`score <forecastId> <outcome 0|1>`.

## Exports

- `@red-cup-engineering/forecasting/forecasting` — `src/forecasting.mjs`:
  `normalizeQuestion`, `createForecast`, `brierScore`, `logScore`,
  `calibrationBuckets`.
- `@red-cup-engineering/forecasting/evidence-fusion` — `src/evidence-fusion.mjs`:
  `chargeFromEvidenceEstimate`, `fuseEvidenceToForecast`.

## Thread

Forecasting research—including economic context, scoring theory, and the
obsmetrologic reading of gathered evidence—remains in Science. This package
is its engineering realization: it accepts bounded question and evidence
carriers, produces forecast and calibration records, and composes with the
Kalshi market-read and stake-guard services without taking a market position.
It does not claim theory ownership or an operations/public product boundary.

## Entanglement

Checked against the house primitives named in the 2026-09-01 five-custody
ruling:

- `@lenticule-science/metrologic/bilattice` — genuinely used in
  `src/evidence-fusion.mjs` (`aggregate`, `isTop`) for the support/refutation
  charge fusion; not a duplication candidate. `brierScore`/`logScore`
  (`src/forecasting.mjs`) were checked against metrologic 0.1.1's full
  subpath export set (bilattice, obstruction, number, closure, chu,
  hyperdoctrine, spectral, dgen, dframe, readout, type-theory, verdier) —
  metrologic owns four-valued evidence/bilattice math, not proper scoring
  rules, so this is not a duplication.
- `@red-cup-engineering/semantic-record-journal-service` — already the sole
  writer in `scripts/record-forecast.mjs` and `scripts/score-forecast.mjs`
  (`createSemanticRecordJournal`); no hand-rolled record/receipt writing.
- `@red-cup-engineering/openai-compatible-chat-completion-service` — already
  the sole inference path in `scripts/gather-question-evidence.mjs`
  (`validateChatCompletionPacket`, `runOpenAiCompatibleChatExchange`,
  `selectFreeFirstProvider`); no hand-rolled provider dispatch.
- `@red-cup-engineering/eavt` — no hand-rolled EAVT-shaped rows anywhere in
  `src/` or `scripts/`; none needed.
- `@red-cup-engineering/image-generation-inference-team` — this package does
  no image generation anywhere; none needed.

No wiring changes were required in this pass.
