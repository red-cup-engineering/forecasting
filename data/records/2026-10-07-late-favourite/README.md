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

## Verdict

The late-favourite lane is not supported. The favourite-longshot "bias" in the in-sample all-minutes table is a look-ahead artefact of measuring distance to the last two-sided minute, and it does not trade.

- Pre-registered criterion failed: pooled out-of-sample R1 net P&L at C = 100 is -1.16 c per contract (event-jackknife SE 0.57 c; day SE 0.63 c), negative, not positive. R1rt is -1.48 c (SE 0.58). R2 is -0.49 c (SE 0.68), R2rt -0.78 c (SE 0.69). Of 9 series with n >= 30 under R1, only 3 are positive (ATP +0.01 c, NHL +1.18 c, LaLiga +3.99 c at n = 32); MLB, MLS, NCAAF, NFL, WNBA, WTA are negative.
- In-sample, applying the rule as a trader would (first qualifying minute, one entry per market) gives R1 +0.96 c (SE 0.78 c, t = 1.2) and R2 +0.23 c (SE 1.08 c), already far below the all-minutes headline (+2 c gap), and MLB is negative even in-sample (-1.3 c).
- Mechanism: "minutes before the last two-sided minute" is not known in real time. A favourite quoted at 0.97 within 10 minutes of the last two-sided minute is a favourite that is about to win (when the favourite loses, the book collapses through 0.5 to 0.01 and the last two-sided minute is far from the 0.97 quote). The exploratory minute-level table shows it: OOS mids 0.95-0.99 realise +2.2 c above mid in the last 10 minutes (SE 0.1 c) but -7.8 c at 90-240 minutes before the end (OOS-A); the effect is a function of distance to the end, not of the price level. Conditioning on distance to the end conditions on the outcome.
- "Terminal smooth regime": stay-age buckets do not rescue it. OOS first-entry cells with a long stay (R1: 15 entries at 60-240 min, 80 % hit, -17 c) are tiny and negative; the in-sample "since start" cells at 100 % hit are the same look-ahead selection (entry within the last 240 min of a game that then ended with the favourite still ahead). The bias does not concentrate in recently-crossed vs long-sat markets in any way that survives out of sample.
- Series with 100 % hit (soccer LaLiga, Ligue1, SerieA, UCL; n 16-32) have a degenerate jackknife SE (0.2 c); treat those SEs as meaningless. Pooled soccer is small and includes only markets that reached the band.

## Execution realism

- Candle volume: for R1 entries, the entry minute carried >= 10 contracts in 96 % of entries and >= 100 in 95 % (95 % / 94 % for R1rt); including the next 5 minutes, 97 % / 97 %. Volume is any trade, not only at our ask, so this is an upper bound on fills.
- Trade tape (50 random R1 entries after the 2026-08-08 historical cutoff, `GET /markets/trades`): contracts printed with the taker buying YES at or below our ask: >= 10 in 86 % of entry minutes, >= 100 in 86 %; within 5 minutes 96 % and 94 %. Fills at the quoted ask are feasible at C = 10 and C = 100 in most cases, and the quoted ask is not a phantom. The edge failure is statistical, not an execution one. (Entries before the cutoff were not sampled for the tape.)
- Hold: median 20 min from entry to the last two-sided minute (p10 1, p90 86), settlement follows within minutes. Capital turns fast, so even a small edge per trade would compound, but the net edge per trade is negative.

## Sizing (Kelly at event grain)

- Out of sample, taking the earliest entry per event (bets in one game are one bet): R1 net -0.87 c per contract at C = 100, loss clusters 4.9 %, full Kelly f* = 0, so 1.0-1.5 x f* = 0. R1rt f* = 0, R2 f* = 0.1 %, R2rt f* = 0.
- In-sample R1 alone implies f* = 23.8 % of bankroll (loss clusters 3.1 %, cluster mean return +1.0 %), R2 4.5 %. That is the number to expect a naive sizer to take from the in-sample table; the out-of-sample edge is negative and the in-sample edge was 1.2 SE, so no stake is sized.
- Averaging return ratios over all entries per event (both teams of one game, comeback games) gives a spuriously positive OOS mean (+0.2 %, f* 6 %) because the two-sided comeback events carry doubled capital; the per-entry and the first-entry-per-event measures are both negative. Do not use the ratio-of-doubled-capital figure.

