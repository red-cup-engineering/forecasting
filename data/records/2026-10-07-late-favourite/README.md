# Late-favourite study (2026-10-07)

Public read-only Kalshi data. No order was placed. Code: `services/forecasting-service/scripts/late-favourite-study.mjs`.

## Pre-registration (written before any out-of-sample outcome was read)

Universe: binary game-winner markets (one YES contract per outcome; soccer markets include the TIE market, each handled as its own binary market) in series KXNFLGAME, KXNCAAFGAME, KXMLBGAME (in-sample, settled 2026-09-05..10-06) and the out-of-sample series below. Data are 1-minute candlesticks over the 6 hours before each market's `close_time`.

Common mechanics for every rule:

- Entry price P = `yes_ask` close of the entry minute (a taker buy of YES). Only two-sided minutes count (bid > 0, ask < 1).
- One entry per market (the first qualifying minute). Entries in the same event are one cluster for inference and sizing.
- Hold to settlement. Payoff 1 if the market resolves YES, else 0.
- Fee per order of C contracts = ceil-to-cent(0.07 x fee_multiplier x C x P x (1-P)), fee_multiplier read from `GET /series/{ticker}` (KXMLBGAME 0.5, all other series here 1). Evaluated at C = 10 and C = 100. Net P&L per contract = outcome - P - fee/C.
- The last two-sided minute ("end") is the last candle with a two-sided quote; "minutes before end" is measured from it.

Rules:

| id | ask band | time window |
|---|---|---|
| R1 | [0.95, 0.985] | within 240 min of end (W1) |
| R2 | [0.90, 0.95) | within 240 min of end (W1) |
| R1rt | [0.95, 0.985] | any minute of the fetched 6 h before close (W2) |
| R2rt | [0.90, 0.95) | any minute of the fetched 6 h before close (W2) |

R1/R2 replicate the in-sample finding but are not tradable as written: "end" is known only after the fact (look-ahead). R1rt/R2rt do not use the end; they are the implementable variants (they still bound the window by `close_time`, which for these series is the moment a winner is declared, so they are also optimistic about knowing the game is nearly over; the 6 h bound is the proxy for "in the final hours").

Out-of-sample sets (disjoint from the in-sample series-and-dates):

- A: settled 2026-08-01..09-04: KXMLBGAME, KXWNBAGAME, KXNCAAFGAME, KXNFLGAME.
- B: settled 2026-09-05..10-06: KXNHLGAME, KXWNBAGAME, KXEPLGAME, KXUCLGAME, KXLALIGAGAME, KXSERIEAGAME, KXBUNDESLIGAGAME, KXLIGUE1GAME, KXMLSGAME, KXATPMATCH, KXWTAMATCH.

Statistics: n entries, n events, hit rate, mean net P&L per contract, delete-one-EVENT and delete-one-DAY jackknife SE, return on capital per trade (net P&L / (P + fee/C)), hold-time distribution (entry to end). Verdict criterion fixed in advance: the lane is supported only if out-of-sample R1rt (or R1) net P&L per contract at C = 100 is positive and exceeds 2 event-jackknife SE in the pooled out-of-sample set, with the same sign in at least half of the sport series with n >= 30.

Kelly: empirical full Kelly at event-cluster grain, f* = argmax mean log(1 + f r) over event clusters, r = cluster P&L / cluster capital; house sizing 1.0-1.5 x f*.

Exploratory (not pre-registered, labelled as such): minute-level realised-minus-mid by stay age and by minutes-to-end.

## Pre-OOS note on the in-sample data

Applying R1/R2 (first qualifying minute only) to the cached in-sample rows already gives a much smaller edge than the all-minutes headline: see the in-sample table below once results are filled in.
