# Weather learners that generate learners, with adaptive rivals

The active goal is to develop the strongest empirically supported climate/weather strategy space for Kalshi and other markets using Obsmetrologia, concurrent games and the actual theories of work and governance. This record describes a bounded implemented effect toward that goal. The literature remains open, and the goal is not complete.

## Realized capability

Measurement histories generate fitted forecasters. Earlier outcomes then determine how those forecasters are selected or mixed. A second learner decides which selection/mixing generator to use, again from earlier outcomes. Economic scenarios assign rival-generated quotes to the same physical outcomes, so a rival's learning can remove the opportunity even while physical forecast quality stays unchanged.

`weather-strategy-research.mjs` reuses the existing witnessed station carrier, normalization, chronological fitting and empirical residual distributions. Six specifications generate actual fitted predictive learners: spatial gradients plus temporal increments with ridge 1, 10 or 100; peer increments alone; peer gradients alone; and the target's own history. This is bounded numerical learner/configuration generation. It does not implement autonomous LLM code evolution or claim novel physics.

All candidates use identical cases and the same sixty-day past window, whose final fourteen days are reserved for residual calibration. Candidate validation uses only forecast outcomes strictly before the current UTC day. A generator selects the recent winning candidate or uses soft weights proportional to exp(-eta × prior mean daily CRPS), with eta 2, 8 or 32. Every selector uses the unchanged original relational learner during its first seven validation dates. A recursive learner chooses among those generators using their own earlier predictive scores; it also starts from the unchanged baseline. Neither a future outcome nor its score can affect an earlier selection.

The mixtures are full probability distributions. Their CRPS includes all cross-component absolute-distance terms; averaging component CRPS would score a different object. Exact finite empirical scoring retains component shapes and their earlier residual calibration, rather than presuming Gaussian errors. Finite residual support still cannot represent unseen extremes.

## Concurrent game and the ecosystem theories

The encoded arena is directly consumable by the repository's existing `gaming/src/encoding/arena.mjs`. Its strategy is judged by the existing `gaming/.../strategizing/strategy.mjs`. It has measurement-history and market-evidence arrivals, rival updates, learner generation, publication, outcome arrival, scoring and learning events. Rival updates can precede or follow our generation. Outcome arrival never depends on our choosing to act. If settlement arrives before publication, the policy admits that opponent event and withholds the expired publication while still permitting learning.

The actual game consumer accepted all 189 admitted prefixes as valid, prefix-closed, receptive, identity-symmetry-invariant and well formed under its narrow deterministic sequential-Player interpretation of innocence. This is a finite game instance. It is not a proof of the full concurrent-game strategy equivalences, courtesy, a nontrivial nominal symmetry, Nash equilibrium or general adaptive-market convergence. The existing verification-tournament implementation itself keeps its broader Dialectica/Nash correspondence as an open formalization obligation.

The actual theory of work distinguishes capability, state transformation and resource cost. Here each generation records its elapsed time, fit count and cases, and the complete study records retained process heap. This makes a small gain from extra generation assessable against its computation cost. It does not prove the manuscript's proposed mastery or learning-rate claims. Heap is a process snapshot, not incremental allocation or peak RSS.

The governance distinction applies to forecast/model revision versus changing the rules under which evidence qualifies trading. The study creates research data. It cannot revise admission criteria, register its historical replay as live skill, or send an order. The existing collector already refreshes market quotes after weather collection and before forecast recording; live allocation rereads executable books. Those consumers remain intact.

Obsmetrologia's measured-reading distinction keeps source evidence, fitted numerical forecasts, claims about skill and hypothetical profit separate. The raw archive remains lossless and content-addressed; contradictory measurements remain explicit. Neither numerical probabilities nor economic payoffs are seeded as FOUR readings. The general H1/confluence and numeric-Laplacian/order-closure equivalences remain subject to their actual formal scopes.

## Empirical physical result

The frozen input is the same July 1–October 6 IEM routine-METAR archive from the [relational metrology experiment](../2026-10-07-relational-weather-metrology/README.md). There are 3,453 NYC and 2,651 South Florida paired held-out station-hour cases over 37 issuance dates per region.