## Deviations and notes

- OOS candles were fetched with the batch endpoint `GET /markets/candlesticks` (up to 10 000 requested candles per call) after the per-ticker route proved slow under a shared IP; the first 64 MLB markets used the per-series route and a spot check showed identical bid/ask series. Window per market is `close_time - 6 h .. close_time`, as in-sample. Pacing 450 ms, no 429 stop was triggered.
- OOS-A included NFL (94 markets, preseason/early Sept) and NCAAF (180 markets). OOS-B NHL covers preseason. KXWNBAGAME appears in both A and B and is pooled in the by-series table.
- R1 and R1rt coincide almost entirely: the first qualifying minute in the 6 h window nearly always lies within the final 240 minutes. R1rt is still the version that does not use the (look-ahead) end; its pooled result is -1.48 c.
- Reproduce: `node scripts/late-favourite-study.mjs fetch|tape|analyze` (cache dir default is the session scratchpad `late-oos/`). Raw OOS rows and `results.json` are in that cache, not in the repository.

## Tables

### In-sample (2026-09-05..10-06, NFL/NCAAF/MLB), pre-registered rules

**R1** (ask [0.95, 0.985], W1)

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 489 | 489 | 96.9 | 95.7 | 1.22 | 0.91 | 0.96 | 0.78 | 0.92 | 1.00 | 7/52/238 |
| KXMLBGAME | 107 | 107 | 94.4 | 95.6 | -1.17 | -1.36 | -1.32 | 2.23 | 2.37 | -1.40 | 4/26/67 |
| KXNCAAFGAME | 364 | 364 | 97.5 | 95.8 | 1.75 | 1.41 | 1.46 | 0.81 | 1.16 | 1.53 | 11/69/239 |
| KXNFLGAME | 18 | 18 | 100.0 | 95.2 | 4.78 | 4.40 | 4.45 | 0.09 | 0.04 | 4.66 | 0/55/91 |

**R2** (ask [0.9, 0.9499], W1)

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 606 | 592 | 91.9 | 91.2 | 0.72 | 0.18 | 0.23 | 1.08 | 1.28 | 0.24 | 11/66/238 |
| KXMLBGAME | 175 | 175 | 91.4 | 91.2 | 0.20 | -0.13 | -0.08 | 2.10 | 2.36 | -0.16 | 7/39/84 |
| KXNCAAFGAME | 396 | 382 | 92.7 | 91.2 | 1.43 | 0.82 | 0.87 | 1.26 | 1.48 | 0.94 | 16/92/240 |
| KXNFLGAME | 35 | 35 | 85.7 | 90.5 | -4.77 | -5.44 | -5.38 | 6.04 | 4.83 | -5.81 | 7/58/115 |

### Out-of-sample A+B pooled by series (A: Aug 1-Sep 4 MLB/WNBA/NCAAF/NFL; B: Sep 5-Oct 6 other series; WNBA spans both)

