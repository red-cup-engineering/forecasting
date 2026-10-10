# Pre-game winner-price calibration on Kalshi, by sport (2026-07-01..10-06)

Reproduce: `node scripts/pregame-calibration.mjs enumerate && node scripts/pregame-calibration.mjs candles 25 && node scripts/pregame-calibration.mjs analyze`
(resume cache in `$CACHE`, default the session scratchpad `pregame-cache/`; public read-only endpoints, requests paced >= 420 ms, adaptive back-off on 429).

## Verdict

Kalshi pre-game winner prices are calibrated to within about one cent in aggregate. Pooled over 5,886 events / 15,167 markets the logistic slope of outcome on logit(mid) at T-5 is 1.033 (jackknife SE 0.030), i.e. no favourite-longshot distortion beyond noise; at T-60 it is 1.040 (0.029). Soccer (3,504 events, the largest sample) has slope 1.004 (0.041), intercept 0.005. The only statistically visible pre-game deviation is the pooled 0-0.1 band, longshots overpriced by 1.5c (SE 0.7, n=692), and a matching +1.9c (1.1) / +3.2c (2.0) in the 0.8-1.0 bands: the direction of lead 1 (favourites underpriced, longshots overpriced), about a tenth the size and not tradeable after fees. Lead 2 (soccer favourites 3-5c rich) is not supported by outcomes: soccer favourites with mid >= 0.70 realise 1.8c MORE than mid (SE 1.7) and 1.0c more than the ask (SE 1.7); a 3-5c overpricing would show up as -3 to -5, which is 2.8 to 4 SE away from the estimate. Whatever DraftKings says, Kalshi's soccer favourite prices are not rich against what actually happens. (This cannot say Kalshi is rich or cheap versus DraftKings, only versus realised frequencies.)

Pre-registered rules (below) have no robust edge: R1 and R2 are within +-2c of zero net in aggregate in both halves, S1 (sell the draw) is flat in Jul-Aug and loses 3.6c +-1.1 net in Sep-Oct. Per-sport rule results other than soccer have 20-100 events and SEs of 4-10c; none reproduces in both halves with the same sign and 2 SE.

## Method

- Universe: `GET /series?category=Sports`, tickers matching `^KX[A-Z0-9]+(GAME|MATCH|FIGHT)$`, minus esports, ITF/table-tennis, exact-score and novelty series; `GET /markets?status=settled` with close time 2026-07-01..10-06; series with >= 25 events with a usable start. Per-series event caps (systematic time sample, API budget): MLB 560 of 804, KBO 220, NCAAF 200 of 677, ATP/WTA 150 each of 510/562, WNBA 130, NFL 113 (all), NHL 102 (all), soccer leagues 40-80 each of 30-150 (3,637 soccer events over about 90 leagues), other series 40. The sample is therefore thin outside MLB/soccer.
- Start time, in order: (1) rules text "scheduled for <date> at <h:mm AM/PM> <TZ>" (MLB, KBO, NPB, KHL and most basketball/cricket/rugby series; TZ abbreviation parsed); (2) `occurrence_datetime` minus 3 h. Verified against ESPN scoreboards: NFL ATL@NO 00:15Z vs occurrence 03:15Z, EPL SUN@MNC 13:00Z vs 16:00Z, MAN@FUL 15:30Z vs 18:30Z, NHL SJ@DAL 00:00Z vs 03:00Z, WNBA LV@GS 20:00Z vs 23:00Z: always exactly +3 h; where rules text exists the offset is 3 h (basketball, hockey) or 4 h (baseball, rugby league, T20), so 3 h is the default and not baseball-safe, but baseball always has rules text. (3) ticker `yyMONddHHMM` read as ET (confirmed: `26OCT071600` = 4:00 PM EDT in the rules text). Sanity filter: events whose market closed before start+10 min or after start+12 h are dropped (cancelled, mis-dated, early-closed; this removes most of UFC and about a quarter of ATP/WTA). Median close minus start: NFL 3.1 h, NHL 3.0, WNBA 2.4, EPL 2.1, MLS 2.6, MLB 2.9, NPB 3.2, NCAAF 3.5. Tennis start (from occurrence minus 3 h) is NOT reliable (median close minus start 4.6 h, q10 2.1, q90 9.8): tennis quotes may be in-play, treat tennis rows as unreliable; the extreme-band tennis deviations are probably in-play leakage.
- Quotes: 1-minute candlesticks via `GET /markets/candlesticks` (batched tickers per time window), last candle with end_period_ts <= start-5 min (and <= start-60 min), using `yes_bid`, `yes_ask` closes; mid=(bid+ask)/2. Quote filter: bid and ask present and ask-bid <= 0.10. Two-way events fetch one side; the other side is the complement (bid'=1-ask, ask'=1-bid), so both sides enter every table (bands are mirror images). Three-way soccer events fetch all three markets (TIE included) and form one cluster.
- Calibration: 0.1-wide mid bands, realised minus mid in cents, delete-one-EVENT jackknife SE. Slope/intercept: logistic regression of outcome on logit(mid) (mid clipped to [.01,.99]), delete-one-event jackknife SE (grouped 100-way when > 900 events). Caveat: a band whose minority outcome never occurred (e.g. NCAAF 0-0.1, 37 events, no upsets) has a degenerate jackknife SE of about 0; do not read those as significant.
- Fee: 0.07 x fee_multiplier(series) x P x (1-P), P the price paid, unrounded, taker both sides, nothing at settlement. fee_multiplier is 1 for every series here except KXMLBGAME (0.5).
- Halves: H1 = start < 2026-09-01Z (Jul-Aug, in-sample), H2 = Sep-Oct (out-of-sample).

