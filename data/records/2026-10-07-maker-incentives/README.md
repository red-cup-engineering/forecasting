# Maker incentives on thin Kalshi books (2026-10-07/08)

Read-only study (public GETs only, no orders). Code: `scripts/maker-incentives-study.mjs` (`programs`, `now`, `history`, `simulate`, `report`), pure rules tested in `test/maker-incentives-study.test.mjs`. Live book snapshot of the sampled covered markets: `covered-markets-now.json`.

## Verdict

Not a lane today. Three findings:

1. **The programs are real, open to the public API, and the rule is exactly specified** (below), but the pools are small per market ($20-$600 per program; median $100, 1-7 days) and the book-already-qualifies test says the reward is a race to hold the *best-priced* 1000 contracts on both sides, which one entrant wins outright against today's books and rivals will split as soon as they notice.
2. **Shadow economics are negative without reward and reward does not close it.** 177 settled covered markets, 73 events, 12 events thin: resting at the touch, makers collect positive 1/5/30-minute mark-outs (they earn the half-spread against mid) but lose at settlement (the fills are the side that was wrong). Settlement P&L minus fees is -$3.4 per market-day at 1000 lots, queue-at-touch = today's median; reward at an optimistic 100% of the share the current book would give is +$1.2 per market-day; net -$2.1 (SE 1.7). In thin books it is worse and noisier: net@1 -$9.6/day (SE 8.8, 12 events). Projection filtering (F1/F2: quote a side only when projected fair is at least 1-2c through the quote) shrinks the loss on thick books (-8.7 to -2.3 reward-free) but not significantly on thin ones.
3. **The one lever that cannot lose, projection onto the coherent set, is not enough to pay the adverse selection** and in the dead-market corner (no two-sided quote, 136 of 177 history markets) the reward is the only income and is capped by the pool: ceiling pool/day ~ $14 median on ~$960 of capital = 1.5%/day at 100% share and 100% uptime, with fills on a news-driven market costing more than that in one event (KXTRUMPSAY events: -$148, -$108 per market-day-sum on thin books).

If anything is left, it is the narrow corner: the highest-pool-per-dollar markets (pool/day >= $100 on ~$900 capital, e.g. KXTRUMPMENTION, KXDIESELD, KXRT), quoted at the projected fair value only on the side where fair is >= 2c through, quote size 1000, tiny inventory cap, and a prospective test on at least 30 events before any capital. Needs: ~$1,000 per market, so ~$20-50k to hold 20-50 markets; the study cannot show positive return on it.

## Programs (sources)

* API: `GET /incentive_programs?status=&type=&limit=` (public, no signature needed; docs.kalshi.com/api-reference/incentive-programs/get-incentives). Fields: `market_ticker`, `incentive_type` (liquidity|volume|margin_maker_volume|margin_taker_volume), `incentive_description`, `start_date`, `end_date`, `period_reward` (**centi-cents**), `target_size_fp`, `discount_factor_bps`, optional `max_reward_per_account`. Every program found is `liquidity`; none of the other three types is active. No `max_reward_per_account` is set on any.
* Liquidity Incentive Program, help.kalshi.com/en/articles/13823851 ("program end: January 1, 2027; Kalshi can end or modify the program at any time"): "Kalshi takes a snapshot of the order book once per second, at a random moment within each second." "Reference Price ... walking down from the best bid, ... the first price level at which cumulative resting size reaches one fifth of the Target Size." "Orders priced at or better than the Reference Price get full credit (1.0x multiplier) ... below ... the Discount Factor raised to the number of ticks away." "Your raw score for an order = Order Size x Distance Multiplier"; normalized per side; "Your snapshot score is your share of the yes side plus your share of the no side." "Your reward = Your Time Period Score x Time Period Reward x (non-excluded snapshots / total snapshots)." Excluded snapshot: market not open, or "resting orders must meet the Target Size on both the yes side and the no side". Daily rewards "$1-$1,000 per market, per day"; time periods up to 31 days; minimum payout $1.00; "Final scoring occurs after a program ends", paid later as credits; US members only (non-U.S. users ineligible, brokers/FCMs/affiliates excluded); abusive behavior revokes participation. Where to find them: help.kalshi.com/en/articles/16076644 and kalshi.com/incentives.
* Sports Prop Combo component incentive: help.kalshi.com/en/articles/17184676 (2026-10-04 README `../2026-10-04-kalshi-combos/README.md`, CLIFF): pays maker *volume* (fills), not resting size; not a liquidity program and not in `/incentive_programs`.
* Fees: sampled series are `quadratic` (231 of 237) -> **maker fee 0**; `quadratic_with_maker_fees` (5 of 237) -> 0.0175 x C x P(1-P) per fill, rounded up to the cent (simulated; none of the historical sample had maker fees).