**R1** (ask [0.95, 0.985], W1)

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 1438 | 1396 | 94.9 | 95.8 | -0.91 | -1.21 | -1.16 | 0.57 | 0.63 | -1.20 | 1/20/86 |
| KXATPMATCH | 182 | 181 | 96.2 | 95.9 | 0.29 | -0.05 | 0.01 | 1.42 | 1.32 | 0.02 | 1/17/88 |
| KXBUNDESLIGAGAME | 25 | 25 | 96.0 | 95.9 | 0.12 | -0.21 | -0.16 | 3.97 | 4.02 | -0.20 | 0/8/53 |
| KXEPLGAME | 26 | 26 | 96.2 | 96.0 | 0.12 | -0.21 | -0.15 | 3.81 | 4.02 | -0.19 | 0/2/27 |
| KXLALIGAGAME | 32 | 32 | 100.0 | 95.7 | 4.28 | 3.93 | 3.99 | 0.18 | 0.15 | 4.17 | 0/6/65 |
| KXLIGUE1GAME | 23 | 23 | 100.0 | 95.5 | 4.48 | 4.11 | 4.17 | 0.17 | 0.12 | 4.36 | 0/1/35 |
| KXMLBGAME | 431 | 420 | 94.4 | 95.7 | -1.28 | -1.47 | -1.42 | 1.08 | 1.10 | -1.50 | 2/26/78 |
| KXMLSGAME | 65 | 60 | 92.3 | 95.8 | -3.51 | -3.85 | -3.79 | 3.11 | 4.27 | -3.93 | 0/3/26 |
| KXNCAAFGAME | 80 | 76 | 91.3 | 95.8 | -4.57 | -4.92 | -4.86 | 3.05 | 8.27 | -5.02 | 8/65/239 |
| KXNFLGAME | 47 | 44 | 91.5 | 95.5 | -4.02 | -4.38 | -4.33 | 3.91 | 3.18 | -4.53 | 3/19/63 |
| KXNHLGAME | 77 | 76 | 97.4 | 95.9 | 1.45 | 1.12 | 1.18 | 1.82 | 1.77 | 1.21 | 0/23/65 |
| KXSERIEAGAME | 24 | 24 | 100.0 | 96.2 | 3.79 | 3.48 | 3.53 | 0.22 | 0.25 | 3.67 | 0/1/19 |
| KXUCLGAME | 16 | 16 | 100.0 | 96.1 | 3.88 | 3.54 | 3.61 | 0.29 | 0.40 | 3.76 | 0/20/74 |
| KXWNBAGAME | 130 | 127 | 94.6 | 95.6 | -0.97 | -1.33 | -1.27 | 1.95 | 2.13 | -1.33 | 3/28/85 |
| KXWTAMATCH | 280 | 266 | 94.3 | 95.8 | -1.48 | -1.82 | -1.76 | 1.33 | 1.39 | -1.81 | 1/19/122 |

**R1rt** (ask [0.95, 0.985], W2)

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 1445 | 1398 | 94.5 | 95.8 | -1.23 | -1.53 | -1.48 | 0.58 | 0.68 | -1.53 | 1/21/90 |
| KXATPMATCH | 182 | 181 | 96.2 | 95.9 | 0.29 | -0.05 | 0.01 | 1.42 | 1.32 | 0.02 | 1/17/90 |
| KXBUNDESLIGAGAME | 25 | 25 | 96.0 | 95.9 | 0.12 | -0.21 | -0.16 | 3.97 | 4.02 | -0.20 | 0/8/53 |
| KXEPLGAME | 26 | 26 | 96.2 | 96.0 | 0.12 | -0.21 | -0.15 | 3.81 | 4.02 | -0.19 | 0/2/27 |
| KXLALIGAGAME | 32 | 32 | 100.0 | 95.7 | 4.28 | 3.93 | 3.99 | 0.18 | 0.15 | 4.17 | 0/6/65 |
| KXLIGUE1GAME | 23 | 23 | 100.0 | 95.5 | 4.48 | 4.11 | 4.17 | 0.17 | 0.12 | 4.36 | 0/1/35 |
| KXMLBGAME | 431 | 420 | 94.4 | 95.7 | -1.28 | -1.47 | -1.42 | 1.08 | 1.10 | -1.50 | 2/26/78 |
| KXMLSGAME | 65 | 60 | 92.3 | 95.8 | -3.51 | -3.85 | -3.79 | 3.11 | 4.27 | -3.93 | 0/3/26 |
| KXNCAAFGAME | 80 | 76 | 91.3 | 95.8 | -4.57 | -4.92 | -4.86 | 3.05 | 8.27 | -5.02 | 9/68/314 |
| KXNFLGAME | 47 | 44 | 91.5 | 95.5 | -4.02 | -4.38 | -4.33 | 3.91 | 3.18 | -4.53 | 3/19/63 |
| KXNHLGAME | 77 | 76 | 97.4 | 95.9 | 1.45 | 1.12 | 1.18 | 1.82 | 1.77 | 1.21 | 0/23/65 |
| KXSERIEAGAME | 24 | 24 | 100.0 | 96.2 | 3.79 | 3.48 | 3.53 | 0.22 | 0.25 | 3.67 | 0/1/19 |
| KXUCLGAME | 16 | 16 | 100.0 | 96.1 | 3.88 | 3.54 | 3.61 | 0.29 | 0.40 | 3.76 | 0/20/74 |
| KXWNBAGAME | 130 | 127 | 94.6 | 95.6 | -0.97 | -1.33 | -1.27 | 1.95 | 2.13 | -1.33 | 3/28/85 |
| KXWTAMATCH | 287 | 268 | 92.7 | 95.8 | -3.08 | -3.42 | -3.37 | 1.45 | 1.97 | -3.47 | 2/21/167 |

