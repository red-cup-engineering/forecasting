# Kalshi sports edges backtest, 2026-10-03 (junior engineer slice for info-e1)

Result: NO edge survives out of sample with positive lower CI. No desk lane written (per brief). Paper-only, no orders.

Data: settled Kalshi game-winner markets closed in the last 24 days (public API, 1-min candles incl. bid/ask close, trade low/high),
3017 markets: KXNFLGAME 98, KXNCAAFGAME 774, KXMLBGAME 518, KXWNBAGAME 80, KXNHLGAME 160 (preseason), KXEPLGAME/UCL/LALIGA/BUNDES/SERIEA/LIGUE1/MLS soccer, KXATPMATCH 310, KXWTAMATCH 552. KXNBAGAME 0 (offseason).
Fees: taker 0.07*mult*P(1-P) ceil-to-cent on a 100-lot (KXMLBGAME multiplier 0.5), maker 0.0175*mult*P(1-P) on quadratic_with_maker_fees series. fee_type per series read from /series.
ESPN: final events for NFL, NCAAF, MLB, WNBA, NHL, 7 soccer leagues; matched to Kalshi by team name prefix + start/close window (NFL 49/49, NCAAF 213/237, MLB 214/273, WNBA 40/40, NHL 80/86, soccer ~123/183). Odds = ESPN pickcenter moneyline, first provider (DraftKings), the pre-game/closing line as ESPN exposes it for past games. Win probability = ESPN summary winprobability joined to play wallclock. Tennis has no ESPN odds/WP here, so tennis is in (a) only. Window is only ~3.5 weeks; fit/test split at the median date.

Scripts (scripts/): kalshi-sports-collect.py, espn-sports-collect.py, kalshi_espn_match.py, kalshi_sports_lib.py, kalshi-sports-near-close.py (a), kalshi-sports-pregame.py (b), kalshi-sports-live.py (c), kalshi-sports-collect-lowhigh.py + kalshi-sports-edge-scan-leads.py (d). Raw data lives in the session scratchpad (not committed).

## (a) Favorites bought at ask 90-98c (first crossing, any time, next-minute ask fill, taker fee) - a-first-crossing-favorites.txt
All sports 0.90-0.98: n=1256 games, win 93.6% [92.1,94.8], avg price 92.4c, EV/ct +0.7c, CI [-0.65c,+2.1c]; fit +0.65c, test +0.77c. Not significant.
By sport: ATP n=132 +3.8c CI [+0.8,+6.7] but 61/61 in one week then 93.9% (+0.6c, CI includes 0) in the latest third: fails fit/test (a2-tennis-breakdown.txt). MLB +0.0c, NCAAF +0.4c, NFL -3.3c (n=45), WNBA -2.7c, WTA +0.5c, NHL +1.2c, soccer +2.0c CI [-1.2,+5.1]. None clears.
"minutes to close" splits (0-30 min: +4.2c CI [+2.6,+5.7]) use the close time, which is only known after the winner is declared: LOOK-AHEAD, not tradable. 120+ min before close: -1.4c.
Verdict: favorites at 90-98c are priced about right; fees eat the residual.

## (b) Pre-game Kalshi vs de-vigged ESPN/DraftKings moneyline - b-pregame-vs-book.txt
552 games. Brier: book 0.1892, Kalshi mid 0.1888. Mean |book - Kalshi mid| = 0.94c. Betting the best side when book prob - Kalshi ask > 2c: n=19, EV -6.8c; > 3c: n=2; > 5c: none. Kalshi pre-game is as efficient as the sportsbook; no edge.

## (c) Live ESPN win-prob vs Kalshi 1-min (NFL, NCAAF, MLB, WNBA, NHL; no soccer WP) - c-live-*.txt
Signal: ESPN prob - Kalshi mid > thr at an ESPN update (observed after feed lag), fill at the ask after order lag, taker fee, first signal per game. With 30s feed + 60s order lag: all thresholds 3-12c have EV between -4.5c and +2.8c, all CIs span 0; test half is negative for thr 3,5c. ESPN prob at entry exceeds realized win rate (0.52-0.59 vs 0.45-0.48): ESPN is the noisier side, Kalshi is not lagging. Only lead: MLB with thr 8c + 2 consecutive updates: n=99, +8.1c, CI [-1.1,+17.3]; fit +9.0c (n=44), test +7.4c (n=55, CI [-4.5,+19.2]). Same sign in both halves but not significant; at ZERO latency n=82 +10.7c CI [+0.2,+21.2] which is not achievable by polling. Not promoted; it is the one cell worth forward paper observation, and it is one of ~32 cells so multiple comparisons apply.

## (d) Weekly edge-scan leads, realistic fills - d-edge-scan-leads-realistic-fill.txt
Maker model: rest a bid at the best bid at T; fills only if a later minute traded strictly below it (strict) or at/below (optimistic); maker fee applied. Adverse selection is visible: filled orders win less than unfilled (80.5% vs 100%).
L1 (sports, 2h before close, YES ask 81-90c): n=210 games, win 83.3% vs avg price 85.6c. Taker EV -3.0c CI [-8.0,+2.0]; maker strict -2.8c [-8.3,+2.8], fill rate 86%; maker optimistic -1.5c. Test halves all negative. At 1h before close: taker -0.2c, maker strict -0.5c: zero. Does not survive (the scan's 91.6% hit rate is not reproduced in this 24-day window: 83%).
L2 (KXNCAAF, 1h before close, NO 91-95c): n=30 games only, win 93.3% vs 93.6c, taker -0.7c CI [-9.9,+8.5], maker strict fill 70%, -1.8c. Does not survive; sample too thin (college basketball not in season, so KXNCAA* family = football only). Both leads use close_time (known only after settlement), i.e. the scan's conditioning is itself look-ahead.

## Caveats
24-day window, one early-season slice (NHL preseason, NBA absent, tennis hard-court swing); 1-min candle closes, not order book; fill at next-minute ask is optimistic for thin size; ESPN WP join relies on play wallclock; sport-level cells are small (CI wide). Several cells had positive point estimates; none was both out-of-sample and CI-positive.