## Pre-registered rules (written in `pregame-calibration-analyze.mjs` before any calibration or P&L was computed)

- R1 (all families): at T-5, buy the YES of any market with ask in [0.70, 0.95] at the ask.
- R2 (all families): at T-5, buy NO (pay 1 - bid) on any market with yes bid in [0.03, 0.15].
- S1 (soccer family, one rule): at T-5, buy NO on the TIE market (sell the draw, pay 1 - bid) when TIE bid in [0.15, 0.45].
- One contract per qualifying market, held to settlement. Rules were applied to every sport; many cells, so single 2-SE cells among 60 are expected by chance.

## Coverage (events with a usable quote)

| sport | events | usable T-5 | usable T-60 |
|---|---|---|---|
| Soccer | 3637 | 3504 | 3401 |
| MLB | 560 | 559 | 559 |
| Tennis | 340 | 309 | 303 |
| Baseball-other | 338 | 321 | 291 |
| Hockey-other | 291 | 272 | 243 |
| NCAAF | 200 | 200 | 196 |
| Basketball-other | 167 | 167 | 151 |
| Other-2way | 140 | 108 | 107 |
| WNBA | 130 | 130 | 130 |
| NFL | 113 | 111 | 111 |
| NHL | 102 | 101 | 100 |
| Football-other | 78 | 76 | 73 |
| Rugby | 74 | 28 | 25 |

## Calibration at T-5 min (by sport; realised minus mid, cents; jackknife SE by event)