**R2** (ask [0.9, 0.9499], W1)

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 1564 | 1480 | 91.2 | 91.3 | -0.02 | -0.54 | -0.49 | 0.68 | 0.68 | -0.51 | 3/37/125 |
| KXATPMATCH | 212 | 198 | 91.5 | 91.4 | 0.10 | -0.50 | -0.45 | 1.81 | 1.91 | -0.46 | 3/29/125 |
| KXBUNDESLIGAGAME | 24 | 23 | 91.7 | 91.4 | 0.25 | -0.35 | -0.30 | 5.68 | 8.53 | -0.34 | 1/16/61 |
| KXEPLGAME | 29 | 28 | 93.1 | 91.2 | 1.90 | 1.29 | 1.33 | 4.66 | 4.40 | 1.41 | 1/4/85 |
| KXLALIGAGAME | 33 | 33 | 100.0 | 91.1 | 8.94 | 8.31 | 8.37 | 0.18 | 0.16 | 9.15 | 1/11/85 |
| KXLIGUE1GAME | 24 | 24 | 100.0 | 91.2 | 8.83 | 8.22 | 8.27 | 0.26 | 0.27 | 9.03 | 1/19/90 |
| KXMLBGAME | 469 | 445 | 90.8 | 91.2 | -0.36 | -0.69 | -0.64 | 1.26 | 1.29 | -0.72 | 9/47/114 |
| KXMLSGAME | 68 | 65 | 91.2 | 91.2 | -0.04 | -0.66 | -0.61 | 3.33 | 3.82 | -0.66 | 1/6/60 |
| KXNCAAFGAME | 81 | 73 | 87.7 | 91.6 | -3.93 | -4.51 | -4.47 | 3.35 | 7.78 | -4.79 | 21/95/205 |
| KXNFLGAME | 45 | 43 | 91.1 | 90.9 | 0.20 | -0.43 | -0.38 | 4.20 | 3.78 | -0.34 | 4/32/95 |
| KXNHLGAME | 88 | 86 | 92.0 | 91.2 | 0.83 | 0.22 | 0.27 | 2.83 | 3.85 | 0.29 | 3/35/91 |
| KXSERIEAGAME | 27 | 27 | 96.3 | 90.9 | 5.37 | 4.73 | 4.79 | 3.71 | 3.72 | 5.25 | 1/6/50 |
| KXUCLGAME | 17 | 17 | 100.0 | 91.6 | 8.41 | 7.83 | 7.87 | 0.34 | 0.30 | 8.57 | 2/23/240 |
| KXWNBAGAME | 131 | 125 | 91.6 | 91.3 | 0.34 | -0.27 | -0.22 | 2.34 | 2.56 | -0.21 | 7/49/240 |
| KXWTAMATCH | 316 | 293 | 89.6 | 91.3 | -1.72 | -2.33 | -2.28 | 1.62 | 1.56 | -2.39 | 5/37/217 |

