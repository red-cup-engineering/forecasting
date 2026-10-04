# Kalshi coherence engine, 2026-10-04 (research and shadow only)

Thesis: Kalshi's markets are linked prices. Each live bid-ask is a local section (SignCell: bid = support for yes,
1 - ask = support for no); the sections over a family of related contracts must glue into one joint distribution.
Where they do not (the "both" corner: a Dutch book), a portfolio of takes has a guaranteed payoff. Gluing is an LP
(`src/coherence.mjs`): the margin LP finds the deepest global section; the take LP (its Farkas dual) finds the
fee- and depth-aware portfolio. LP solver: `src/simplex.mjs` (own dense two-phase simplex; no install).

## Families implemented (`src/coherence-families.mjs`)
1. interval-ladder: brackets of one event partition the line, ">= X" prices monotone (cell containment). Subjects are
   split by ticker so per-team spreads / player props do not collide.
2. exclusive-set: mutually exclusive non-numeric event (+ "none" cell); two/three-sided sports games assumed exhaustive (void/tie risk).
3. station-day: KXHIGH x KXLOWT of one CLI station-day on the joint (high, low) space, high >= low; Polymarket US high brackets join (`src/coherence-polymarket.mjs`, reuses polymarket-services-section matching).
4. window-union: "rain any day in window" (KXRAINWKND) = OR of KXRAIN daily markets, parsed from rule text.
Dormant for lack of coverage (only 1-2 of 7 days listed): weekly KXAVGT / KXWEEKHT vs daily; monthly vs weekly rain overlaps partially.

## Run
`node scripts/kalshi-coherence-scan.mjs [--polymarket] [--no-depth]` (live, appends post-fee books to `data/shadow-log.ndjson`),
`node scripts/kalshi-coherence-history.mjs --days 14`, `node scripts/kalshi-coherence-grade.mjs` (grades the shadow log at settlement),
`node --test test/coherence.test.mjs`.

## Findings
Live (3 scans, ~11,400 families, ~120k open markets, combos excluded; each violation re-solved on fresh order books):
- Raw (pre-fee) gluing failures: ~65 families per scan (~0.6%): ~39 exclusive-set, 11 ladder, 5-6 assumed-exhaustive, 4-5 window-union, 6-9 of 48 station-day.
- Post-fee, depth-limited Dutch books: 5-6 per scan, total guaranteed **$7-14 per scan**, none vanished on refresh.
  Persistent: KXMORTGAGERATE-27DEC30 T9.50 vs T9.75 monotone (925 lots, +$2.51, all 3 scans), KXNASDAQ100MINY (+$0.24, 3 scans), KXRAINWKND-OKC (2 scans).
  The rest are KXRAINWKND window-union (weekend priced below a single day) at $0.8-5.7 each, one scan, thin (cost $14-180).
- Station-day (high vs low) and exclusive sets: raw violations exist (0.2-1c margins) but are all killed by fees; fee per leg 0.07*P*(1-P) times many legs.
- Cross-venue (Polymarket US, 5 stations): one post-fee book of $0.03 (KXHIGHCHI, 5 lots). Risk: Kalshi KXHIGH now settles on "The Weather Company" per rules, Polymarket on the NWS climate report, so cross-venue books are not riskless.
- Earlier wrongly-grouped sports-spread ladders showed "$15k"; that was a grouping bug (two teams' spreads merged), fixed and tested. Treat any large number with suspicion.
History (settled hourly KXHIGH/KXLOWT candles, 14 days, 588 ladders, 280 station-days, 21k family-hours; last bid/ask per hour, non-simultaneous so an upper bound):
- Raw failures 12% of family-hours (mostly wide-spread noise); net of fee 0.12% (ladder) and 0.15% (station-day) of family-hours, median +0.5c, p90 +1.8c, max +2.1c per one-lot of each leg, every run 1 hour long.
Settlement-rule risk: flagged per detection (`risks`): mixed sources, void/tie, event-flag exclusivity, parsed rule text, cross-venue.

## Verdict
Not worth arming a general coherence lane: post-fee edge is ~$10 per full-universe scan, thin, mostly cents-per-lot, and persists at most minutes-to-scans outside a few stale long-dated ladders. Possibly worth a narrow shadow-only lane for window-union (weekend-vs-day rain) and long-dated monotone ladders, graded at settlement; the gluing tool is better used as a validity filter on the weather desk (do not sell a bracket whose neighbours' prices contradict it). Grading: 11 portfolios pending (`graded.json` after settlement).