| sport | events | markets | logistic slope (SE) | intercept | 0-0.1 | 0.1-0.2 | 0.2-0.3 | 0.3-0.4 | 0.4-0.5 | 0.5-0.6 | 0.6-0.7 | 0.7-0.8 | 0.8-0.9 | 0.9-1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 5886 | 15167 | 1.033 (0.030) | 0.016 | -1.5 (0.7) n692 | -0.3 (0.9) n1545 | 0.3 (0.6) n4053 | -0.2 (0.8) n2525 | 0.7 (1.1) n2175 | -1.1 (1.1) n1885 | -0.7 (1.4) n1179 | 2.4 (1.7) n608 | 3.2 (2.0) n275 | 1.9 (1.1) n230 |
| Soccer | 3504 | 10403 | 1.004 (0.041) | 0.005 | -1.1 (0.9) n526 | 0.1 (0.9) n1408 | 0.5 (0.6) n3733 | -0.6 (0.8) n1843 | 2.1 (1.5) n1109 | -3.3 (1.8) n806 | -0.5 (2.1) n497 | 2.3 (2.5) n283 | 1.8 (3.0) n134 | -0.7 (3.0) n64 |
| MLB | 559 | 1118 | 1.388 (0.227) | 0.000 | - | - | -21.6 (5.5) n18 | -2.0 (3.7) n161 | -1.3 (2.5) n380 | 1.2 (2.5) n379 | 2.2 (3.7) n162 | 21.6 (5.5) n18 | - | - |
| Tennis | 309 | 618 | 1.317 (0.167) | -0.000 | -6.8 (0.5) n26 | -7.8 (5.3) n27 | -3.6 (5.0) n69 | -2.6 (4.7) n100 | 1.4 (5.3) n87 | -1.9 (5.4) n86 | 3.0 (4.7) n101 | 3.4 (5.1) n68 | 8.3 (5.1) n28 | 6.8 (0.5) n26 |
| Baseball-other | 321 | 642 | 0.865 (0.250) | 0.000 | - | - | -13.5 (9.1) n15 | 3.1 (4.5) n118 | 1.9 (3.7) n187 | -1.9 (3.7) n187 | -3.4 (4.6) n117 | 14.5 (8.6) n16 | - | - |
| Hockey-other | 272 | 544 | 1.131 (0.254) | -0.000 | - | - | 4.3 (8.0) n33 | -1.5 (5.0) n89 | -4.8 (4.1) n142 | 4.8 (3.8) n152 | 0.5 (5.1) n88 | -3.0 (7.6) n37 | - | - |
| NCAAF | 200 | 400 | 1.142 (0.149) | 0.000 | -3.3 (0.3) n74 | 0.4 (6.6) n32 | -0.2 (7.4) n36 | 6.7 (10.2) n24 | -1.0 (8.7) n34 | 1.0 (8.7) n34 | -6.7 (10.2) n24 | -0.4 (7.6) n35 | 0.2 (6.4) n33 | 3.3 (0.3) n74 |
| Basketball-other | 167 | 334 | 0.898 (0.162) | -0.000 | -5.4 (0.7) n19 | 1.6 (7.9) n24 | 4.0 (7.3) n40 | 10.2 (8.2) n39 | 3.4 (7.6) n44 | -5.2 (7.4) n44 | -7.7 (7.9) n41 | -4.0 (7.3) n40 | -1.6 (7.9) n24 | 5.4 (0.7) n19 |
| Other-2way | 108 | 216 | 1.062 (0.267) | -0.000 | -0.5 (4.3) n24 | -7.0 (6.8) n14 | 2.6 (9.6) n22 | 4.7 (10.2) n23 | -6.7 (10.4) n23 | 5.7 (8.8) n27 | -6.3 (10.5) n22 | -2.1 (9.7) n22 | 7.8 (6.4) n15 | 0.5 (4.3) n24 |
| WNBA | 130 | 260 | 1.199 (0.244) | -0.000 | 0.8 (8.3) n12 | -5.8 (6.2) n23 | -11.3 (6.3) n29 | 13.3 (9.4) n29 | -12.3 (7.9) n37 | 12.3 (7.9) n37 | -13.3 (9.4) n29 | 11.3 (6.3) n29 | 5.8 (6.2) n23 | -0.8 (8.3) n12 |
| NFL | 111 | 222 | 0.539 (0.277) | -0.000 | - | - | 10.0 (12.1) n17 | 12.9 (8.4) n35 | 6.3 (6.9) n53 | -6.3 (6.9) n53 | -12.9 (8.4) n35 | -10.0 (12.1) n17 | - | - |
| NHL | 101 | 202 | 1.585 (0.440) | -0.000 | - | - | -6.9 (10.8) n15 | -13.4 (7.1) n33 | 6.8 (7.1) n50 | -7.5 (6.9) n51 | 13.7 (7.1) n33 | 8.4 (10.2) n16 | - | - |
| Football-other | 76 | 152 | 1.543 (0.352) | -0.000 | - | - | -3.2 (9.3) n19 | -5.1 (9.5) n24 | -12.7 (10.6) n21 | 12.7 (10.6) n21 | 5.1 (9.5) n24 | 3.2 (9.3) n19 | - | - |
| Rugby | 28 | 56 | 0.640 (0.407) | 0.000 | - | - | - | - | - | - | - | - | - | - |

Bands with |dev|/SE >= 2 (n >= 30), T-5:

- NCAAF band 0-0.1: -3.3c (SE 0.3), n=74
- NCAAF band 0.9-1: 3.3c (SE 0.3), n=74
- ALL band 0-0.1: -1.5c (SE 0.7), n=692

## Calibration at T-60 min (by sport; realised minus mid, cents; jackknife SE by event)