**R2rt** (ask [0.9, 0.9499], W2)

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 1573 | 1484 | 91.0 | 91.3 | -0.30 | -0.83 | -0.78 | 0.69 | 0.71 | -0.82 | 3/37/131 |
| KXATPMATCH | 212 | 198 | 91.5 | 91.4 | 0.10 | -0.50 | -0.45 | 1.81 | 1.91 | -0.46 | 3/29/125 |
| KXBUNDESLIGAGAME | 24 | 23 | 91.7 | 91.4 | 0.25 | -0.35 | -0.30 | 5.68 | 8.53 | -0.34 | 1/16/61 |
| KXEPLGAME | 29 | 28 | 93.1 | 91.2 | 1.90 | 1.29 | 1.33 | 4.66 | 4.40 | 1.41 | 1/4/85 |
| KXLALIGAGAME | 33 | 33 | 100.0 | 91.1 | 8.94 | 8.31 | 8.37 | 0.18 | 0.16 | 9.15 | 1/11/85 |
| KXLIGUE1GAME | 24 | 24 | 100.0 | 91.2 | 8.83 | 8.22 | 8.27 | 0.26 | 0.27 | 9.03 | 1/19/90 |
| KXMLBGAME | 469 | 445 | 90.8 | 91.2 | -0.36 | -0.69 | -0.64 | 1.26 | 1.29 | -0.72 | 9/47/114 |
| KXMLSGAME | 68 | 65 | 91.2 | 91.2 | -0.04 | -0.66 | -0.61 | 3.33 | 3.82 | -0.66 | 1/6/60 |
| KXNCAAFGAME | 81 | 73 | 87.7 | 91.6 | -3.94 | -4.53 | -4.48 | 3.35 | 7.80 | -4.81 | 21/95/214 |
| KXNFLGAME | 45 | 43 | 91.1 | 90.9 | 0.20 | -0.43 | -0.38 | 4.20 | 3.78 | -0.34 | 4/32/95 |
| KXNHLGAME | 88 | 86 | 92.0 | 91.2 | 0.83 | 0.22 | 0.27 | 2.83 | 3.85 | 0.29 | 3/35/91 |
| KXSERIEAGAME | 27 | 27 | 96.3 | 90.9 | 5.37 | 4.73 | 4.79 | 3.71 | 3.72 | 5.25 | 1/6/50 |
| KXUCLGAME | 17 | 17 | 100.0 | 91.6 | 8.41 | 7.83 | 7.87 | 0.34 | 0.31 | 8.57 | 2/23/309 |
| KXWNBAGAME | 131 | 125 | 91.6 | 91.2 | 0.36 | -0.25 | -0.20 | 2.34 | 2.56 | -0.19 | 7/49/276 |
| KXWTAMATCH | 325 | 297 | 88.3 | 91.4 | -3.05 | -3.66 | -3.61 | 1.65 | 1.89 | -3.81 | 5/41/290 |

### OOS A totals

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | 644 | 625 | 93.9 | 95.7 | -1.75 | -1.99 | -1.94 | 0.91 | 1.07 | -2.03 | 2/27/90 |
| R1rt | 644 | 625 | 93.9 | 95.7 | -1.75 | -1.99 | -1.94 | 0.91 | 1.07 | -2.03 | 2/27/91 |
| R2 | 683 | 644 | 90.6 | 91.2 | -0.59 | -1.01 | -0.96 | 1.05 | 1.15 | -1.04 | 9/49/125 |
| R2rt | 683 | 644 | 90.6 | 91.2 | -0.59 | -1.01 | -0.96 | 1.05 | 1.15 | -1.04 | 9/49/125 |

### OOS B totals

| series | n | events | hit % | avg ask % | gross c | net c (C=10) | net c (C=100) | SE event c | SE day c | ROC % /trade | hold min p10/50/90 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| R1 | 794 | 771 | 95.6 | 95.8 | -0.23 | -0.57 | -0.52 | 0.71 | 0.75 | -0.53 | 0/15/82 |
| R1rt | 801 | 773 | 95.0 | 95.8 | -0.82 | -1.16 | -1.10 | 0.75 | 0.91 | -1.13 | 0/15/89 |
| R2 | 881 | 836 | 91.7 | 91.3 | 0.43 | -0.18 | -0.13 | 0.89 | 0.84 | -0.10 | 2/27/125 |
| R2rt | 890 | 840 | 91.2 | 91.3 | -0.08 | -0.69 | -0.64 | 0.90 | 0.92 | -0.64 | 2/28/145 |

