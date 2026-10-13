# Hourly temperature source admission — October 13, 2026

Hourly targets are shorter than daily targets and are a strategic priority. Leader,
October 13: “don't focus on "speed" please think critically about the whole project
we're engaged in as a real thing working with real data and real capital”. The
receiving purpose is better real hourly forecasting and execution, rather than
more rapid repetition of an unproved forecast. Cash timing is not the focus or a
barrier to this work.

## Current contracts and source inputs

Eight unsigned public GETs at 21:33 UTC retained one series and one active contract
for each of Miami, NYC, Chicago and coastal LA. This is a four-contract selection,
not a full universe, execution-depth sample, or account observation. Original JSON
bytes, SHA-256 and post-body receipt clocks are under `sources/`. Market cursors
remain in the responses; coverage is deliberately incomplete.

All four sampled contracts specify Synoptic Data and the Kalshi Weather Index
Methodology. They are multi-station city indices. Their target is 6 PM EDT for all
four cities; city-local time must not replace the issuance clock. The generic
[weather Help article](https://help.kalshi.com/en/articles/13823837-weather-markets)
describes TWC hourly products, but individual market rules govern these products.
That generic description must not bind the current indices to one TWC station.

The retrieved [NYC terms](https://assets.kalshi.com/contract_terms/NYCWINDEX.pdf)
define eight equal-weight stations and quorum of seven members / 0.875 base weight.
Primary one-minute ASOS records, fallback hierarchy, local receipt eligibility,
provider/spatial QC and full precision Celsius offsets govern the calculation.
Accepted members are renormalized over their available weights; final output is
rounded only once to 0.01 F. For an `at` contract, the authoritative reading is the
latest canonical normal/degraded minute at or before the target, within 60 minutes.
Unavailable minutes are not carried forward. With no eligible minute, the outcome
review path applies. Ground guidance is a sensor/index proxy, not settlement truth.
Exact half-cent rounding ties remain unspecified by the certified text.

At 21:34 UTC, NYC's published configuration was
`nyc-temperature-v1.0-cal-20261012`; all eight members had weight 0.125, with actual
current offsets, publication and effective clocks retained. Chicago's retrieved
[terms](https://assets.kalshi.com/contract_terms/CHIMETROWINDEX.pdf) still name initial
configuration `chicago-temperature-v1.1`, while the calibration endpoint published
`chicago-temperature-v1.0-cal-20261012`. Preserve that contradiction; do not replace
the certified identifier with the live one to manufacture support. The current
engine already excludes this incompatible configuration. A further bounded NYC
minute-audit GET at 21:40 UTC retained two normal points, each with all eight
station contribution records and original local receipt stamps; both reported
69.35 F. These historical minute readings are inputs, not a future target outcome
or a profitable forecast.

## Forecast derivation and eligibility correction

Source review traced the current collector, index arithmetic, market probability
consumer, station science, pending forecast journal, finalized venue scorer and
forecast surface. Full-station forecasts retain configured weights and offsets.
The basic distributions use a common Student-t shock, preserving spread instead of
inventing independent station errors. Joint AIFS scenarios preserve member and
field identity. Missing member inputs or incompatible configuration block those
laws. Recent-index innovation and residual postprocessing are explicit experiments;
sensor discrepancy, degraded/QC source selection and the older-minute outcome
fallback remain unmodeled. Physical CRPS/MAE improvement does not establish a
profitable binary market forecast or maker fill-selection law.

Original [PR 24](https://github.com/red-cup-engineering/kalshi-engineering-services-section/pull/24)
allows date-based pooled grades with ten dates instead of thirty at one station.
The owning `README-weather.md` also requires source/methodology changes to reset
eligibility. The former hourly pooled key discarded source and rule identity,
allowing another city/methodology's grades to bypass that reset. Hourly pooled keys
now retain source and normalized `ruleKey`; the station slot stays pooled and the
existing ten-date threshold remains. Legacy broad hourly grades remain research
evidence but cannot supply a current scoped grade. Daily/rain grouping is unchanged.
No new calibration threshold, order authority or capital policy is introduced.

Prospective pending records freeze the first actual probability/model set for each
contract/stage/rules hash while the market is active. Venue grading requires a
finalized binary outcome, original settlement timestamp and matching rules. Events
are aggregated into distinct date means; hourly ladders and repeated forecasts do
not increase independent date counts. Source review cannot establish how many
qualified current hourly surface rows are actually available in production. That
requires the fabricated release's real native observations and source records.

## Edge and effective execution

Current sampled series use `quadratic` fees with multiplier 1. Re-read event overrides
and scheduled fee changes at execution; use the existing exact accumulator, actual
account grid and genuine depth walk. Displayed prices/sizes may change before an
acknowledgment. A resting bid additionally needs evidence about winning conditional
on filling: counterparties choose when to trade. Shared Fréchet bounds preserve that
uncertainty. Public tape replay cannot establish our absent order's queue, partial
fills, latency or market impact. Research alternatives do not gain trade authority.

The earlier maker-incentive study found adverse selection exceeded its sampled
strategy's reward; short positive mark-outs were not settlement profit. That is a
warning to measure actual hourly net outcomes, not an hourly profitability verdict.
Multiple hours can remain correlated within one city's weather regime. Actual fills,
fees, finalized outcomes and account receipts must distinguish realized net results
from model scenarios and portfolio marks. Shorter duration alone cannot make a
negative fee-adjusted edge positive.

## Production receiving still owed

After complete shared-release fabrication, independently receive the cloud's actual
hourly collection and index configuration evidence, original prospective records,
current rule-scoped grades and qualified surface. A changed source or rule must not
consume an old broad hourly grade. Missing scope must remain unqualified, while a
supported same-scope pooled grade retains its ten-date criterion. Receive later
hourly outcomes and effective fee/depth selection through the existing native
operations. Any execution uses existing live risk/arming/order custody; no separate
worker, fake source support or automatic model admission is added. Source parsing
and publication are not production receiving. No package test suite or application
probe preceded full fabrication.