| sport | events | markets | logistic slope (SE) | intercept | 0-0.1 | 0.1-0.2 | 0.2-0.3 | 0.3-0.4 | 0.4-0.5 | 0.5-0.6 | 0.6-0.7 | 0.7-0.8 | 0.8-0.9 | 0.9-1 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ALL | 5690 | 14137 | 1.040 (0.029) | 0.016 | -1.4 (0.8) n597 | 0.1 (0.9) n1476 | -0.2 (0.6) n3720 | -0.1 (0.8) n2266 | 0.0 (1.1) n2123 | -0.2 (1.2) n1781 | -0.8 (1.4) n1124 | 3.7 (1.7) n581 | 1.4 (2.1) n269 | 2.3 (1.2) n200 |
| Soccer | 3401 | 9559 | 0.998 (0.042) | -0.002 | -1.1 (1.0) n443 | 0.8 (1.0) n1324 | 0.0 (0.7) n3421 | -0.3 (0.9) n1618 | 0.1 (1.5) n1093 | -0.7 (1.8) n747 | -1.2 (2.2) n476 | 4.1 (2.4) n275 | -4.7 (3.7) n117 | 1.9 (3.1) n45 |
| MLB | 559 | 1118 | 1.427 (0.232) | 0.000 | - | - | -21.4 (5.8) n17 | -3.1 (3.7) n160 | -1.5 (2.5) n381 | 1.5 (2.5) n383 | 3.1 (3.7) n160 | 21.4 (5.8) n17 | - | - |
| Tennis | 303 | 606 | 1.364 (0.166) | 0.000 | -6.9 (0.5) n23 | -12.3 (3.3) n31 | -2.7 (5.2) n66 | -4.5 (4.8) n94 | 3.6 (5.3) n89 | -3.6 (5.3) n89 | 4.5 (4.8) n94 | 2.7 (5.2) n66 | 12.3 (3.3) n31 | 6.9 (0.5) n23 |
| Baseball-other | 291 | 582 | 0.846 (0.267) | -0.000 | - | - | -5.4 (11.2) n14 | 4.4 (4.7) n108 | 2.4 (3.8) n169 | -2.2 (3.9) n165 | -4.0 (4.7) n111 | 0.4 (11.6) n15 | - | - |
| Hockey-other | 243 | 486 | 1.157 (0.266) | 0.000 | - | - | -3.9 (7.6) n31 | 3.0 (5.5) n78 | -4.2 (4.3) n128 | 4.1 (4.1) n134 | -4.9 (5.7) n76 | 6.9 (6.9) n35 | - | - |
| NCAAF | 196 | 392 | 1.190 (0.163) | 0.000 | -3.5 (0.3) n69 | -0.7 (6.2) n34 | -2.0 (7.4) n34 | -1.6 (10.0) n24 | 0.9 (8.6) n35 | -2.1 (8.8) n34 | 3.1 (9.7) n25 | 2.0 (7.4) n34 | 0.7 (6.2) n34 | 3.5 (0.3) n69 |
| Basketball-other | 151 | 302 | 1.118 (0.192) | 0.000 | -5.1 (0.7) n19 | -6.3 (6.1) n23 | 5.4 (7.9) n35 | 1.1 (8.4) n33 | 3.8 (7.9) n41 | -3.8 (7.9) n41 | -2.1 (8.6) n32 | -4.4 (7.7) n36 | 6.3 (6.1) n23 | 5.1 (0.7) n19 |
| Other-2way | 107 | 214 | 1.038 (0.258) | 0.000 | -1.2 (4.5) n23 | -0.2 (8.5) n19 | -2.4 (9.9) n18 | 1.8 (9.6) n25 | -7.5 (11.0) n21 | 9.8 (10.0) n22 | -5.4 (9.8) n25 | 3.0 (10.0) n18 | 0.7 (8.6) n19 | 1.5 (4.3) n24 |
| WNBA | 130 | 260 | 1.159 (0.243) | 0.000 | 8.8 (11.1) n12 | -10.9 (4.3) n24 | -10.2 (6.7) n27 | 10.1 (9.4) n29 | -2.6 (8.1) n38 | 2.6 (8.1) n38 | -10.1 (9.4) n29 | 10.2 (6.7) n27 | 10.9 (4.3) n24 | -8.8 (11.1) n12 |
| NFL | 111 | 222 | 0.524 (0.285) | -0.000 | - | - | 7.9 (11.6) n18 | 8.7 (8.1) n38 | 9.5 (7.2) n50 | -9.4 (7.2) n50 | -8.7 (8.1) n38 | -7.9 (11.6) n18 | - | - |
| NHL | 100 | 200 | 1.400 (0.422) | -0.000 | - | - | -8.8 (10.3) n16 | -6.1 (8.5) n28 | 4.8 (6.8) n54 | -4.8 (6.8) n54 | 6.1 (8.5) n28 | 8.8 (10.3) n16 | - | - |
| Football-other | 73 | 146 | 1.653 (0.403) | -0.000 | - | - | -3.4 (9.4) n19 | -10.5 (9.5) n21 | -13.0 (10.5) n21 | 13.0 (10.5) n21 | 10.5 (9.5) n21 | 3.4 (9.4) n19 | - | - |
| Rugby | 25 | 50 | 0.495 (0.410) | -0.000 | - | - | - | 7.2 (15.9) n10 | - | - | - | - | - | - |