| Region | Original relational CRPS °C | Stronger-regularization learner CRPS °C | Recursive generator CRPS °C |
|---|---:|---:|---:|
| NYC | 0.356416 | 0.353835 | 0.354348 |
| South Florida | 0.469378 | 0.467785 | 0.468720 |

Recursive generation makes a small improvement over the original relational learner in this replay. The simpler ridge-100 candidate beats it in both regions. Several mixtures worsen the result. This contradicts any blanket expectation that another recursive layer or more mixture components necessarily improves forecasting. It gives a concrete empirical basis for keeping complexity and resource use visible.

These are exploratory seasonal archive results, without an independent prospective confirmation or a claim of significance. Previous and newly generated forecasts are paired on the same cases, but historical receipt latency is unknown. The candidate/generator family was developed after examining this archive; earlier-data selection within the replay does not turn repeated research on the same season into an untouched final test. No results qualify trading.

## Economic stress, with learning opponents

The instrument is deliberately labeled hypothetical: next reporting-bin temperature at a given station is at least one Fahrenheit degree warmer than its current reporting-bin value. It is not a Kalshi contract, not an exact-hour venue measurement, and not an official city-index or daily-extreme settlement.

Four rival classes set scenario prices from their predictive probabilities: an own-history follower, the original relational learner, an adaptive candidate follower that updates from the last earlier validation day's best learner, and a same-information rival using our exact probability. The model assumes displayed size, cent-rounded asks, a one-cent half-spread and a one-cent per-contract fee. Those are scenario inputs, not Kalshi's current fee schedule or evidence of fill availability. Price feedback and learning are represented; actual maker adverse selection, private signals, execution latency and real opponent identity are not inferred.

Simulated cash is consumed at entry and returned only at the simulated outcome time. Concurrent cases cannot reuse the same cash. The policy trades one unit only when its modeled edge exceeds two cents and the available cash funds the cost. A controlled one-dollar test verifies that three simultaneous candidate uses yield one funded position and two refusals, rather than three expenditures of the same dollar.

The same-information rival yields zero qualifying trades and zero simulated profit in both regions. Rival learning therefore changes the value of the strategy even while weather outcomes remain identical. Large gains against the weaker follower are exposed as dependence on that rival's weaker model and the scenario's liquidity/cost assumptions. They are not evidence of executable alpha. Simulation values are retained in the result files for inspection; they are not presented as trading results or promoted to the live allocator.

## Primary research and what it supports

