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
- [NWS explanation of station temperatures and Daily Climate Report interpretation](https://www.weather.gov/wrh/climate?wfo=okx): verify actual local products and measurement conventions by station.
- [Kalshi market-specific rules](https://kalshi.com/markets): the individual active event rules, not a generic category description, are authoritative.
- [NOAA IEM ASOS historical archive](https://mesonet.agron.iastate.edu/request/download.phtml): archived observations can be delayed or restated; availability needs recorded proof.

**Acceptance criterion of this memorandum:** model the remaining high as a conditional, source-aligned stochastic process and demonstrate incremental out-of-sample information plus actual fill-adjusted surplus. If either half fails, record a negative research result and retain the abstention policy.