Markets loaded: in-sample 1855, OOS-A 1392, OOS-B 2092. Fee multipliers: {"KXMLBGAME":0.5,"KXNCAAFGAME":1,"KXNFLGAME":1,"KXWNBAGAME":1,"KXATPMATCH":1,"KXBUNDESLIGAGAME":1,"KXEPLGAME":1,"KXLALIGAGAME":1,"KXLIGUE1GAME":1,"KXMLSGAME":1,"KXNHLGAME":1,"KXSERIEAGAME":1,"KXUCLGAME":1,"KXWTAMATCH":1}.

### Stay age before entry (minutes the mid has stayed above the band floor less 0.25c, censored at data start; first-qualifying-minute entries)

| set | rule | bucket | n | hit % | net c (C=100) | SE event c |
|---|---|---|---|---|---|---|
| inSample | R1 | stay<10m | 469 | 96.8 | 0.92 | 0.81 |
| inSample | R1 | stay10-60m | 2 | 100.0 | 1.86 | 0.00 |
| inSample | R1 | stay60-240m | 18 | 100.0 | 1.96 | 0.07 |
| inSample | R1rt | stay<10m | 469 | 96.8 | 0.92 | 0.81 |
| inSample | R1rt | stay10-60m | 2 | 100.0 | 1.86 | 0.00 |
| inSample | R1rt | stay60-240m | 18 | 100.0 | 1.96 | 0.07 |
| inSample | R2 | stay<10m | 553 | 91.7 | 0.22 | 1.15 |
| inSample | R2 | stay10-60m | 10 | 80.0 | -14.17 | 13.22 |
| inSample | R2 | stay60-240m | 43 | 97.7 | 3.73 | 2.34 |
| oosAll | R1 | stay<10m | 1418 | 95.0 | -1.00 | 0.56 |
| oosAll | R1 | stay10-60m | 5 | 100.0 | 3.17 | 0.56 |
| oosAll | R1 | stay60-240m | 15 | 80.0 | -17.27 | 10.68 |
| oosAll | R1rt | stay<10m | 1441 | 94.5 | -1.49 | 0.58 |
| oosAll | R1rt | stay10-60m | 1 | 100.0 | 4.66 | - |
| oosAll | R1rt | stay60-240m | 3 | 100.0 | 2.17 | 0.31 |
| oosAll | R2 | stay<10m | 1473 | 91.2 | -0.40 | 0.70 |
| oosAll | R2 | stay10-60m | 27 | 96.3 | 3.63 | 3.62 |
| oosAll | R2 | stay60-240m | 63 | 88.9 | -4.53 | 4.00 |
| oosAll | R2 | stay>=240m(or censored) | 1 | 100.0 | 8.42 | - |

### Exploratory minute-level calibration (every two-sided minute within 240 min of end; realised minus mid, event-jackknife SE)