Active/upcoming programs at 2026-10-08T04:14Z (full table, from `report`):

| status | kind | programs | markets | pool $ | median pool $ | median days | target | discount |
|---|---|---|---|---|---|---|---|---|
| active | series_lip | 3870 | 3870 | 523480 | 100 | 7.0 | 1000 (some 300/500/2500) | 0.5 (some 0.4) |
| active | new_event | 1688 | 1688 | 151730 | 80 | 4.2 | 1000 | 0.5 |
| active | adhoc | 101 | 101 | 27200 | 100 | 7.0 | 1000/500/2500 | 0.5/0.9/0.4 |
| active | Nobel Prize liquidity rewards | 23 | 23 | 2300 | 100 | 6.4 | 1000 | 0.5 |
| upcoming | series_lip | 1069 | 1069 | 34760 | 20 | 0.0 | 1000/300 | 0.5 |
| upcoming | adhoc | 18 | 6 | 1800 | 100 | 7.0 | 1000 | 0.5 |

Closed programs seen: 14,207 (July 1535, Aug 3477, Sep 4271, Oct 4901): the program is a rolling new-listing subsidy, ~5,700 live at once, run-rate ~$185k/day summed over pool/duration (sum of pools, of which most is spread thinly: median program $100 for 7 days). Heaviest series by $/day: KXTEMPMIAH, KXRT, KXCRYPTOLEAD15M, KXCRITICSCHOICENOM, KXTRUMPAPPROVE, FX 15-minute, KXTRUMPMENTION, KXRAIN, KXYTVIEWSW.

## Covered markets now

Sample: 237 of 5,660 live programs (60% top by $/day, 40% random), orderbook via `GET /markets/{t}/orderbook`, event ladders/exclusive sets via `GET /events/{e}?with_nested_markets=true`, fair value = `brierProjection` of two-sided mids.

* two-sided books 209; **spread > 6c in 54**; one-sided or empty 28; median touch size 2,192 contracts; 108 have >= 1000 at the touch on both sides.
* 199 of 237 already satisfy the target on both sides (depth in the book is deep but scattered far from the touch). 136 belong to a ladder or exclusive family; of the 54 thin ones 28 have a projected fair and **12 differ from mid by >= 1c** (e.g. KXDIESELD-26OCT08-T6.275: 68c spread, fair - mid +14.5c; T6.280 -17c).
* Median $/day of the sampled programs: $100 (series_lip), $38 (new_event), $208 (adhoc). Join-the-touch share vs the *current* book, S=1000: median 8.6%, but 99-100% in books whose depth is scattered (KXTRUMPMENTION and others: any 1000-lot at a better price than the rest fills the target alone, because "orders that help reach the Target Size" are counted from the top and our price level is first); S=100: median 0 (cannot meet the target alone).
* Sum of estimated reward at join-touch over the 54 thin sampled markets: $2,057/day at S=1000 (median capital $830/market), $421/day at S=100. This is an upper bound: it assumes no rival posts 1000 at or inside the touch, which is what the reward rewards.

