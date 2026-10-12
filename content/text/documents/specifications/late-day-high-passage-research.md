# Late-day high passage: physical evidence, market information, and fill-conditioned quoting

**Research memorandum, 2026-10-11. Status: preregistered hypothesis / structural bounds implemented; economic edge NOT established; no execution authorization from this note.**

## The question

Do point-in-time station observations, the time remaining in an event's *actual* measurement window, and forecasts of the remaining temperature trajectory improve the conditional distribution of a daily high *relative to the information already reflected in Kalshi's executable order book*? More narrowly, after a plausible daily high has been reached, can a passive resting order earn positive expected cash after conditional fill selection, tick/fee rounding, source disagreement, latency and risk?

This is a *joint metrology, probability, and microstructure* question. It is not the same question as whether afternoon temperatures typically decline. It also does not establish that the daily maximum has occurred merely because a station reports several cooling observations. No new independent trading bot or alternate market-data authority is warranted: this experiment belongs in the current forecasting service and must reuse the existing venue rules/source binding, station observations, NBM/LAMP, daily extrema, fee, and desk order-custody implementations.

## Distinguish the three objects

Let a market's authoritative contract specify station, source, reporting convention, resolution bounds and observation interval [a,b). Let Y_B be the binary payout indicator that the eventual authoritative reported high falls in bracket B. Its *reporting channel* matters: measurement, quantization, report revision and a source which is not the same as the available proxy station feed are part of the outcome.

At observation receipt time t, let m_t be the maximum *proxy-observed* temperature since a, using only reports actually available by t. Let R_t be the maximum of the *physical* temperature trajectory over remaining time (t,b). Then the passage probability is

    q_t = P(R_t <= m_t | F_t).

Here F_t is the information genuinely received by t, not observations timestamped before t but published later. For the venue, however, the target is

    p_B(t) = P(Y_B = 1 | F_t, market rules, source/revision model).

The equalities q_t approximately 1 and p_B(t) approximately 0 or 1 do **not** follow from one another without a correctly matched station/source, a high-resolution observation record, an accurate source-to-settlement operator and a model for revisions and rounding. A source disagreement might even put the official reported maximum below the proxy max. Tail probabilities never become zero just because the proxy looks decisive.

Three clocks are separate: (i) physical observation timestamp, (ii) published/received availability timestamp and (iii) exchange book/trade availability timestamp. Market closing, cessation of the physical observation period, report publication, and binary settlement may be hours apart and must be treated as different events.

## A distribution-free structural result with a limited scope

Suppose N remaining *hourly modeled* points T_1,...,T_N have correctly specified conditional marginal CDFs F_i(x) = P(T_i <= x | F_t). Without an assumption on dependence, the event that **no hourly point exceeds m_t** obeys the sharp Fréchet bounds:

    L_t = max(0, 1 - sum_i [1 - F_i(m_t)])
    U_t = min_i F_i(m_t)
    L_t <= P(max_i T_i <= m_t | F_t) <= U_t.

The complementary exceedance probability lies in [1-U_t, 1-L_t]. These are consequences of the union bound and nested-event construction, not evidence of forecasting calibration.

For a stylized ten-hour forecast where each future hour individually has 98% probability of remaining below the observed high, the joint no-exceedance probability could be anywhere from 80% to 98% without additional dependence knowledge. Positive, persistent thermal shocks can push it toward the upper end; differently timed independent/switching shocks can change the joint outcome. A common-rank/comonotone daily-maximum approximation returns U_t, which is the **optimistic upper bound** for no later exceedance, not a conservative certificate.

Implemented as lateDayHighPassageEnvelope in weather-temperature-extremes.mjs, directly reusing extremeCdf and the established Student-t hourly marginals. This pure computation explicitly returns tradeEligible:false. It does NOT bound subhour peaks, station/source mismatch, report revisions, uncalibrated marginal distributions or NBM guidance staleness. Only a separate empirically validated source-specific and path-sensitive model can produce a market-grade p_B.

The bounds can help reject overconfidence, prioritize which daily-high forecasts need better dependence information, and constrain a learned model when its assumptions really match the event. They are not themselves a quote price or trading signal.

## Dynamic physical model, proposed

The useful learned object is the remaining-temperature-increment distribution conditional on observed path:

    D_t = H_settlement - m_t,
    P(D_t > z | X_t, source and event rules).

