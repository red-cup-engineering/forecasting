# Combo rigidity: what the legs pin, what flexes, 2026-10-07

Shadow research. The work is read-only: it replays the combo lane's 10-03/04 tape. Code:
`src/combo-rigidity.mjs` (pure), `scripts/combo-rigidity-measure.mjs` (replay),
`test/combo-rigidity.test.mjs`. `src/simplex.mjs` now returns the dual of every optimum.

## The question

The 10-04 combo record found no maker edge against a copula fair value. It also found that 72% of
parlays are cross-game, so the copula barely matters. This record asks the prior question: before any
model, how much of a parlay's price do its own leg books force? Where do they leave it free?

## Theory

**The pebble forest: the score lattice.** A game's final score is a point x = (away, home) on the
integer quadrant. Each game-line contract is a region cut by lines in four directions:
- winner: x_t > x_o;
- spread: x_t − x_o ≥ N;
- team total: x_t ≥ N;
- game total: x_0 + x_1 ≥ N;
- BTTS: both teams score.

Kalshi writes the suffix N to mean "≥ N" (strike N − 0.5, `greater`; verified on the
live API for MLB/NCAAF spreads and NFL totals and team totals). The cells of the line arrangement
are the atoms. A belief is a measure on the cells, and each leg's [bid, ask] is a local section.

**Arthur and Merlin: the interval and its certificates.** A parlay B's flex interval is
[min q(B), max q(B)], taken over every measure q that all the quoted books admit. LP duality makes
each end a price:
- **max** is the cost of the cheapest leg portfolio whose payoff covers 1_B in every cell (the
  super-hedge);
- **min** is the proceeds of the richest leg portfolio that 1_B covers in every cell (the sub-hedge).

The solver plays Merlin and hands over the hedge. Arthur (`verifyHedge`) checks the payoff cell by
cell and re-prices the hedge at the quotes, without trusting the solver. A print above the
super-hedge is overpriced against its own legs whatever the dependence between them. A print below
the sub-hedge is underpriced.

**The double banana: count is not rank.** The interval is a point exactly when 1_B lies in the span
of the quoted indicators. Counting quotes against cells does not decide that.
- Take two games, each pinned by its own two winner books. The quote–cell incidence has a full
  matching: the pebble game places a pebble on every cell, so the count promises rigidity.
- The true rank is one short, because the two games' normalisations are one relation counted twice.
- The pair therefore flexes about one hinge, the dependence between the games. The swing of that
  hinge is the Fréchet interval.

This is the rigidity theorists' double banana: two rigid bodies joined at a hinge pass the Laman
count and still bend. It is now a test (`double banana: …`). `rigidity()` reports the count and the
rank side by side, and only the rank or the LP decides.

The same structure appears inside one game:
- the spread ladder pins the margin's marginal;
- the total ladder pins the sum's marginal;
- the joint of margin and sum is a hinge;
- the team-total ladders are the braces across it.

This is discrete tomography: the four line directions are four X-rays of the score distribution,
and the free part is their common kernel.

**Two hinge settings for a parlay.**
- *Pinned* hinge (games independent): the product of per-game intervals. This is a physical
  assumption, not a quoted fact.
- *Free* hinge: Fréchet over the per-game intervals. This is the only interval a static leg hedge
  certifies. Across sequential games a rolled hedge recovers the product, with price risk on the
  later legs.

A leg that is not a function of the score (player props, period totals) enters by Fréchet against
its game's score part.

**The verdict as FOUR.** The claim is "the parlay is worth at most P". It has two told sides:
- *supported* when a super-hedge costs ≤ P;
- *refuted* when a sub-hedge sells for > P.

Inside the flex neither side is told. When the legs admit no measure at all (a Dutch book among the
legs), both sides are told. The point is read through `four.mjs`. Adding a quote can only shrink the
interval (tested), so verdicts only climb the knowledge order. They can therefore be merged from any
order of book arrivals, coordination-free.

## Strategy space this partitions

| region of a print P against [lo, hi] | what speaks | maker action |
| --- | --- | --- |
| P > hi (free hinge) | the legs, model-free | sell the parlay, buy the super-hedge: locked |
| hi_free ≥ P > hi_pinned | the legs plus independence of games | sell; roll the hedge where games are sequential |
| lo ≤ P ≤ hi | nothing quoted: model or evidence only | quote only with an evidence edge, shaded by the width (winner's curse grows where makers' models diverge, i.e. with the flex) |
| P < lo | the legs | buy the parlay, sell the sub-hedge |
| legs incoherent | the legs contradict themselves | the Dutch book among the legs (coherence engine) comes first |