Top 25 by estimated reward are in `covered-markets-now.json`; the list is dominated by KXTRUMPMENTION (mention markets, $105/day, 1-13c spreads), KXDIESELD, KXNCAAFDELAY, KXTRUMPAPPROVE (31%), KXRT.

## Shadow simulation

Sample: closed liquidity programs ended in the last 28 days, 0.9-32 days long, excluding 15-minute series, random events with up to 3 markets each (seeded): 452 picked, 177 had settled (the rest outlive their program) -> 73 events, 41 series, median program length 1.4 days. 136 of the 177 never had a two-sided candle, 61 never traded.

Data: `GET /markets/trades` (exact tape), 1-minute candlestick bid/ask closes (chunked to the 10,000-candle cap), 60-minute sibling candles for the family projection, `GET /markets/{t}` result.

Assumptions (all stated, each a knob): (1) quotes are set each minute from the previous candle's bid/ask close; orders persist until the target price changes (then cancel/replace, queue reset); (2) rule J joins the best bid and ask; F1/F2 additionally drop a side whose fair-to-quote edge is below 1c/2c, fair = hourly Brier projection of sibling two-sided mids (leave-one-out when the market has none), falling back to mid; a side with no book quotes fair/last trade +/- 2c; (3) queue ahead at the touch = 0 / median live touch size (2,192) / 3x that; a trade through our price fills us outright; at our price it first eats the queue (pessimistic, `restBid` mirrors `arena.shadowRest`); (4) sizes 100 and 1000, inventory capped at +/- S; (5) fees per series type, 0 for all sampled; (6) reward = pool/day x current-book join-touch share (series median, else overall) x fraction of minutes both sides were quoted (a snapshot needs both sides at the target), no rival response, no snapshot randomness; net@c = settle - fees + c x reward with c = 1 optimistic and 0.25 for rivals; (7) mark-outs are against the candle mid 1/5/30 minutes after each fill; settlement P&L is exact. Not modelled: 1-second snapshot variance, cancellation latency, order-book depth history (only candles), self-impact.

Per market-day (S=1000), jackknife SE over 73 events:

| S | queue | rule | fills/mkt-day | settle P&L | fees | mark1 | mark5 | mark30 | reward (c=1) | net@0 | net@0.25 (SE) | net@1 (SE) | ret/day@0.25 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1000 | q0 | J | 3.24 | -3.57 | 0.00 | 2.39 | 1.76 | 1.47 | 1.21 | -3.57 | -3.27 (1.78) | -2.36 (1.77) | -0.34% |
| 1000 | q0 | F1 | 1.90 | -2.95 | 0.00 | 3.62 | 2.92 | 2.66 | 1.08 | -2.95 | -2.68 (1.62) | -1.86 (1.64) | -0.28% |
| 1000 | q0 | F2 | 1.68 | -2.13 | 0.00 | 3.64 | 2.94 | 2.81 | 0.75 | -2.13 | -1.95 (1.51) | -1.38 (1.49) | -0.20% |
| 1000 | qmed | J | 1.75 | -3.36 | 0.00 | 2.19 | 1.54 | 1.36 | 1.22 | -3.36 | -3.06 (1.71) | -2.14 (1.71) | -0.32% |
| 1000 | qmed | F1 | 1.46 | -2.81 | 0.00 | 2.92 | 2.30 | 2.13 | 1.09 | -2.81 | -2.54 (1.60) | -1.72 (1.62) | -0.26% |
| 1000 | qmed | F2 | 1.33 | -2.22 | 0.00 | 2.99 | 2.36 | 2.33 | 0.75 | -2.22 | -2.03 (1.50) | -1.47 (1.48) | -0.21% |
| 1000 | q3 | J | 1.67 | -2.98 | 0.00 | 2.39 | 1.63 | 1.62 | 1.23 | -2.98 | -2.67 (1.58) | -1.75 (1.58) | -0.28% |
| 1000 | q3 | F1 | 1.46 | -2.81 | 0.00 | 2.92 | 2.30 | 2.13 | 1.09 | -2.81 | -2.54 (1.60) | -1.72 (1.62) | -0.26% |
| 1000 | q3 | F2 | 1.33 | -2.22 | 0.00 | 2.99 | 2.36 | 2.33 | 0.75 | -2.22 | -2.03 (1.50) | -1.47 (1.48) | -0.21% |

