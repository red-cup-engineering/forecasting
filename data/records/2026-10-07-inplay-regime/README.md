# In-play regime study: does game state sharpen the late-favourite edge? (2026-10-07)

Question. Late in games Kalshi game-winner favourites at 0.95-0.99 realise about 0.99. Obsmetrologia predicts the bias lives in the terminal smooth regime (no reachable firing can change the settled outcome, `smooth_is_terminal`). Test: label every minute by game state and compare.

## Rule (src/game-regime.mjs)

- Football (NFL, NCAAF): needed = ceil(margin / 8) trailer scoring possessions (TD + 2pt forces a tie); available = floor(secondsLeft / 150) + 1 if the trailer may hold the ball now (possession unknown counts for the trailer).
- MLB: needed = margin in runs; available = outs the trailing offence still has in regulation (1 run per out).
- terminal: needed > available. early: not terminal and first half (football > 1800 s left, MLB innings 1-4). contested: everything else, including tied games, overtime and extra innings.
- slack = available - needed; slack -1 is the marginal terminal.

## Method (scripts/inplay-regime-study.mjs)

638 games with ESPN wall-clock play-by-play joined to Kalshi settled winner markets with `matchGames`: NFL 64/64, NCAAF 300 (of 364 ESPN FBS finals; 340 matched, rest dropped for ambiguous side or no usable candles), MLB 274 (of 324 finals; 276 matched). 2026-09-05..10-06. One market per event: its 1-minute candles (bid/ask close, forward-filled up to 5 min; bid > 0, ask < 1, spread <= 0.10 required) turned into the favourite side (mid >= 0.5; the other side is the complement). State = latest play at or before the minute's end; minutes at or after the last play are dropped. 99,174 favourite-minutes. Fee 0.07 x multiplier x P(1-P), unrounded; multiplier from GET /series (NFL 1, NCAAF 1, MLB 0.5) overridden by the event's `fee_multiplier_override` where present. Rule trades: buy the favourite at the ask in [0.90, 0.985], hold, one trade per game per regime (first qualifying minute). SEs are delete-one-game jackknife. Calibration minutes within a game are strongly dependent, so only the game count is the effective n.

Caveats: ESPN wallclock is entry time (lags the true event by seconds, which is conservative); bands at mid >= 0.99 are mostly absent because ask = 1.00 is excluded; MLB 48 finals unmatched by name (e.g. "Chicago WS").

### Calibration, football (56281 favourite-minutes, 364 games)

| mid band | regime | minutes | games | mean mid | realised - mid | SE |
|---|---|---:|---:|---:|---:|---:|
| 0.50-0.80 | early | 14849 | 246 | 0.6582 | 0.0281 | 0.0252 |
| 0.50-0.80 | contested | 12246 | 184 | 0.6489 | 0.0483 | 0.0522 |
| 0.50-0.80 | terminal | 112 | 42 | 0.6755 | -0.0238 | 0.0973 |
| 0.50-0.80 | all | 27207 | 253 | 0.6541 | 0.0370 | 0.0302 |
| 0.80-0.90 | early | 5924 | 233 | 0.8498 | 0.0102 | 0.0261 |
| 0.80-0.90 | contested | 4537 | 225 | 0.8525 | 0.0122 | 0.0265 |
| 0.80-0.90 | terminal | 121 | 47 | 0.8572 | -0.0060 | 0.0642 |
| 0.80-0.90 | all | 10582 | 294 | 0.8510 | 0.0109 | 0.0233 |
| 0.90-0.95 | early | 3910 | 175 | 0.9254 | 0.0375 | 0.0169 |
| 0.90-0.95 | contested | 3643 | 238 | 0.9269 | 0.0163 | 0.0216 |
| 0.90-0.95 | terminal | 84 | 40 | 0.9262 | -0.0214 | 0.0737 |
| 0.90-0.95 | all | 7637 | 304 | 0.9261 | 0.0267 | 0.0159 |
| 0.95-0.97 | early | 2203 | 140 | 0.9599 | 0.0206 | 0.0143 |
| 0.95-0.97 | contested | 2220 | 204 | 0.9600 | 0.0211 | 0.0094 |
| 0.95-0.97 | terminal | 95 | 48 | 0.9612 | 0.0283 | 0.0107 |
| 0.95-0.97 | all | 4518 | 284 | 0.9600 | 0.0210 | 0.0109 |
| 0.97-0.99 | early | 3207 | 128 | 0.9804 | 0.0196 | 0.0003 |
| 0.97-0.99 | contested | 2887 | 233 | 0.9806 | 0.0128 | 0.0038 |
| 0.97-0.99 | terminal | 243 | 75 | 0.9818 | 0.0141 | 0.0042 |
| 0.97-0.99 | all | 6337 | 314 | 0.9805 | 0.0163 | 0.0018 |