Unlike a model that mechanically truncates at m_t, this target admits negative values from source mismatch or revisions, a mass near zero when the high likely already happened and heavy positive tails from subsequent warming. Model separate (A) physical remaining-maximum process from (B) reporting/settlement operator, composing the resulting law into exact whole-degree bracket probabilities.

First candidate is a discrete-time *conditional passage hazard* at the same fixed threshold m_t:

    h_k = P(T reaches > m_t during interval k |
            no exceedance since time t, information available at t, X_t).
    q_t = product_k(1 - h_k).

The chain rule makes the product exact **if** h_k is fitted as a conditional hazard using the event's actual past and future-window conditioning. It does not require independent hours. Because the threshold is the fixed observed max at t, do not silently replace it with an updated max at a later timestamp when scoring this prediction. Allow a 'no measurement' state, and treat censored/post-close samples distinctly.

Candidate features, screened by availability and ablation against cheap baselines:
- solar time and seasonal day length, *not only wall-clock hour*;
- hours to the actual rule's window end, including daylight saving and local-standard observation-day boundary;
- time since proxy day's high, recent temperature slope/change-point, dew point, humidity, wind direction/advective regime and pressure trend;
- cloud cover, precipitation, frontal passage/hazard flags and NBM/LAMP remaining-hour guidance;
- station-specific climate, current high relative to forecast quantiles, previous 1h/3h/6h high and same-day nearby-station contrasts where available;
- source identity, measurement/report precision, missing intervals and publication latency.

Do not manufacture filled-in minute observations and pass them off as independent measurements. Fit a parsimonious baseline first (hour/season/distance-from-forecast conditional survival); add a richer trajectory learner only if the ablation shows out-of-sample advantage. Advection, overnight warming, marine layers, and frontal transitions are essential counterexamples to the 'afternoon peak' intuition.

## Null, alternative and evaluation

**H0, scientific:** Conditional on the existing issued guidance, rules and contemporaneous market information, the incremental path/time model adds no out-of-sample skill for the actual venue settlement bracket.

**H1, scientific:** It improves proper scores, especially conditional event probabilities after the apparent afternoon high, under held-out weather days/cities/seasons.

**H0, economic:** No passive-quote policy can capture a positive *per placement*, fill-conditioned, net-of-fee realized expectancy after latency, queue risk, and capital cost, compared with abstention.

**H1, economic:** At least one *predeclared* source/city/time-and-book eligibility cell beats abstention on held-out executable evidence.

Primary scientific scores: Brier and log score for exact settlement YES/NO per market and peak-passage calibration where physical observation truth actually exists. Report reliability diagrams, calibration by time-to-event and temperature gap, station/source regime and missingness; CRPS for modeled final high where high-grade truth exists. Use market baselines from **executable** YES bid/ask and a coherent whole-ladder distribution, not just stale midpoints; compare the current temperature-market model, market-only baseline and a simple hour-only physical baseline.

Split chronologically by *weather day and city/region*, with nested tuning and a frozen forward evaluation. Adjacent hourly snapshots of one city on one day are **not independent samples**. Use region-day/block bootstrap confidence intervals, common-event risk aggregation, and multiplicity control for scanned prices, thresholds and time bins. Record negative results. Prior research already demonstrated that a lower Brier than our NBM model is not automatically achievable, and apparently mean-reverting mids can be untradeable after costs.

A strong result needs enough independent days, climates and frontal regimes to estimate rare recovery/late-high events. One season with no losses does not certify a 1% loss rate. Track uncertainty intervals and abstain when unbounded or poorly calibrated.

## The economic operator: conditional on being filled

Posting a resting **YES ask** at executable whole-contract price a is economically selling YES/buying NO. If F denotes a fill before cancellation, Y denotes the venue's YES payout, and f denotes the actual order-dependent fee, the expected cash per *placement* (before portfolio exposure risk) is:

    E[profit per placement]
      = P(F) * (a - P(Y=1 | F, quote and information) - E[f | F])
        - holding/operational/opportunity costs.

Crucially, P(Y=1 | F) may exceed the model's unconditional P(Y=1): a quote is often filled precisely by somebody who has learned that warming resumed. An optimistic fill simulator based only on a later trade through the quote can still overstate realized execution because of queue position. Conditioning on F captures adverse selection; do not subtract the same adverse-selection estimate a second time.