Thin (median two-sided spread > 6c) vs thicker books, S=1000, qmed, per market-day (jackknife by event):

| books | rule | markets | events | fills/day | settle-fees | net@0.25 (SE) | net@1 (SE) |
|---|---|---|---|---|---|---|---|
| thin >6c | J | 21 | 12 | 19.25 | -12.57 (9.01) | -11.82 (8.95) | -9.58 (8.81) |
| thin >6c | F1 | 21 | 12 | 18.97 | -11.81 (8.92) | -11.26 (8.85) | -9.59 (8.66) |
| thin >6c | F2 | 21 | 12 | 18.76 | -11.39 (8.88) | -10.88 (8.81) | -9.38 (8.64) |
| thick <=6c | J | 20 | 11 | 2.93 | -8.67 (5.39) | -8.28 (5.40) | -7.10 (5.48) |
| thick <=6c | F1 | 20 | 11 | 1.26 | -5.77 (3.94) | -5.58 (3.95) | -5.01 (3.99) |
| thick <=6c | F2 | 20 | 11 | 0.58 | -2.32 (2.04) | -2.27 (2.02) | -2.11 (1.97) |
| no two-sided quote | J | 136 | 59 | 0.00 | 0.00 (0.00) | 0.27 (0.16) | 1.08 (0.63) |
| no two-sided quote | F1 | 136 | 59 | 0.00 | 0.00 (0.00) | 0.22 (0.14) | 0.90 (0.57) |
| no two-sided quote | F2 | 136 | 59 | 0.00 | 0.00 (0.00) | 0.15 (0.08) | 0.59 (0.33) |

(S=100 rows are in the script output; at S=100 everything is within +/- $0.2/day of zero because share is ~0.)

## Reading

* Short-horizon mark-outs are positive (+$1.4-3.0 per market-day at 1-30 min): the touch fill earns its half-spread against mid. The loss is at settlement: the bids that fill are the ones about to be wrong. That matches the 2026-10-04 combo finding (makers' adverse selection concentrates at result time) and why a maker on thin non-sports books loses what the spread pays.
* Projection helps exactly where the theory says (thicker books, F2: -8.7 -> -2.3 reward-free per market-day) because it removes quotes that are *through* fair, but in thin books fair itself is noisy and the loss is dominated by two or three news markets (KXTRUMPSAY-26OCT12 -148, KXTRUMPSAY-26SEP28 -108, KXOPENSOURCESHARE -92 summed market-day), SEs of $9.
* The reward is the only source of profit and it is bounded by the pool: median $14/market-day. It pays 1-5% of the S=1000 capital per day at best. Every rival who also posts 1000 at the touch halves it.
* The no-quote corner (136 markets) is the only place the reward is nearly risk-free (no fills in the tape of 61 of them) but the pool there is a few dollars a day.

## What it needs

Capital ~ S per market ($960 at S=1000 since yes bid + no bid at near-touch prices lock ~S dollars in total), so 20 markets = ~$20k, realistically 50 markets = ~$50k to earn $50-700/day if no rivals appear; the shadow says expected adverse selection exceeds that. Before capital: (a) a prospective paper run with real queue positions (`GET /portfolio/orders` queue_position, signed) on <= 10 high-pool-per-dollar markets, scored against the final paid credit; (b) per-event inventory limits; (c) measure rival crowding by reading the final credit against the pool (the number the book cannot show).

## Caveats

Candles are quote changes, not full depth history, so queue and the competitor share are scenarios; the shadow's settled subset excludes markets that outlive their programs; mention markets (KXTRUMPMENTION) had no settled history in the sample; 12 thin events is a small cluster count. None of this changes the sign, which is robust to c from 0 to 1.