### Calibration, mlb (42893 favourite-minutes, 274 games)

| mid band | regime | minutes | games | mean mid | realised - mid | SE |
|---|---|---:|---:|---:|---:|---:|
| 0.50-0.80 | early | 15349 | 274 | 0.6253 | 0.0187 | 0.0227 |
| 0.50-0.80 | contested | 10044 | 210 | 0.6484 | -0.0093 | 0.0259 |
| 0.50-0.80 | terminal | 54 | 6 | 0.5209 | -0.4098 | 0.5483 |
| 0.50-0.80 | all | 25447 | 274 | 0.6342 | 0.0068 | 0.0201 |
| 0.80-0.90 | early | 2478 | 148 | 0.8473 | 0.0014 | 0.0378 |
| 0.80-0.90 | contested | 5137 | 240 | 0.8533 | 0.0092 | 0.0260 |
| 0.80-0.90 | terminal | 39 | 24 | 0.8682 | 0.1318 | 0.0037 |
| 0.80-0.90 | all | 7654 | 265 | 0.8514 | 0.0073 | 0.0252 |
| 0.90-0.95 | early | 921 | 70 | 0.9214 | 0.0547 | 0.0155 |
| 0.90-0.95 | contested | 4034 | 247 | 0.9263 | 0.0144 | 0.0205 |
| 0.90-0.95 | terminal | 101 | 55 | 0.9310 | 0.0690 | 0.0017 |
| 0.90-0.95 | all | 5056 | 261 | 0.9255 | 0.0229 | 0.0168 |
| 0.95-0.97 | early | 236 | 22 | 0.9604 | 0.0396 | 0.0011 |
| 0.95-0.97 | contested | 1775 | 193 | 0.9603 | 0.0273 | 0.0067 |
| 0.95-0.97 | terminal | 129 | 64 | 0.9603 | 0.0087 | 0.0220 |
| 0.95-0.97 | all | 2140 | 206 | 0.9603 | 0.0276 | 0.0065 |
| 0.97-0.99 | early | 191 | 15 | 0.9794 | 0.0206 | 0.0013 |
| 0.97-0.99 | contested | 1679 | 155 | 0.9791 | 0.0055 | 0.0155 |
| 0.97-0.99 | terminal | 726 | 141 | 0.9824 | 0.0107 | 0.0050 |
| 0.97-0.99 | all | 2596 | 195 | 0.9800 | 0.0080 | 0.0112 |

### Calibration, all (99174 favourite-minutes, 638 games)

| mid band | regime | minutes | games | mean mid | realised - mid | SE |
|---|---|---:|---:|---:|---:|---:|
| 0.50-0.80 | early | 30198 | 520 | 0.6415 | 0.0233 | 0.0169 |
| 0.50-0.80 | contested | 22290 | 394 | 0.6486 | 0.0223 | 0.0312 |
| 0.50-0.80 | terminal | 166 | 48 | 0.6252 | -0.1493 | 0.1531 |
| 0.50-0.80 | all | 52654 | 527 | 0.6445 | 0.0224 | 0.0184 |
| 0.80-0.90 | early | 8402 | 381 | 0.8491 | 0.0076 | 0.0214 |
| 0.80-0.90 | contested | 9674 | 465 | 0.8529 | 0.0106 | 0.0185 |
| 0.80-0.90 | terminal | 160 | 71 | 0.8599 | 0.0276 | 0.0492 |
| 0.80-0.90 | all | 18236 | 559 | 0.8512 | 0.0094 | 0.0171 |
| 0.90-0.95 | early | 4831 | 245 | 0.9247 | 0.0408 | 0.0140 |
| 0.90-0.95 | contested | 7677 | 485 | 0.9266 | 0.0153 | 0.0148 |
| 0.90-0.95 | terminal | 185 | 95 | 0.9288 | 0.0279 | 0.0338 |
| 0.90-0.95 | all | 12693 | 565 | 0.9259 | 0.0252 | 0.0117 |
| 0.95-0.97 | early | 2439 | 162 | 0.9600 | 0.0224 | 0.0129 |
| 0.95-0.97 | contested | 3995 | 397 | 0.9601 | 0.0239 | 0.0060 |
| 0.95-0.97 | terminal | 224 | 112 | 0.9607 | 0.0170 | 0.0134 |
| 0.95-0.97 | all | 6658 | 490 | 0.9601 | 0.0231 | 0.0077 |
| 0.97-0.99 | early | 3398 | 143 | 0.9803 | 0.0197 | 0.0003 |
| 0.97-0.99 | contested | 4566 | 388 | 0.9800 | 0.0101 | 0.0062 |
| 0.97-0.99 | terminal | 969 | 216 | 0.9823 | 0.0115 | 0.0039 |
| 0.97-0.99 | all | 8933 | 509 | 0.9804 | 0.0139 | 0.0035 |