| set | band | cut | bucket | minutes | events | mid % | hit % | gap c | SE c |
|---|---|---|---|---|---|---|---|---|---|
| inSample | mid[0.90,0.95) | stay age | age<5m | 3642 | 526 | 91.6 | 93.4 | 1.87 | 1.29 |
| inSample | mid[0.90,0.95) | stay age | 5-30m | 6346 | 425 | 92.7 | 95.7 | 3.05 | 1.13 |
| inSample | mid[0.90,0.95) | stay age | 30-120m | 1942 | 160 | 93.2 | 96.6 | 3.37 | 2.25 |
| inSample | mid[0.90,0.95) | stay age | >=120m/since start | 8534 | 122 | 92.8 | 96.6 | 3.75 | 1.61 |
| inSample | mid[0.90,0.95) | min to end | end-10m | 1239 | 262 | 92.6 | 94.2 | 1.59 | 1.74 |
| inSample | mid[0.90,0.95) | min to end | 10-30m | 3050 | 364 | 92.7 | 95.6 | 2.97 | 1.28 |
| inSample | mid[0.90,0.95) | min to end | 30-90m | 6915 | 380 | 92.6 | 96.5 | 3.89 | 1.07 |
| inSample | mid[0.90,0.95) | min to end | 90-240m | 9260 | 212 | 92.6 | 95.5 | 2.90 | 1.78 |
| inSample | mid[0.95,0.99] | stay age | age<5m | 2937 | 411 | 95.9 | 97.7 | 1.72 | 0.83 |
| inSample | mid[0.95,0.99] | stay age | 5-30m | 6595 | 352 | 96.9 | 98.8 | 1.93 | 0.52 |
| inSample | mid[0.95,0.99] | stay age | 30-120m | 3083 | 139 | 97.5 | 99.4 | 1.87 | 0.59 |
| inSample | mid[0.95,0.99] | stay age | >=120m/since start | 10122 | 105 | 97.4 | 100.0 | 2.58 | 0.11 |
| inSample | mid[0.95,0.99] | min to end | end-10m | 3177 | 417 | 97.5 | 99.3 | 1.82 | 0.34 |
| inSample | mid[0.95,0.99] | min to end | 10-30m | 4446 | 360 | 97.1 | 99.3 | 2.16 | 0.33 |
| inSample | mid[0.95,0.99] | min to end | 30-90m | 7188 | 285 | 96.9 | 99.2 | 2.25 | 0.44 |
| inSample | mid[0.95,0.99] | min to end | 90-240m | 7926 | 153 | 97.1 | 99.4 | 2.29 | 0.37 |
| oosA | mid[0.90,0.95) | stay age | age<5m | 4174 | 625 | 91.9 | 92.2 | 0.31 | 1.11 |
| oosA | mid[0.90,0.95) | stay age | 5-30m | 6135 | 507 | 92.8 | 91.1 | -1.71 | 1.62 |
| oosA | mid[0.90,0.95) | stay age | 30-120m | 828 | 115 | 93.3 | 91.1 | -2.19 | 4.39 |
| oosA | mid[0.90,0.95) | stay age | >=120m/since start | 1706 | 30 | 92.3 | 90.0 | -2.28 | 8.35 |
| oosA | mid[0.90,0.95) | min to end | end-10m | 992 | 294 | 92.8 | 98.2 | 5.38 | 0.81 |
| oosA | mid[0.90,0.95) | min to end | 10-30m | 2819 | 421 | 92.8 | 96.2 | 3.39 | 1.08 |
| oosA | mid[0.90,0.95) | min to end | 30-90m | 5905 | 405 | 92.5 | 92.3 | -0.11 | 1.49 |
| oosA | mid[0.90,0.95) | min to end | 90-240m | 3127 | 143 | 92.1 | 82.8 | -9.31 | 5.58 |
| oosA | mid[0.95,0.99] | stay age | age<5m | 3508 | 612 | 96.4 | 97.2 | 0.86 | 0.66 |
| oosA | mid[0.95,0.99] | stay age | 5-30m | 6964 | 465 | 97.3 | 98.5 | 1.23 | 0.61 |
| oosA | mid[0.95,0.99] | stay age | 30-120m | 1588 | 120 | 97.8 | 99.6 | 1.75 | 0.45 |
| oosA | mid[0.95,0.99] | stay age | >=120m/since start | 1321 | 22 | 97.3 | 89.9 | -7.41 | 6.78 |
| oosA | mid[0.95,0.99] | min to end | end-10m | 3771 | 590 | 97.7 | 99.8 | 2.17 | 0.12 |
| oosA | mid[0.95,0.99] | min to end | 10-30m | 4387 | 422 | 97.1 | 99.1 | 2.00 | 0.44 |
| oosA | mid[0.95,0.99] | min to end | 30-90m | 3606 | 242 | 96.8 | 96.8 | 0.06 | 1.31 |
| oosA | mid[0.95,0.99] | min to end | 90-240m | 1617 | 53 | 96.8 | 89.1 | -7.78 | 5.94 |
| oosB | mid[0.90,0.95) | stay age | age<5m | 4320 | 806 | 91.9 | 94.0 | 2.04 | 1.08 |
| oosB | mid[0.90,0.95) | stay age | 5-30m | 4241 | 461 | 92.7 | 94.5 | 1.84 | 1.50 |
| oosB | mid[0.90,0.95) | stay age | 30-120m | 1001 | 78 | 92.5 | 94.5 | 1.96 | 3.59 |
| oosB | mid[0.90,0.95) | stay age | >=120m/since start | 5215 | 53 | 92.6 | 96.2 | 3.55 | 2.30 |
| oosB | mid[0.90,0.95) | min to end | end-10m | 1682 | 586 | 92.7 | 99.4 | 6.75 | 0.26 |
| oosB | mid[0.90,0.95) | min to end | 10-30m | 2884 | 461 | 92.6 | 97.6 | 4.99 | 0.67 |
| oosB | mid[0.90,0.95) | min to end | 30-90m | 4569 | 350 | 92.3 | 96.3 | 3.97 | 0.93 |
| oosB | mid[0.90,0.95) | min to end | 90-240m | 5642 | 123 | 92.4 | 91.2 | -1.21 | 3.16 |
| oosB | mid[0.95,0.99] | stay age | age<5m | 3661 | 747 | 96.5 | 97.0 | 0.46 | 0.74 |
| oosB | mid[0.95,0.99] | stay age | 5-30m | 4421 | 437 | 97.4 | 98.0 | 0.57 | 0.74 |
| oosB | mid[0.95,0.99] | stay age | 30-120m | 1013 | 55 | 97.6 | 100.0 | 2.37 | 0.17 |
| oosB | mid[0.95,0.99] | stay age | >=120m/since start | 813 | 8 | 96.6 | 100.0 | 3.41 | 0.17 |
| oosB | mid[0.95,0.99] | min to end | end-10m | 3666 | 728 | 97.5 | 99.9 | 2.41 | 0.10 |
| oosB | mid[0.95,0.99] | min to end | 10-30m | 2993 | 351 | 97.0 | 98.9 | 1.94 | 0.46 |
| oosB | mid[0.95,0.99] | min to end | 30-90m | 2297 | 151 | 96.8 | 95.6 | -1.19 | 1.68 |
| oosB | mid[0.95,0.99] | min to end | 90-240m | 952 | 38 | 96.2 | 93.6 | -2.62 | 3.24 |