## Pre-registered rules at T-5 min, per contract, cents (gross = before fee; net = after taker fee). SE = delete-one-event jackknife of mean net.

| rule | sport | half | n | events | mean cost | gross | net | net SE | net ROI% |
|---|---|---|---|---|---|---|---|---|---|
| R1 buy fav YES @ask in [.70,.95] | ALL | Jul-Aug | 451 | 451 | 0.791 | 1.0 | -0.2 | 1.9 | -0.2 |
| R1 buy fav YES @ask in [.70,.95] | ALL | Sep-Oct | 635 | 635 | 0.794 | 2.7 | 1.6 | 1.5 | 2.0 |
| R1 buy fav YES @ask in [.70,.95] | ALL | both | 1086 | 1086 | 0.792 | 2.0 | 0.9 | 1.2 | 1.1 |
| R1 buy fav YES @ask in [.70,.95] | Soccer | Jul-Aug | 234 | 234 | 0.781 | 2.6 | 1.5 | 2.6 | 1.9 |
| R1 buy fav YES @ask in [.70,.95] | Soccer | Sep-Oct | 262 | 262 | 0.794 | 0.7 | -0.4 | 2.4 | -0.5 |
| R1 buy fav YES @ask in [.70,.95] | Soccer | both | 496 | 496 | 0.788 | 1.6 | 0.5 | 1.8 | 0.6 |
| R1 buy fav YES @ask in [.70,.95] | MLB | Sep-Oct | 17 | 17 | 0.732 | 15.1 | 14.4 | 7.9 | 19.6 |
| R1 buy fav YES @ask in [.70,.95] | MLB | both | 20 | 20 | 0.730 | 17.0 | 16.3 | 6.7 | 22.3 |
| R1 buy fav YES @ask in [.70,.95] | Tennis | Jul-Aug | 57 | 57 | 0.786 | -4.9 | -6.0 | 5.7 | -7.7 |
| R1 buy fav YES @ask in [.70,.95] | Tennis | Sep-Oct | 64 | 64 | 0.816 | 12.2 | 11.1 | 3.0 | 13.7 |
| R1 buy fav YES @ask in [.70,.95] | Tennis | both | 121 | 121 | 0.802 | 4.1 | 3.1 | 3.2 | 3.8 |
| R1 buy fav YES @ask in [.70,.95] | Baseball-other | both | 20 | 20 | 0.735 | 6.5 | 5.1 | 9.0 | 7.0 |
| R1 buy fav YES @ask in [.70,.95] | Hockey-other | Sep-Oct | 53 | 53 | 0.745 | -4.7 | -6.0 | 6.3 | -8.1 |
| R1 buy fav YES @ask in [.70,.95] | Hockey-other | both | 53 | 53 | 0.745 | -4.7 | -6.0 | 6.3 | -8.1 |
| R1 buy fav YES @ask in [.70,.95] | NCAAF | Sep-Oct | 79 | 79 | 0.829 | 4.5 | 3.5 | 3.7 | 4.2 |
| R1 buy fav YES @ask in [.70,.95] | NCAAF | both | 92 | 92 | 0.825 | 2.2 | 1.3 | 3.7 | 1.5 |
| R1 buy fav YES @ask in [.70,.95] | Basketball-other | Jul-Aug | 42 | 42 | 0.816 | -7.8 | -8.8 | 6.6 | -10.8 |
| R1 buy fav YES @ask in [.70,.95] | Basketball-other | Sep-Oct | 36 | 36 | 0.792 | 1.3 | 0.2 | 6.5 | 0.2 |
| R1 buy fav YES @ask in [.70,.95] | Basketball-other | both | 78 | 78 | 0.805 | -3.6 | -4.7 | 4.7 | -5.8 |
| R1 buy fav YES @ask in [.70,.95] | Other-2way | Jul-Aug | 18 | 18 | 0.832 | 11.3 | 10.3 | 5.5 | 12.4 |
| R1 buy fav YES @ask in [.70,.95] | Other-2way | Sep-Oct | 31 | 31 | 0.808 | -3.4 | -4.5 | 7.3 | -5.5 |
| R1 buy fav YES @ask in [.70,.95] | Other-2way | both | 49 | 49 | 0.817 | 2.0 | 1.0 | 5.1 | 1.2 |
| R1 buy fav YES @ask in [.70,.95] | WNBA | Jul-Aug | 43 | 43 | 0.810 | 7.4 | 6.3 | 5.0 | 7.8 |
| R1 buy fav YES @ask in [.70,.95] | WNBA | Sep-Oct | 22 | 22 | 0.849 | 6.0 | 5.1 | 6.1 | 6.1 |
| R1 buy fav YES @ask in [.70,.95] | WNBA | both | 65 | 65 | 0.823 | 6.9 | 5.9 | 3.9 | 7.2 |
| R1 buy fav YES @ask in [.70,.95] | NFL | Sep-Oct | 22 | 22 | 0.780 | -5.3 | -6.5 | 9.7 | -8.3 |
| R1 buy fav YES @ask in [.70,.95] | NFL | both | 25 | 25 | 0.772 | -5.2 | -6.4 | 9.2 | -8.3 |
| R1 buy fav YES @ask in [.70,.95] | NHL | Sep-Oct | 20 | 20 | 0.743 | 10.7 | 9.4 | 8.3 | 12.6 |
| R1 buy fav YES @ask in [.70,.95] | NHL | both | 20 | 20 | 0.743 | 10.7 | 9.4 | 8.3 | 12.6 |
| R1 buy fav YES @ask in [.70,.95] | Football-other | Jul-Aug | 23 | 23 | 0.803 | 6.6 | 5.5 | 6.7 | 6.9 |
| R1 buy fav YES @ask in [.70,.95] | Football-other | both | 31 | 31 | 0.796 | 7.5 | 6.3 | 5.8 | 8.0 |
| R1 buy fav YES @ask in [.70,.95] | Rugby | both | 16 | 16 | 0.794 | -10.7 | -11.8 | 11.7 | -14.8 |
| R2 buy NO @1-bid, bid in [.03,.15] | ALL | Jul-Aug | 461 | 461 | 0.898 | 1.7 | 1.1 | 1.3 | 1.2 |
| R2 buy NO @1-bid, bid in [.03,.15] | ALL | Sep-Oct | 500 | 500 | 0.906 | 1.0 | 0.4 | 1.2 | 0.5 |
| R2 buy NO @1-bid, bid in [.03,.15] | ALL | both | 961 | 961 | 0.902 | 1.3 | 0.7 | 0.9 | 0.8 |
| R2 buy NO @1-bid, bid in [.03,.15] | Soccer | Jul-Aug | 386 | 386 | 0.895 | 2.4 | 1.8 | 1.4 | 2.0 |
| R2 buy NO @1-bid, bid in [.03,.15] | Soccer | Sep-Oct | 394 | 394 | 0.903 | -0.2 | -0.8 | 1.5 | -0.9 |
| R2 buy NO @1-bid, bid in [.03,.15] | Soccer | both | 780 | 780 | 0.899 | 1.1 | 0.5 | 1.0 | 0.5 |
| R2 buy NO @1-bid, bid in [.03,.15] | Tennis | Sep-Oct | 24 | 24 | 0.922 | 7.8 | 7.3 | 0.5 | 7.9 |
| R2 buy NO @1-bid, bid in [.03,.15] | Tennis | both | 37 | 37 | 0.911 | 3.5 | 2.9 | 3.7 | 3.2 |
| R2 buy NO @1-bid, bid in [.03,.15] | NCAAF | Sep-Oct | 42 | 42 | 0.920 | 3.3 | 2.8 | 3.3 | 3.0 |
| R2 buy NO @1-bid, bid in [.03,.15] | NCAAF | both | 48 | 48 | 0.921 | 3.7 | 3.2 | 2.9 | 3.5 |
| R2 buy NO @1-bid, bid in [.03,.15] | Basketball-other | Jul-Aug | 19 | 19 | 0.920 | -7.8 | -8.3 | 8.3 | -9.0 |
| R2 buy NO @1-bid, bid in [.03,.15] | Basketball-other | both | 26 | 26 | 0.916 | -3.2 | -3.7 | 6.2 | -4.0 |
| R2 buy NO @1-bid, bid in [.03,.15] | Other-2way | both | 26 | 26 | 0.920 | 8.0 | 7.5 | 0.8 | 8.1 |
| R2 buy NO @1-bid, bid in [.03,.15] | WNBA | both | 26 | 26 | 0.902 | -1.8 | -2.4 | 6.4 | -2.6 |
| S1 soccer: buy TIE-NO @1-bid, bid in [.15,.45] | ALL | Jul-Aug | 1546 | 1546 | 0.753 | 1.2 | -0.0 | 1.1 | -0.1 |
| S1 soccer: buy TIE-NO @1-bid, bid in [.15,.45] | ALL | Sep-Oct | 1603 | 1603 | 0.754 | -2.3 | -3.6 | 1.1 | -4.8 |
| S1 soccer: buy TIE-NO @1-bid, bid in [.15,.45] | ALL | both | 3149 | 3149 | 0.754 | -0.6 | -1.8 | 0.8 | -2.5 |
| S1 soccer: buy TIE-NO @1-bid, bid in [.15,.45] | Soccer | Jul-Aug | 1546 | 1546 | 0.753 | 1.2 | -0.0 | 1.1 | -0.1 |
| S1 soccer: buy TIE-NO @1-bid, bid in [.15,.45] | Soccer | Sep-Oct | 1603 | 1603 | 0.754 | -2.3 | -3.6 | 1.1 | -4.8 |
| S1 soccer: buy TIE-NO @1-bid, bid in [.15,.45] | Soccer | both | 3149 | 3149 | 0.754 | -0.6 | -1.8 | 0.8 | -2.5 |

