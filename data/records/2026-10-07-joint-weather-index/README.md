# Joint weather scenarios at live city-index targets

The underlying capability is a prospective probability law for the certified city-index transformation, followed by physical and exact venue outcomes. The existing city-index collector, station-science consumer and market probability consumer now carry the operational AIFS joint ensemble alongside their earlier forecast families. No separate scorer or trading worker was introduced.

## Scientific and settlement evidence

[Ensemble copula coupling](https://arxiv.org/abs/1302.7149) and its [discrete-copula formulation](https://arxiv.org/abs/1305.3445) motivate retaining ensemble dependence when producing multivariate predictions. This implementation pushes the raw member-aligned ensemble through the index calculation. It does not yet fit ECC marginal calibration, prove raw spatial dependence correct or establish market alpha.

The certified [NYC](https://assets.kalshi.com/contract_terms/NYCWINDEX.pdf), [Miami](https://assets.kalshi.com/contract_terms/MIAWINDEX.pdf), [coastal LA](https://assets.kalshi.com/contract_terms/LAWINDEX.pdf) and [Chicago](https://assets.kalshi.com/contract_terms/CHIMETROWINDEX.pdf) documents specify the index carriers. Raw PDF bytes, decoded text, hashes and real receipt/decoding clocks are retained by the ordinary source collector. The quorum is parsed from those documents rather than maintained as a second numerical registry. NYC requires seven members and 0.875 of configured weight; the code's previous six/0.75 copy was wrong. Miami, LA and Chicago require four members and 0.8 weight. Certified Chicago configuration v1.1 continues to conflict with the source's published v1.0 configuration, so it remains excluded.

Complete normal observations remain eligible without a separately retained quorum document. Degraded observations now require certified quorum evidence. Unknown quorum support is not inferred from the source's degraded status alone. Existing raw source archives are preserved; a historical fixture replay still reproduces 343 eligible normal published minutes, while declining its unproved degraded points.

## Transformation and mathematical effect

For member m and exact available target t, the full-station normal proxy is

`I_m(t) = sum_i w_i [T_i,m(t) + 1.8 (B_c - b_i)]`,

where the weights and Celsius offsets come from the effective, already published city configuration. Each station retains the same member identity and the same global field hash. The resulting uniform empirical law over 51 scenarios retains spatial dependence. A controlled eight-station case with opposing spatial shocks produces a constant city law at machine precision; replacing joint identity with common marginal ranks would produce a different law. Missing stations, mismatched field identities, unavailable target slots and future configuration receipts prevent the projection.

The forecast is conditional on all configured one-minute station sensors passing QC at the target. Grid-to-sensor discrepancy, degraded/unavailable operation and selection of an older canonical minute under the 60-minute settlement fallback remain unmodeled. All source and geometry witnesses remain available for later calibration. These proxy laws do not acquire trading eligibility from their publication.

Forecast pools retain the full empirical law and use a new `kalshi-index-family-pool-with-aifs-v2` identity. Exact half-cent ties have an additional metrological ambiguity: the certified nearest-0.01F rounding rule does not specify tie behavior. The probability consumer now retains lower/upper bounds and withholds a point probability when those bounds differ. Continuous-CDF behavior and strict/inclusive contract comparisons remain intact. Contract strikes with excess precision are declined rather than silently rounded.

## Actual hosted outcomes of the engineering

At 17:54:14.981 UTC, the existing native city-index tool registered six genuinely prospective forecasts for 18:00 UTC: one joint AIFS law and one family pool each for NYC, Miami and coastal LA. The source call covered all eighteen configured constituent stations, used fifty-one complete fields from the actually available 06:00 UTC run, and took 34.2 seconds. An independent state read found all six under their original publication clocks and source evidence identity. Chicago was excluded. [The live receipt](live-tool-receipt.json) identifies the losslessly archived laws, geometry, fields and certified documents.

A subsequent ordinary collection verified all three supported configurations at the actual post-fetch availability clock and retained the Chicago conflict. [Its receipt](certified-source-receipt.json) distinguishes that corrected validation from the first publication packet's erroneous validation flags, which compared newly retrieved documents against the earlier collection-start clock. The forecast publications themselves already used the later, correct availability clock.

At 17:59:21.859 UTC, a read-only scientific snapshot retained sixty probabilities from those frozen laws against thirty then-active live contracts, together with freshly reread quotes and exact rules hashes, before their 18:00 closure. [The snapshot](prospective-market-snapshot.json) supports a future Brier comparison against contemporaneous midpoints and exact venue outcomes. It is not an executable-depth or fee measurement, does not identify opponents' strategies, grants no trading authority, and places no orders. Correlated contracts do not provide thirty independent weather outcomes.

## Decoder execution and source failures

The first ordinary full-universe collection returned an unclassified decoder termination. That path rebuilt a global grid search per station; its four-minute bound and memory control were also in effect. The retained error alone does not establish which limit caused termination. The retained optimized producer instead verifies the encoded scan direction, origin and increments, then reads all required corner indices in one ecCodes operation per field. The real JFK sample projection remains numerically identical. Geometry projection memoization still uses field, station, operator and decoder identities.

The newer 12:00 cycle also returned HTTP 503 during acquisition. Collection now records transient HTTP failures and tries an earlier complete cycle within its twelve-hour age bound. It never mixes incomplete cycles or fills missing members. Metadata/GRIB contradictions remain errors, rather than occasions to select an older model silently. This handles source acquisition as a timed research action; publication still refuses expired targets.

## Verification and open scientific work

The retained controlled experiment verifies certified quorum behavior, member/field alignment, missing-source and future-receipt refusal, the spatial cancellation case, ambiguous rounding bounds, continuous probability partitions, prospective publication and later scoring through the existing consumer, and zero repeated grades. Synthetic results are engineering evidence. The six hosted target outcomes and their exact venue outcomes had not been graded at publication. Calibration, comparative forecast skill, regime dependence, information advantage over adaptive rivals and net executable alpha remain open empirical questions.

## First prospective city outcomes observed

At 18:06 UTC the existing consumer graded all six new city forecasts on the canonical 18:00 minute, observed after their 17:54 publications. NYC's reported value was 65.53F: AIFS absolute error 0.815F / CRPS 0.545F; the pool 0.125F / 0.386F. Miami was 84.56F: AIFS 2.079F / 1.358F; the pool 2.800F / 1.714F. Coastal LA was 84.20F: AIFS 0.583F / 0.579F; the pool 2.394F / 1.331F. The pool scored better in NYC and worse in the other two cities for this single hour. This supplies a prospective counterexample to treating additional equally weighted sources as an automatic improvement, and motivates observation-conditioned correction and past-only adaptive family generation. It provides no multi-date superiority or executable-alpha evidence.

[The complete outcome receipt](first-outcomes.json) retains the original laws, canonical minute witnesses and issued/graded archive identities. New AIFS acquisition at that collection was withheld after transient failures and expiry of the earlier cycle, while the existing sources still scored 92 earlier forecasts. That source error did not prevent the six city outcomes from being registered. Future source availability and transport redundancy remain operational work.

City-index outcomes now wait for their certified five-minute publication deadline; NWS nearest-hour outcomes retain their fifteen-minute observation window. The controlled experiment refuses premature grading and verifies the five-minute transition, enabling earlier learning without treating a provisional index point as settled. Exact venue outcomes and the sixty-probability market snapshot have not yet been graded.

At the first exact-venue check (18:10 UTC), all thirty markets were still pending final binary outcomes. The existing `binarySettlement` consumer accepted none as final; their observations and pending statuses are retained in `market-outcomes-first-check.json`. This does not substitute the physical city reading for venue settlement or score provisional results as wins.

A direct hosted benchmark on one real member field and all 48 actual collector station coordinates measured 179 ms for batched grid reads and 958 ms for repeated nearest-point searches: 5.35 times faster, with zero Fahrenheit projection difference. [The benchmark](grid-benchmark.json) supports the numerical preservation and code-path speedup; it does not establish whole-cycle latency or the cause of the earlier decoder termination. Future errors retain termination signals so acquisition, timeout and memory failures can be distinguished.
