# Design note: a Mentions intelligence lane (no trading)

Status: design only. Nothing here places an order; the lane would emit a probability and a record, as the weather house model does, and the allocator decides separately.

## What the hand survey saw

Mentions markets ("will X say Y during <event>") are the one category where cheap contracts were not systematically overpriced. The 2026-10-03 base-rate record (`content/config/kalshi-category-base-rates.json`, category Mentions) shows 24h-ahead longshots (YES ask <= 5c, mean ask 3.5c) resolving YES 0 of 20, but 6h and 2h longshots at 1 of 6 and 1 of 7 (14-17% against a 3c price), with Wilson intervals that include the price on the low side and sit far above it on the high side. The samples are tiny (n = 6..20), so this is a lead, not a measurement. The mechanism is plausible: a longshot word is priced as a rare event, but once airtime is certain the question is simply whether the speaker's usual vocabulary reaches it, and a speaker's word frequency is estimable from public transcripts.

## The lane

Input: an open Mentions market (series such as KXTRUMPSAY; rules text names the speaker, the word or phrase, the window, and the accepted forms: plural, possessive). Output: `p_house` = P(phrase said within the window), recorded beside the market-implied price in a brief (`src/kalshi-market-brief.mjs` already carries a `house` slot and a Mentions MOVES entry).

Pricing by the house's own inference, in two stages so the model is never asked to guess a number from nothing:

1. Deterministic features (plain code, no model): from public transcripts of the same speaker and event type (rev.com, C-SPAN, White House briefing archives, the Federal Register, press-conference transcripts) count, per past event, whether the phrase or any accepted form appeared (word-boundary match, possessive and plural forms), the event's duration in words, and the speaker's per-1000-word rate for the phrase. Schedule features: events in the window (from the White House public schedule, Congress and agency calendars, earnings calendars), expected airtime and format (scripted address, press gaggle, interview, rally).
2. Inference for what features cannot give: dispatch a classification request through MetroPlat `inference_classify_inference_demand` then `inference_dispatch_inference` (house inference market, zero-cash carriers first) asking only for structured judgements -- "given today's news items and the agenda, how topical is this phrase for this speaker this week: 0..3, and why" -- with the transcripts' base rate in the prompt as evidence. `inference_record_inference_outcome` records which carrier answered and what it cost. The numeric probability is computed by a fixed rule: a Beta prior from the phrase's historical per-event hit rate, updated by Poisson-style airtime scaling and shifted by the topicality score through a coefficient fitted on past resolved markets. The model supplies the topicality score; the arithmetic is the house's.

Evidence is fused with the metrologic bilattice in `src/evidence-fusion.mjs` so that disagreement between transcript base rate and topicality remains visible as a wide interval rather than being averaged away.

## What would admit it

A lane is admitted to the allocator only after all of these hold on markets that had not closed when the model's parameters were frozen:

- Frozen before the test: the topicality coefficients and the prompt are committed (content-addressed) before the test window starts; the evaluation set is every Mentions market that opens afterwards, not a selection.
- Size: at least 60 distinct events across at least 5 distinct speakers or event types, over at least 3 weeks (the same minimum of 30 distinct events used by `derive-set-of-kalshi-edge-candidates.mjs`, doubled because the model has extra degrees of freedom).
- Calibration: the house Brier score is lower than the market-mid Brier score on the same markets (paired difference, bootstrap over events, lower 95% bound > 0), and the reliability curve in the 1-15% band is not worse than the market's.
- Money test, net of fee: buying YES when `p_house` exceeds the ask by more than the fee plus a margin, and selling (buying NO) when it falls below the bid by the same, shows positive EV per contract with the Wilson lower bound above zero in the held-out period, using the same fee model (taker 0.07*P*(1-P) ceil per order).
- Robustness: positive in each of the first and second halves of the test period, and not carried by one speaker.
- Cost: inference spend per market below a stated fraction (suggest 5%) of the position's expected edge, so the lane does not pay more for the opinion than the opinion earns.

Until then it publishes briefs (paper) only. A failed test is recorded as a finding, as with the weekly candidate run.

## Open points

- Rules vary by series (what counts as a mention, a live versus recorded source); the feature extractor needs a per-series rule parser, checked against resolved markets before anything is priced.
- Early-close markets resolve the moment the word is said, so the pricing question is a hazard rate over the window, not a single draw; use time-to-first-hit from transcripts, not just any-hit.
- The weekly candidate job's `category:Mentions` cells give a running read on whether the longshot underpricing persists, and are the cheapest early-warning for this lane.