### Late-favourite rule, football: buy favourite at ask in [0.9, 0.985], hold, taker fee; first qualifying minute per game per regime

| variant | trades | win rate | avg ask | gross/contract | avg fee | net/contract | SE | ROI on cost | losing trades | worst | total net per 1 contract each |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 339 | 0.941 | 0.9243 | 0.0167 | 0.0048 | 0.0119 | 0.0128 | 0.013 | 20 | -0.953 | 4.02 |
| early | 213 | 0.958 | 0.9280 | 0.0297 | 0.0046 | 0.0251 | 0.0138 | 0.027 | 9 | -0.953 | 5.35 |
| contested | 273 | 0.945 | 0.9299 | 0.0152 | 0.0045 | 0.0107 | 0.0137 | 0.011 | 15 | -0.953 | 2.91 |
| terminal | 82 | 0.963 | 0.9541 | 0.0093 | 0.0030 | 0.0063 | 0.0209 | 0.007 | 3 | -0.972 | 0.51 |
| terminal&favLeads | 82 | 0.963 | 0.9541 | 0.0093 | 0.0030 | 0.0063 | 0.0209 | 0.007 | 3 | -0.972 | 0.51 |
| terminal&favTrails | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 | n/a | 0.00 |
| terminal-slack-1 | 81 | 0.963 | 0.9541 | 0.0089 | 0.0030 | 0.0059 | 0.0212 | 0.006 | 3 | -0.972 | 0.48 |
| terminal-deep(slack<=-2) | 2 | 1.000 | 0.9650 | 0.0350 | 0.0024 | 0.0326 | 0.0047 | 0.034 | 0 | 0.028 | 0.07 |
| not-terminal | 336 | 0.940 | 0.9241 | 0.0164 | 0.0049 | 0.0115 | 0.0129 | 0.012 | 20 | -0.953 | 3.87 |

### Late-favourite rule, mlb: buy favourite at ask in [0.9, 0.985], hold, taker fee; first qualifying minute per game per regime

| variant | trades | win rate | avg ask | gross/contract | avg fee | net/contract | SE | ROI on cost | losing trades | worst | total net per 1 contract each |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 263 | 0.916 | 0.9141 | 0.0022 | 0.0055 | -0.0032 | 0.0170 | -0.004 | 22 | -0.935 | -0.85 |
| early | 79 | 0.949 | 0.9118 | 0.0376 | 0.0056 | 0.0320 | 0.0246 | 0.035 | 4 | -0.916 | 2.53 |
| contested | 259 | 0.923 | 0.9197 | 0.0031 | 0.0051 | -0.0020 | 0.0165 | -0.002 | 20 | -0.935 | -0.52 |
| terminal | 132 | 0.985 | 0.9629 | 0.0220 | 0.0025 | 0.0195 | 0.0108 | 0.020 | 2 | -0.972 | 2.57 |
| terminal&favLeads | 132 | 0.985 | 0.9629 | 0.0220 | 0.0025 | 0.0195 | 0.0108 | 0.020 | 2 | -0.972 | 2.57 |
| terminal&favTrails | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 | n/a | 0.00 |
| terminal-slack-1 | 120 | 0.983 | 0.9633 | 0.0200 | 0.0024 | 0.0176 | 0.0119 | 0.018 | 2 | -0.972 | 2.11 |
| terminal-deep(slack<=-2) | 46 | 1.000 | 0.9650 | 0.0350 | 0.0023 | 0.0327 | 0.0028 | 0.034 | 0 | 0.019 | 1.50 |
| not-terminal | 263 | 0.916 | 0.9141 | 0.0022 | 0.0055 | -0.0032 | 0.0170 | -0.004 | 22 | -0.935 | -0.85 |

### Late-favourite rule, all: buy favourite at ask in [0.9, 0.985], hold, taker fee; first qualifying minute per game per regime