### Fill proxy from candle volume (OOS entries; share of entries whose entry-minute volume, or entry-minute plus next 5 minutes, is at least C contracts)

| rule | C | entry minute | +5 min |
|---|---|---|---|
| R1 | 10 | 96.0% | 97.4% |
| R1 | 100 | 94.6% | 96.9% |
| R1rt | 10 | 95.2% | 96.4% |
| R1rt | 100 | 93.8% | 95.8% |
| R2 | 10 | 94.3% | 96.7% |
| R2 | 100 | 91.6% | 95.5% |

### Trade tape (50 random R1 entries after the 2026-08-08 historical cutoff; GET /markets/trades; trades with yes price at or below our ask)

| window | taker-bought-YES contracts >= 10 | >= 100 | any trade >= 10 | any trade >= 100 |
|---|---|---|---|---|
| entry minute | 86% | 86% | 88% | 88% |
| +1 min | 90% | 88% | - | - |
| +5 min | 96% | 94% | 98% | 98% |

### Kelly (event-cluster grain)

| set | rule | entries kept | loss clusters % | net c/contract (C=100) | cluster mean r % | full Kelly f* | 1.5x f* |
|---|---|---|---|---|---|---|---|
| inSample | R1 (first entry per event) | 489 | 3.1 | 0.96 | 1.00 | 23.8% | 35.7% |
| inSample | R2 (first entry per event) | 592 | 7.9 | 0.39 | 0.41 | 4.5% | 6.8% |
| inSample | R1rt (first entry per event) | 489 | 3.1 | 0.96 | 1.00 | 23.8% | 35.7% |
| inSample | R2rt (first entry per event) | 592 | 7.9 | 0.39 | 0.41 | 4.5% | 6.8% |
| oosAll | R1 (first entry per event) | 1396 | 4.9 | -0.87 | -0.90 | 0.0% | 0.0% |
| oosAll | R2 (first entry per event) | 1480 | 8.3 | -0.01 | 0.01 | 0.1% | 0.1% |
| oosAll | R1rt (first entry per event) | 1398 | 5.1 | -1.07 | -1.11 | 0.0% | 0.0% |
| oosAll | R2rt (first entry per event) | 1484 | 8.5 | -0.20 | -0.19 | 0.0% | 0.0% |