## Measurement 1: the coherence projection against Kalshi's own mids

`node scripts/leg-coherence-brier.mjs`. Each game's freshest score-line books at every hour boundary of
the 10-03/04 tape form one family:
- **Scoring:** both-sided books only, at most 15 min old. Mids are scored against their pairwise
  Frank–Wolfe projection, on the markets that settled.
- **Coverage:** 286 slices, 45 games, 1,320 settled forecasts.

| | value |
| --- | --- |
| slices whose mids admit no measure | 53 of 286 |
| mean Brier, mids | 0.15379 |
| mean Brier, projection | 0.15351 |
| slices where the projection scored worse | **0** (the theorem, checked) |
| settled outcomes that are no world of the lattice | 0 |

By sport, as mean Brier from mids to projection (incoherent slices / slices):
- **International friendlies:** 0.1557 → 0.1528 (12/22). This is the largest gain.
- **NFL:** 0.15384 → 0.15381 (6/132).
- **NCAAF:** 0.10851 → 0.10850.
- **Other sports:** the remaining sports move in the fifth decimal.

The guaranteed gain lives in thin books. Liquid NFL books are already coherent, so there the
projection is a correctness floor, not an edge.

The meter caught three defects on the way, all fixed:
- `teamSide` read `MIN` and `MIA` in `MIAMIN` as one team, a prefix match. The bug sat in the shared
  combo pricer, so the copula's same-team classes were also affected.
- Period and exact-score kinds (`1HSPREAD`, `1QSPREAD`, `EXACTMATCH`) were read as full-game spreads
  and match winners. `scoreRegion` now admits only the final-score kinds.
- Plain Frank–Wolfe stopped short of the projection, which broke the dominance bound in 42 slices.
  The pairwise version reaches it.

## Measurement 2: combo prints against their flex intervals

`node scripts/combo-rigidity-measure.mjs --rows rows.jsonl`. Each executed combo print on the 10-03/04
tape is priced from its legs' freshest books (at most 15 min old) at executable prices: the bid net of
the taker fee, the ask plus it.
- **Priced:** 167,810 prints. **Skipped:** 39,314 with no sampled RFQ, 1,497 with a stale leg.
- **Maker P&L:** per contract, for the side opposite the taker.
- **Standard errors:** a delete-a-game jackknife. Parlays sharing a game share its outcome, and
  per-print errors understate the spread about fifty-fold.

| zone (games independent, pinned hinge) | prints | settled | games | maker P&L / contract |
| --- | --- | --- | --- | --- |
| inside [lo, hi] | 155,239 | 32,842 | 704 | +2.3¢ ± 2.2¢ |
| above hi (median excess 0.06¢) | 10,382 | 1,859 | 560 | +1.8¢ ± 2.6¢ |
| below lo | 1,546 | 413 | 122 | +1.1¢ ± 7.8¢ |
| legs admit no measure | 643 | 143 | 190 | −3.2¢ ± 5.4¢ |

- **Free hinge** (the only model-free, statically hedgeable interval): 558 prints above the
  super-hedge and 118 below, 0.4% of prints together.
- **Same-game parlays** (59,982 prints; 27% hold a cluster the legs do not pin), maker P&L by flex
  width:

  | flex width | maker P&L / contract |
  | --- | --- |
  | narrow (≤ 0.063) | +0.7¢ ± 0.5¢ |
  | middle | +3.9¢ ± 2.6¢ |
  | wide (> 0.345) | 0.0¢ ± 5.4¢ |

**What one weekend says:**
1. **Pricing at the edge.** Kalshi's combo makers price at the edge of the legs' interval, not past
   it. Prints cluster at the pinned super-hedge and almost never cross the static one. There is no
   model-free arbitrage on this tape.
2. **Zones do not separate P&L yet.** The rigidity zones do not separate maker outcomes at this
   sample size. The correction matters: before the team-code fix and the jackknife, a first pass
   showed +5.5¢ ± 0.3¢ above the interval. That number came from the defects, not the market.