## Soccer favourites (3-way events, non-TIE markets), T-5: realised vs mid and vs ask

| mid band | n | events | mean mid | mean ask | realised | real - mid (SE) | real - ask (SE) |
|---|---|---|---|---|---|---|---|
| 0.4-0.5 | 1106 | 1105 | 0.445 | 0.452 | 0.467 | 2.1 (1.5) | 1.4 (1.5) |
| 0.5-0.6 | 806 | 806 | 0.546 | 0.552 | 0.512 | -3.3 (1.8) | -4.0 (1.8) |
| 0.6-0.7 | 497 | 497 | 0.645 | 0.651 | 0.640 | -0.5 (2.1) | -1.2 (2.1) |
| 0.7-0.8 | 283 | 283 | 0.747 | 0.754 | 0.770 | 2.3 (2.5) | 1.6 (2.5) |
| 0.8-1 | 198 | 198 | 0.874 | 0.881 | 0.884 | 1.0 (2.3) | 0.3 (2.3) |
| 0.7-1 | 481 | 481 | 0.799 | 0.807 | 0.817 | 1.8 (1.7) | 1.0 (1.7) |
| 0.6-1 | 978 | 978 | 0.721 | 0.728 | 0.727 | 0.6 (1.4) | -0.1 (1.4) |