| variant | trades | win rate | avg ask | gross/contract | avg fee | net/contract | SE | ROI on cost | losing trades | worst | total net per 1 contract each |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 602 | 0.930 | 0.9199 | 0.0104 | 0.0051 | 0.0053 | 0.0103 | 0.006 | 42 | -0.953 | 3.17 |
| early | 292 | 0.955 | 0.9236 | 0.0318 | 0.0049 | 0.0270 | 0.0120 | 0.029 | 13 | -0.953 | 7.87 |
| contested | 532 | 0.934 | 0.9249 | 0.0093 | 0.0048 | 0.0045 | 0.0107 | 0.005 | 35 | -0.953 | 2.39 |
| terminal | 214 | 0.977 | 0.9595 | 0.0171 | 0.0027 | 0.0144 | 0.0104 | 0.015 | 5 | -0.972 | 3.09 |
| terminal&favLeads | 214 | 0.977 | 0.9595 | 0.0171 | 0.0027 | 0.0144 | 0.0104 | 0.015 | 5 | -0.972 | 3.09 |
| terminal&favTrails | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | 0 | n/a | 0.00 |
| terminal-slack-1 | 201 | 0.975 | 0.9596 | 0.0155 | 0.0027 | 0.0128 | 0.0111 | 0.013 | 5 | -0.972 | 2.58 |
| terminal-deep(slack<=-2) | 48 | 1.000 | 0.9650 | 0.0350 | 0.0023 | 0.0327 | 0.0027 | 0.034 | 0 | 0.019 | 1.57 |
| not-terminal | 599 | 0.930 | 0.9197 | 0.0102 | 0.0051 | 0.0050 | 0.0104 | 0.005 | 42 | -0.953 | 3.02 |


## Verdict

The regime label does not sharpen the edge per trade; it makes the trades safer.

- The favourite-longshot bias is present in every regime, not concentrated in the terminal one. Realised - mid in the 0.95-0.97 and 0.97-0.99 bands (all sports): early +0.022/+0.020, contested +0.024/+0.010, terminal +0.017/+0.012; the terminal differences from contested are inside one SE. The prediction that the bias concentrates in the terminal regime is not supported.
- Net per trade after fees (all sports, 1 contract): baseline +0.0053 (SE 0.0103, 602 trades), early +0.0270 (292), contested +0.0045 (532), terminal +0.0144 (SE 0.0104, 214). Terminal beats not-terminal (+0.0050) by about 0.009, under one SE of the difference. Early has the highest edge; that cell is longshot bias on heavy favourites, not a state effect. MLB baseline is negative net (-0.0032); MLB terminal is +0.0195 and MLB contested -0.0020.
- Same-ish edge, fewer and safer trades: terminal trades lose 2.3% of the time (5/214) against 7.0% baseline and 6.6% contested, with ask near 0.96 so the fee is about half (0.0027 vs 0.0051). The 5 losses are all slack -1 (a one-possession or one-out miss): comebacks happen at the margin.
- Deep terminal (slack <= -2): 48 trades (all MLB plus 2 football), 48 wins, net +0.0327 per contract (SE 0.0027, ROI 3.4%), the only cell with a clearly nonzero edge, but it is small (48 games, ask capped by the 0.985 band so the gain is bounded by about 0.035 per contract). The slack -1 terminal cell is +0.0128 (SE 0.0111).

Use: keep the rule as a risk filter, restrict entries to terminal with slack <= -2 (or require slack <= -1 and accept 2.5% losses at 0.96), and do not expect state conditioning to lift the headline edge. The study ran on one month; the deep-terminal count needs more games before sizing.


## Pre-registered prospective test: deep-terminal favourites (committed 2026-10-07, before any later game)

The deep-terminal cell (slack <= -2: 48 trades, 48 wins, net +0.0327) was found by slicing the regime
table, so it is a hypothesis, not evidence. It is tested forward only, on games after this commit.

- **Rule DT:** for each NFL, NCAAF or MLB game in progress (ESPN live scoreboard/summary state), compute
  `gameRegime` (src/game-regime.mjs) with the favourite as leader. When the regime is `terminal` with
  slack <= -2 and the Kalshi winner market's favourite-side ask lies in [0.90, 0.985] (bid > 0, ask < 1,
  spread <= 0.10, as in the study), buy the favourite at that ask. The favourite is the leading team and
  must be the Kalshi side priced >= 0.5. One entry per game (first qualifying poll), hold to settlement.
- **Fees:** Kalshi taker fee 0.07 x fee_multiplier x P x (1 - P) per contract, multiplier from
  `GET /series/{ticker}` overridden by the event's `fee_multiplier_override`.
- **Unit and errors:** one game is one cluster; standard errors are delete-one-game jackknife.
- **Verdict criterion, fixed now:** after at least 60 new games with an entry, mean net P&L per contract
  must be > 0 with t > 2. Otherwise the deep-terminal edge is dropped.
- **Shadow only:** no order until the verdict passes and the desk's owner admits the lane.