3. **Winner's-curse gradient unresolved.** The predicted gradient (worse realised edge where the
   flex is wide) is neither seen nor excluded. Resolving cent-level differences needs about ten
   times the settled games, about ten weekend slates.

The instrument is the deliverable. The certificate and verdict machinery is correct (Measurement 1
checks its theorem in every slice), and it now runs as a strategy in the combo arena. The edge, if
there is one, lives inside the flex, where evidence or finer structure must speak: the Wang-tile
period lattice and the pathwise identities.

## Measurement 3: pathwise identities across Kalshi sports, live 2026-10-07

`node scripts/pathwise-identities.mjs scan` (`src/pathwise-identities.mjs`). A pathwise identity is a
basket that pays the same amount in every world by the rules of the sport. The scanner verified about
85 such baskets against their rule text:
- NFL, NBA and NHL playoff seats and NFL round qualifiers;
- NFL win conservation (416 rungs, payoff 205–208 after a tie cap);
- relegation and top-4 counts;
- conference title-game pairs;
- every exclusive winner event;
- 541 game-winner pairs. An NFL tie settles both winners at $0.50, so a pair still sums to 1.

Each basket is priced at the touch with taker fees and projected exactly onto its identity, with
ladder monotonicity, by bisection on the multiplier.

**Result.** One basket clears fees: selling the NBA East playoff-seat basket (Σbids 8.27 against
8, +$0.09 per basket, one lot deep). Every other basket sits inside the fee wedge, including all 541
game pairs. Liquid baskets carry mids residuals of a few hundredths, for example NFL playoff seats
14.04 against 14 and league wins 208.44 against 208. Thin futures carry residuals of 0.5–1.8, too
wide to trade but large for the projection.

## Measurement 4: three backfilled weekends (872,018 prints, about 4,000 games)

Source: `scripts/combo-backfill.mjs` (public history), then `combo-rigidity-measure.mjs` unchanged.
Reports: `measure-2026-09-*.json`. Maker P&L is per contract at the print; errors are delete-one-game
jackknife.

**1. Zones do not separate maker P&L.** Prints above the pinned interval earn makers no more than
prints inside it:

| weekend | above | inside |
| --- | --- | --- |
| 09-26..28 | −0.0¢ ± 1.6 | +1.4¢ ± 1.7 |
| 09-19..21 | +1.9¢ ± 2.4 | +4.3¢ ± 1.7 |
| 09-12..14 | +1.6¢ ± 1.5 | +1.6¢ ± 2.6 |

That prediction of frame 1 is falsified.

**2. The parlay premium rises with flex width, on every weekend.** These are same-game clusters by
flex-width tercile:

| weekend | narrow | middle | wide |
| --- | --- | --- | --- |
| 09-26..28 | +0.5¢ ± 0.6 | +2.0¢ ± 1.5 | +4.3¢ ± 2.7 |
| 09-19..21 | +1.4¢ ± 0.5 | +3.0¢ ± 1.1 | +5.3¢ ± 1.0 |
| 09-12..14 | +0.5¢ ± 1.3 | +1.3¢ ± 0.9 | +3.9¢ ± 1.5 |
| pooled, inverse-variance | **+1.0¢ ± 0.4** | | **+4.8¢ ± 0.8** |

The wide-minus-narrow gap is about 3.8¢ ± 0.9. The winner's-curse prediction (makers do worse where
the flex is wide) is reversed: takers pay the largest premium where the legs pin the price least. This
reads as frame 12, the erasure premium: the parlay premium scales with the information its legs leave
unpriced.

**Not yet a lane:**
- These are print prices, so they belong to the winning maker. We would have to win RFQs.
- Combo maker fees are not modelled.
- Collateral is posted per RFQ.

**Pre-registered forward test F1** (committed 2026-10-08, before any October weekend is backfilled):
- **Data:** run `combo-backfill.mjs` then `combo-rigidity-measure.mjs`, both unchanged, on the
  weekends 2026-10-10..12, 10-17..19 and 10-24..26.
- **Same-game clusters:** the wide-tercile cut is fixed at width > 0.35, the pooled boundary above.
- **Pass:** maker P&L > 0 with t > 2 pooled over the three weekends, and wide > narrow
  (width ≤ 0.05) with t > 2.
- **Next step on a pass:** a shadow RFQ-quoting design for wide-flex same-game parlays. It needs the
  combo maker fee schedule and collateral sizing, sized per house theory: one cluster is one bet.