For the other side (posting a YES bid) reverse the payout economics. Resting spreads are not 'free money'; a genuine *two-sided* market maker must manage correlated YES/NO inventory and cancellation races, whereas the first experiment can focus on selectively posting one protective side of an existing bracket book.

Use actual contract size, minimum tick, exact series fee schedule and per-order fee ceiling; test zero fills, partial fills, burst fills, stale quotes, queue priority, cancel acknowledgement, adverse markout at 5/30/120 seconds, and holding to settlement versus exiting early. Quote after marginal and source model uncertainty, not at the optimistic Fréchet upper bound. Enforce source freshness, hazard and loss-rate gates; reuse existing desk custody and order recovery if a future release is admitted. A research result never authorizes live orders.

## Point-in-time data contract and replay

Every proposed decision has immutable witnesses for:
1. exact venue rules text/hash, city, station, source, bracket, resolution convention, close/end times and source-version date;
2. all observation values, quality/precision flags, observedAt, publishedAt (if known) and receivedAt, and the last genuinely available proxy high;
3. guidance issuance, arrival, source lineage, horizons and coverage for NBM/LAMP/other included forecasts;
4. exchange book tick, level/depth, source arrival time, freshness per quote, trades, potential queue position, and series-specific fee;
5. frozen model version/training cutoff, parameters, target, predicted survival distribution and uncertainty;
6. eventual corrected physical/weather reports, authoritative reported settlement, any revision, and its availableAt time;
7. prospective shadow quote intent, executable or hypothetical fill event, cancellation and inventory, fee and markout outcome.

Do not mix final archive truth into a prior market-day state. An historical observation is eligible only once the recorder could have received it. Distinguish absence of a station report from a prediction that no new high occurred. Never map a NWS METAR proxy directly onto a TWC-designated settlement without a tested reconciliation channel.

Reuse weather-engine's rulesHash, station-observations, climate-report evidence, archive content addresses, weather-score, station skill, existing tail-backtest fetch machinery, markouts and maker-fill studies. Reuse upstream math and model carriers rather than minting parallel kinds of prices, orders or temperature truth.

## Preregistered experimental sequence and release gates

**Phase 0, implemented now:** expose source-independent Fréchet hourly passage bounds as an explicitly untradable diagnostic; unit-test the single-hour identity, two-hour dependence bounds, ten-hour widening and invalid observations. This is a mathematical improvement, NOT a demonstrated edge.

**Phase 1, historical null test:** reconstruct 15-minute or finer point-in-time windows around each station's putative high and replay source-aligned rule days. Derive the observed-high trajectory and independent final high without leakage. Score late-day survival against hour-only, NBM and market baselines. Produce source coverage and missingness counts. If no prospective archived book timestamps exist, report that no executable backtest can be concluded; never fill the gaps with settlement truth.

**Phase 2, forward physical verification:** issue frozen predictions without orders, score each day's source-specific last-high event and bracket settlements with day-cluster uncertainty. Reject uncalibrated overnight/front and disagreement regimes instead of improving the headline number by deleting them post hoc.

**Phase 3, passive-order shadow:** for eligible held-out quotes simulate measured queue/fill hazard and compute fill-conditional P&L per placement on exact fee and spread evidence. Compare both post-fill markouts and hold-to-settlement net return, with uncertainty and the cost of abstaining. Keep the hypothesis family fixed before inspecting the holdout.

**Phase 4, independent admission only:** require positive lower confidence bound on *net per placement* edge after selection, robustness across cities/days/seasonal/regime variants, calibrated tail risk, fresh official source alignment, bounded quote exposure/cancellation and evidence of available operator custody. Otherwise do not deploy or increase stake. The existing live far-tail lane remains a separate admitted hypothesis; do not silently mutate its selection rules.

## Known earlier evidence and sources