## Reading the tables

- Coverage: "events" are events with start known and quotes fetched; the usable counts apply the spread and presence filter. Rugby is mostly unusable (one-sided or missing books).
- Calibration is tight where the sample is large (Soccer, MLB-mid bands, NCAAF mid bands). Largest non-degenerate deviations: MLB 0.2-0.3 / 0.7-0.8 at -21.6c (SE 5.5, only 9 events; small-sample, MLB 0.3-0.7 are all within 2.5c), WNBA/NHL/NFL bands of 10-13c with SE 6-12 (about 1.5 SE, 100-130 events), Soccer 0.5-0.6 at -3.3c (1.8). None of the large-sample bands exceeds 2.1 SE except the pooled 0-0.1 longshot band (-1.5c, SE 0.7).
- NFL slope 0.54 (0.28) and WNBA/NHL slopes 1.2-1.6 with SE 0.25-0.45 straddle 1 within about 1.7 SE; per-sport slope differences are not established with 100-130 events.
- Rule results: H1 vs H2 sign flips in most single-sport cells, which is what noise looks like; the one persistent cell is soccer R2 (+1.8c then -0.8c, so not persistent), WNBA R1 (+6.3, +5.1c, SE 5-6, 65 events, not significant) and S1 H2 (-3.6c, SE 1.1), which is a loss, not an edge.