[GenCast](https://arxiv.org/abs/2312.15796) generates stochastic global weather trajectories and evaluates spatial/temporal joint dependencies. Its global twelve-hour output and evaluation do not establish station-specific hourly or daily-settlement skill here. Its relevant principle is to evaluate joint predictive objects, not infer a daily-extreme distribution from unrelated marginal means. No GenCast model was deployed in this experiment.

[AlphaEvolve](https://arxiv.org/html/2506.13131v1) describes evolutionary program generation with executable evaluator feedback and multiple objectives. That supports the broader AI-building-AI research direction. Our implementation presently generates and selects fitted numeric learners; it does not reproduce AlphaEvolve, call Gemini, or evolve arbitrary source code. Code discovery would still need a physically and economically meaningful evaluator whose performance cannot be inflated by reusing future labels.

The authors' [AI-Powered Trading, Algorithmic Collusion, and Price Efficiency](https://finance-faculty.wharton.upenn.edu/wdou/2023/05/19/ai-powered-trading-algorithmic-collusion-and-price-efficiency/) studies interacting learning traders in a theoretical laboratory. It supports treating learning and price formation as coupled. Its mechanisms and reported behavior are not evidence about particular Kalshi participants and are not implemented here.

[Weak SINDy for PDEs](https://arxiv.org/abs/2007.02848) learns differential-equation structure using weak formulations that avoid fragile pointwise derivatives. The subsequent [consistency analysis](https://arxiv.org/abs/2211.16000) also identifies noise/model regimes with spurious-term discovery. This is directly relevant to empirically warranted relational climatology: a learned equation needs identifiable measurement support and noise assumptions. Four airport temperatures do not identify a complete atmospheric PDE, and this experiment implements neither WSINDy nor an atmospheric conservation-law solver.

[Aardvark Weather](https://www.nature.com/articles/s41586-025-08897-0) evaluates observation-to-global-to-station forecasting and end-to-end tuning. This is evidence that the observation operator and station-specific objective can be part of learning, rather than fixed preprocessing around a global solver. Its ten-day station evaluation does not establish hourly threshold or exact Kalshi settlement skill in our experiment. No Aardvark model was deployed here.

The original [Aurora Earth-system paper](https://www.nature.com/articles/s41586-025-09005-y) evaluates transfer across atmospheric chemistry, waves, tropical cyclone tracks and weather. The [current Aurora model documentation](https://microsoft.github.io/aurora/models.html) also describes Aurora 1.5 and its stochastic ensemble: hourly outputs, additional cloud/soil/land variables and correlated noise across substeps. Earlier six- or twelve-hour model descriptions therefore do not exhaust the available temporal resolution. Intermediate hourly outputs share the earlier six-hour input, and only the final substep updates the autoregressive state. Preserving that dependency matters when projecting trajectories to daily extremes. Their observation/input-domain requirements and coherent ensemble generation are scientifically relevant; these models and weights have not been installed, evaluated at our stations or made eligible for trading.

[ECMWF's current AIFS dataset documentation](https://www.ecmwf.int/en/forecasts/datasets/aifs-machine-learning-data) records operational deterministic and ensemble v2 systems and six-hour forecast steps. [The official open-data access instructions](https://confluence.ecmwf.int/pages/viewpage.action?pageId=663004119) describe changed stream names, JSON-lines field indexes and bounded byte-range retrieval. This provides a documented independent modeling family to evaluate alongside NBM, with shared initial analyses still an information dependency. Live acquisition, decoding and station skill were not demonstrated by reading these documents.

## Observed engineering and hosted use

`weather_weather_strategy_research` accepts `{"region":"nyc"}` or `{"region":"miami"}` on Cold Red Gate. The equivalent command is:

    node apps/weather.mjs strategy-research --region nyc

It fetches one bounded public IEM archive, generates the learners and strategies, and returns a compact study plus an evidence ID. `weather_weather_evidence` retrieves its lossless raw source, frozen fitted learners and complete admitted game plays. The exported scientific transform is `@red-cup-engineering/forecasting/weather-strategy-research`.

The tool needs no market listing and sends no orders. Its new archive carrier is excluded by the physical station replay's source boundary and cannot create calibration state. Existing physical and settlement scorers and all prior native weather tools remain available.

Reproduce the actual game-consumer checks, exact mixture score, causality, cash conservation, source/archive consumer effect and both empirical studies with:

    node data/records/2026-10-07-weather-strategy-generators/scripts/verify-engineering.mjs

The raw input fixtures remain at their original scientific record; no duplicate dataset was introduced. `nyc-result.json`, `miami-result.json` and `engineering-receipt.json` hold the scientific result and observed checks. `deployment-receipt.json` records installation of the twelve-tool weather source and its independently retained 49-file runtime. `live-tool-receipt.json` records successful hosted research calls for both regions, raw/fitted-evidence roundtrips, zero market reads and orders, and the isolated station replay rejecting both research packets without creating calibration state. A public health response of 200 was observed at 15:51 UTC. The shared house restarted again at 15:54 UTC; the last public-health request at 15:59 UTC failed, which the same receipt records separately. Public availability after that restart remains unverified. In-process backend verification does not by itself establish uninterrupted public availability.

The unresolved scientific and economic claims are prospective skill, richer and physically identifiable measurement operators, joint trajectories and exact settlement projections, resource-efficient generator improvement, opponent behavior inferred from clocked public market data, actual execution/fill costs, and net alpha robust to capable learning rivals. The active goal continues through those claims; none is settled by this record.