- [Existing 2026-10-03 Kalshi daily-temperature research](https://github.com/red-cup-engineering/kalshi-engineering-services-section/blob/main/services/forecasting-service/data/records/2026-10-03-kalshi-temperature-tail-backtest/README.md): house general model loses to market Brier; limited specialized tail-positive backtest does not certify late-day peak trading.
- [Existing 2026-10-04 belief-path and maker study](https://github.com/red-cup-engineering/kalshi-engineering-services-section/blob/main/services/forecasting-service/data/records/2026-10-04-belief-path/README.md): no fee-surviving generic path-lane; mid reversion is not necessarily cash.
- [NWS/Los Angeles ASOS temperature metrology](https://www.weather.gov/lox/asostemperature): five-minute whole-degree Celsius reports can differ from internally tracked daily maxima, including peaks between reports; source precision is central to this experiment.
- [Kalshi's weather-market overview](https://help.kalshi.com/en/articles/13823837-weather-markets) and [an October 11, 2026 Newark daily-high contract](https://kalshi.com/markets/kxhightewr/newark-nj-ewr-daily-max-temp/kxhightewr-26oct11): the generic overview describes typical NWS daily settlement, while the particular contract explicitly names TWC; rules binding must take precedence.
- [Kalshi fee documentation](https://help.kalshi.com/en/articles/13823805-fees): maker orders may incur fees after execution, and fee selection belongs to the actual market.
- [Kalshi market-specific rules](https://kalshi.com/markets): the individual active event rules, not a generic category description, are authoritative.
- [NOAA IEM ASOS historical archive](https://mesonet.agron.iastate.edu/request/download.phtml): archived observations can be delayed or restated; availability needs recorded proof.

**Acceptance criterion of this memorandum:** model the remaining high as a conditional, source-aligned stochastic process and demonstrate incremental out-of-sample information plus actual fill-adjusted surplus. If either half fails, record a negative research result and retain the abstention policy.


## October 11 continuation: modal reachability, regional transitions and evidence order

The sharpened hypothesis is not merely about late-afternoon timing. Incoming fronts,
convective outflow, cloud clearance, radiative inversions, downslope warming and
marine/lake influences can change which temperature trajectories remain physically
admissible. A regional event has four distinct interpretations:

1. **Physical observation.** A measured temperature spike can strengthen the
   lower bound on the underlying day's maximum, provided that the source and
   measurement rules truly align with that underlying maximum.
2. **Dynamic reachability.** An independently justified model of all allowed
   future trajectories could exclude or entail some final highs. Its proof
   is only as sound as that model and its validity window.
3. **Probabilistic update.** A cooling front may make further highs very unlikely
   without making them impossible. Warmer air may make one likely without
   making it necessary.
4. **Concurrent market game.** Other participants can observe the same event,
   modify quotes and decide when to take our passive orders; a forecast gain
   is not automatically a profitable execution edge.

### Modal inference is not a probability, nor a bilattice charge

Let W_t be the *nonempty* set of future histories compatible with what was
actually received at issuance time t, a specified source and a specified
transition model. For a binary payout event B:

    Box(B)     iff every w in W_t resolves B true.
    Box(not B) iff every w in W_t resolves B false.
    Diamond(B) iff some w in W_t resolves B true.

If contradictory premises make W_t empty, do not conclude every proposition.
Instead retain the independent positive and negative witnesses and mark a
conflict. This is the non-explosive discipline of FOUR, not classical
vacuous entailment.

Obsmetrologia already defines Charge and its two orders in
Obsmetrologia/Language/Positing/Charge.lean; its modal structure exists in
Obsmetrologia/Closure/Modal.lean and
Obsmetrologia/Language/Positing/ModalKripkeFourValued.lean.
No parallel FOUR implementation or faux proved-JavaScript theorem belongs
in the Kalshi repo. The market science layer produces compatible independent
{for,against} witnesses, the existing SignCell carries them, and venue rules
supply the precise payout interpretation.

A lower bound on the *authoritative* final maximum is monotonic: once the
final maximum must be at least 91 F, the interval up to 90 F is impossible
and a strict-above-90-F bracket necessary, conditional on the bound. A proxy
NWS observation during a TWC-settled market does NOT establish that same
premise; its conclusion is kept in a separate proxy-conditional slot.

A rapid 20 F cooling is NOT a proof that a further high is unreachable.
For example, a purported maximum future heating rate r could imply
T(s) <= T(t) + r*(s-t), and thus an upper bound on remaining temperatures,
only if that rate is a sound bound on *all admissible futures*, not an
empirical 95th percentile or a model average. This illustrates the desired
future proof-bearing physical transition relation; no such certified
rate bound is presently claimed.

The evidence order is the order of disclosed witnesses, not an operation
that overwrites earlier contradictions. At every clock we distinguish
observedAt (physical event), availableAt (first accessible information),
issuedAt (our decision), and the market's independently observed book time.
Proof consequences are conditional on source, rule identity, station,
date, rounding, publication, corrections and the venue's exceptional fallback.

### Source ownership, with upstream/downstream boundaries

**Obsmetrologia mathematics:** lenticule-science/obsmetrologia owns
FOUR, the knowledge/truth orders, closure and modal mathematics. No
new Lean proof or unverified theorem was introduced this session.

**Generic proof operator:** red-cup-engineering/
prediction-market-engineering-services-section, service
mandate-portfolio-allocation-service/src/settlement-modal.mjs, owns
deduceSettlementInterval. It computes subset/disjointness of closed
numeric payout intervals against signed, received settlement-bound
premises, including compatible intersections, a non-explosion rule for
conflicts and withholding of late-published data. It has no Kalshi,
weather, credential, money or order logic.

**Shared evidence carrier:** existing SignCell/SignChain are consumed,
not forked. Kalshi's weather-modal-outcomes.mjs binds the contract's
actual whole-Fahrenheit bracket through temperature-distribution.mjs,
and passes conditional sources through deduceSettlementInterval to
SignCell. It never merges an NWS proxy with an asserted TWC final source.
A merely declared input qualification is NOT authenticated provenance;
the ordinary weather cycle supplies zero source-certified premises.

**Regional weather observation:** the existing weather-relational-
temperature.mjs now owns regionalThermalTransition, consuming exactly
the same METAR hourly panel used by the relational temperature learner.
For a region it compares adjacent genuinely received reporting bins,
records per-station signed changes and source witnesses, requires a
same-sign quorum, excludes conflicting or missing station bins, and
rejects stale hours. Regional change is a *physical measurement
event*, not an inferred market payout. It is carried by the existing
weather-relational-nowcast and weather-engine archive/status path, with
no new runtime timer, pricing surface, desk strategy or order actuator.

The ordinary research forecast rows now expose conditional proof
readings for bounded high-temperature contracts; only actual
source-qualified witness slots can yield a source-conditional deduction.
No ordinary NWS proxy spike can induce a structural price clip in
the Kalshi desk. All new paths return tradeEligible:false or
orderEffect:false.

### What should actually be measured next

For each predeclared region, station and weather day, reconstruct
station shocks with what was **available** at each time, not the final
retrospective archive. Classify coherent warming, coherent cooling,
mixed regime, and no information. Compare the conditional final-high
distribution and bracket calibration before and after each regime
change against hour-only, NBM, and current executable Kalshi
price baselines.

Keep dawn, afternoon, overnight, frontal and marine events as
explicit strata. Cluster confidence by weather day and region:
hourly snapshots of the same front are not independent trials.
For economic validation, record every contemporaneous level of
the book, queue position, quote freshness, exact fee, latency,
adverse selection, partial fills and markout; evaluate expected net
return **per placement** rather than per hypothetical filled contract.
Do not promote any lane merely because its posterior is extreme.
Predeclare the test cells and retain falsifying nontrades.

This session completed durable pure inference, source-dependent
projection and physical transition witnesses. It did NOT demonstrate
out-of-sample alpha, implement authenticated official-source
certification, formally prove a new Obsmetrologia theorem in Lean,
run the full workspace integration suite, update parent gitlink
release pins or deploy a production trading strategy. Those
remain independent receiving and scientific gates.


## October 12 implementation: rate-limited reachability, dual extrema, source receipts

This continues the same research program, **not** a new market-maker or math
library. The shared prediction-market engine now exports
boundRatePathExtremum from mandate-portfolio-allocation-service/
src/settlement-modal.mjs. It is a conditional physical/path bound:
a finite interval for temperature at issuance, an interval for the
maximum/minimum achieved so far, and a gap-free sequence of future
segments with continuous rate bounds in F/hour. At each segment the
operator integrates both lower and upper rates, bounding **every instant**
of temperature in the segment rather than just the final hourly reading.
Its running extremum is the maximum/minimum over the prior achieved
extreme and the reachable segment, with an order-dual argument for lows.

A result is a valid mathematical implication only under its named
assumptions. A numerical weather forecast, empirical rate percentile,
coherent regional transition or two endpoint METARs DO NOT alone supply
a certified instantaneous derivative bound. If the last segment does
not reach the climate observation window end, a rate certificate is not
received by issuance time, or initial state contradicts the achieved
extreme, the result is withheld. No rate-based live trading signal
or actual physical-rate certificate has been established.

Kalshi's weather-modal-outcomes.mjs consumes the same upstream operator
and temperature-distribution.mjs bracket interpretation. It now
offers modalTemperatureReading for **both** daily highs and lows;
existing high-only exports remain backward-compatible. Three types
of deduction remain distinct:

- sourceConditional: an exact rule/source/station-matched
  *conditional* certificate of a final reported extreme;
- nwsProxyConditional: a NWS observation floor for highs or ceiling
  for lows, requiring a separate unproved source-correlation assumption;
- rateConditional: a hypothetical physical all-time-rate scenario,
  with conservative half-degree tie uncertainty before conversion to a
  whole-Fahrenheit payout interval. This may prove conditional necessity
  or impossibility about the hypothetical future but has no authority
  over the other two evidential carriers.

All use the existing SignCell/FOUR witness construction. The normal
weather-cycle path supplies no rateScenario and no source-authenticated
verifiedSourceBounds. They are opt-in research inputs, not trusted merely
because a caller provides a qualifier string. The live desk still sees
only independently admitted probabilities and pre-existing structural
kinds; it is not handed modal research witnesses as executable edges.

Weather's TWC source reader now records a per-fetch receivedAt and
the digest from the existing weather-universe source-address function,
and sourceReport preserves them. Two records for the same requested
station/date now return an explicit conflict carrying both candidates,
not first-match-wins. Older archives that lack per-fetch clocks can use
the (later, conservative) cycle retrievedAt, never backdate to the
observation's physical timestamp. The published
@red-cup-engineering/forecasting/weather-settlement-source export makes
the receipt-bearing source reader available to other consumers, instead
of each reimplementing its own parser.

**Verification boundary:** dedicated tests cover source receipt
retention, duplicate conflict reporting, both extreme polarities,
actual rate-horizon coverage, continuous-time duality, half-degree
rounding uncertainty, delayed premises, wrong-source and wrong-rule
rejection, and finite-sampled path inclusion. Local isolated JavaScript
semantic tests with limited dependency doubles passed; an actual
workspace Node/SignCell integration suite, physical-rate certification,
parent release receiving, city-day historical evaluation and live
trading deployment remain unverified. They must not be inferred from
successful unit-level arithmetic or GitHub commits.

**Practical next experiment:** independent reception-clocked evidence
must tell us whether a real regional front makes the remaining daily
high/low *probabilistically* smaller or larger before Kalshi prices
respond, then whether a maker receives positive after-fee P&L per
placement. Proof of a bound (conditional on assumptions) and a
measured executable advantage are separate receiving gates.


## October 12 experiment: clock-adaptive reasoning frequency

Candidate resource-allocation hypothesis: keep a low-cost **hourly decision
opportunity** normally, and request **five-minute decision opportunities from
14:30 through 17:30** in each daily-high station's IANA local civil time.
The mechanism is phase-conditioned information value, not a theorem that daily
highs always occur in the afternoon. Highs can occur early, during heat
advection, or late/overnight; a future signal-driven override should evaluate
such exceptions on evidence. Distinguish the civil scheduling clock from the
local-standard climate-day and the actual contract settlement clock.

Implementation resides in the already-owning forecasting package:
src/weather-reasoning-cadence.mjs chooses due slots by timezone,
weather-engine.mjs gates its existing single-flight research/collector cycle,
apps/weather.mjs exposes cadence-plan and cadence-cycle. A single external
five-minute host tick is the intended receiver; no new ChatGPT scheduled task
or second independent weather pipeline. The full collector is still global
at each due instant, not yet a per-city incremental collector. Source-arrival
timestamps must be checked independently: running an unchanged forecast five
times is not acquiring five independent physical observations. The earliest
source collection clock, not the later cycle completion time, determines
whether a given five-minute slot was covered. The historical 10-minute
after-completion host timer requires replacement by a single five-minute
dispatcher on the actual installed release, followed by host readback. GitHub
source is not a claim of live timer replacement.

**Falsifiable evaluation:** record coverage, actual cycle durations,
source freshness, model changes, city-day clustered forecast gains, quoted
spread/fees and fill-conditioned net return for hourly-only versus
clock-focused issuance. Compare by local solar/seasonal regime; stratify
front-driven off-window changes, and compute incremental information gained
per additional acquisition cost. Promote high-frequency off-window exceptions
only if they show positive measured incremental value. A phase-triggered
research cycle never implies certainty or permission to place an order.
