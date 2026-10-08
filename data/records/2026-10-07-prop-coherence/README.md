# Prop coherence: pathwise constraints among one game's player props

Code: `src/prop-identities.mjs` (pure), `scripts/prop-coherence.mjs scan|history`, `test/prop-identities.test.mjs`.
Public read-only Kalshi data, paced 450 ms, no orders. Run 2026-10-07/08.

## Constraints encoded (each is `sum w*Y <= b` in every world the stat definitions allow)

Rule text (as served, `rules_primary`/`rules_secondary`):
- KXNFLTD: "If Foster Moreau scores at least 2+ touchdowns in the Houston vs Tennessee Pro Football game ... then the market resolves to Yes." Rung 1+ is the anytime TD; D/ST entries ("TB Buccaneers D/ST: 1+") sit in the same ladder.
- KXNFLFIRSTTD: "If Jared Wayne scores the first touchdown in [the] game ... then the market resolves to Yes. ... If no touchdowns are scored in the game, the No Touchdown market resolves to Yes and all other player markets resolve to No."
- KXMLB{HIT,HR,TB,HRR}: "If Miguel Vargas records 3+ hits / 2+ home runs / 5+ total bases / 5+ total hits + runs + rbis in the ... game ... then the market resolves to Yes." (scratched / no plate appearance -> "fair market price").
- KXNHL{GOAL,AST,PTS}: "If Vasily Podkolzin records 3+ goals / 2+ assists / 2+ points in the ... NHL game ... then the market resolves to Yes." (never enters -> last fair price).
- KXNFLPASS{TDS,COMP,ATT}: "records N+ passing touchdowns / ... " (settles on the recorded stat once a snap is taken).
- KXNBAPTS (only NBA text served; the other NBA series have no open or settled markets in the offseason, so their rule text could not be read): "If Jaylen Brown records 25+ points ... then the market resolves to Yes."

Families:
1. ladder: Y(S>=k+1) <= Y(S>=k) for every "at least k" ladder (all prop series, same player/game).
2. implication (same player): NFL first TD => TD 1+; pass TD >= k => completions >= k => attempts >= k; interceptions >= k => attempts >= k.
   MLB HR>=n => hits>=n, TB>=4n, HRR>=3n (a homer is a hit, 4 bases, and hit+run+RBI); hits>=k => TB>=k, HRR>=k; TB>=k => hits>=ceil(k/4).
   NHL goals>=k => points>=k; assists>=k => points>=k. The implied rung is the largest listed rung at or below the implied threshold.
3. sum (Frechet): NHL Y(PTS,a+b) >= Y(G,a)+Y(A,b)-1. NBA (encoded from the stat definitions, rule text unread, inert until the season): PR/PA/RA/PRA sums, STOCK = STL+BLK, 3PT=>PTS>=3m, FTM=>PTS>=m, Y(PRA,a+b+c) >= Y(P,a)+Y(R,b)+Y(A,c)-2.
4. exclusive: sum over listed first-TD markets incl. No Touchdown <= 1 (inequality, not equality: unlisted scorers exist, so exhaustiveness is not asserted).
5. notd: Y(No TD) + Y(player TD 1+) <= 1.

Deliberately NOT encoded: team-total/game-total => player TD (a team can reach 7 with field goals and safeties; a TD is >= 6 points but the reverse fails; there is no team-total series in the NFL prop map anyway); pass-TD => receiver-TD (receiver set not exhaustive); yards vs receptions/attempts (no pathwise link); first-TD sum = 1 - P(NoTD) (unlisted players).
Void caveat: a snapless/scratched player settles every market at its own pre-game "fair price", which can break these pathwise inequalities by that fair-price difference; history drops any player with a non-0/1 settlement.

## Method
- Dutch book at the touch: sell positive-weight legs at the bid, buy negative-weight legs at the ask (NO-equivalent), fees theta*P(1-P) per leg with theta = 0.07 x series fee_multiplier (MLB 0.5, others 1; linear, no cent rounding, which flatters the trader). Violation = proceeds net of fees exceed the constraint's maximum payout b. Reuses `priceIdentity` from `src/pathwise-identities.mjs`.
- Projection: exact Euclidean (Brier) projection of mids onto { x in [0,1]^n : Ax <= b } by Hildreth dual coordinate ascent per connected component (box constraints as rows), tolerance 1e-11, all 194 history games converged; tested equal to PAV on a pure ladder (so chains are the PAV projection) and to the closed-form shift on a simplex row. It is the exact projection to tolerance, not an approximation of it.
- History: 2026-09-04..2026-10-06 settled markets; price = last hourly-candlestick bid/ask close with end <= game start - 2 h (start = `occurrence_datetime` - 3 h, checked against NFL kickoff, MLB ticker time, NHL puck drop; batch `GET /markets/candlesticks`, 50 tickers per call, period 60). Quotes are the last seen in the hour, not simultaneous; sizes unknown, so Dutch-book depth is not available historically (live scan reads displayed size). Players with any non-0/1 settlement dropped (1,159 markets). Brier gain = mean[(mid-y)^2 - (proj-y)^2], delete-one-game jackknife SE.
- Coverage: NFL 64 games (all), NHL 43 (all, preseason), NBA 1 (4 markets; offseason), MLB 86 of 347 games (every 4th, for request budget). 43,980 priced markets in 194 games.

## Live scan (2026-10-08 02:34Z): 15 NFL, 2 NHL, 3 MLB games, no NBA open
Constraints evaluated: NFL 2,420, NHL 207, MLB 1,026. Dutch books after fees: 0. Before fees: 0. Closest: MLB ladder KXMLBKS SDWBUEHLER10 8<=7 at net -0.0007, then -0.011 (MLB TB5 ladder), -0.015 (NFL rushing yards). Mid-level violations exist (NFL 16, NHL 24, MLB 38 constraints) but are inside the spread; largest single mid move under projection 0.14 (NFL), 0.23 (NHL), 0.14 (MLB), all wide-spread illiquid quotes.

## History

Dutch books at the 2 h-before-start touch, after fees (count of constraints violated / evaluable):

| sport | ladder | implication | sum | exclusive | notd |
|---|---|---|---|---|---|
| NFL | 0/16,641 | 0/1,450 | - | 0/64 | 0/1,160 |
| NHL | 0/1,384 | 0/1,722 | 0/790 | - | - |
| MLB | 0/11,970 | 0/14,563 | - | - | - |
| NBA | 0/3 | - | - | - | - |

Zero violations before fees as well (float noise 3e-17 aside). Mid-level violations: NFL ladders 278, exclusive 21 of 64 games, NHL implications 5, MLB ladders 428 and implications 173. Every one lies inside the bid/ask spread.

Brier of mids vs projected mids (gain positive = projection better; +/- delete-one-game jackknife SE):

| set | markets | Brier(mid) | gain all constraints | gain ladders only |
|---|---|---|---|---|
| all | 43,980 | 0.1469 | +4.2e-4 +/- 0.8e-4 | +3.7e-4 +/- 0.7e-4 |
| spread <= 0.06 | 39,388 | 0.1430 | -3.2e-5 +/- 4.4e-5 | -8e-6 +/- 3.6e-5 |
| spread > 0.06 | 4,592 | 0.1805 | +4.3e-3 +/- 0.75e-3 | +3.6e-3 +/- 0.6e-3 |
| NFL | 22,505 | 0.1402 | +1.8e-4 +/- 0.5e-4 | same |
| NHL | 3,967 | 0.1389 | +3e-7 +/- 3e-7 | 0 |
| MLB | 17,504 | 0.1573 | +8.1e-4 +/- 1.9e-4 | +6.8e-4 +/- 1.5e-4 |

By series (all constraints; NFL): PASSCOMP +3.4e-3 +/- 0.9e-3, PASSATT +1.9e-3 +/- 0.5e-3, RSHATT +5.2e-4, RECYDS/REC/RSHYDS about +2e-5, TD -4e-6, FIRSTTD +1e-5. MLB: HRR +1.4e-3 +/- 0.5e-3, HA/ERA/WA +4.5e-3 to +5.2e-3 (ladder-only), TB +3.6e-4, HR +2e-5, HIT -6.4e-4 +/- 3.4e-4 (cross-series projection pulled hits toward wide TB/HRR mids). NHL series all within 1e-5 of zero. Ladder-only versus full constraint set differs by 5e-5 overall: the cross-series constraints add almost nothing beyond the ladders.

## Verdict
No trade: across 43,980 priced prop markets in 194 games and a live book of 20 games, no constraint was violated at the touch even before fees, and after the 0.07 P(1-P) fee the closest live miss was -0.0007. Market makers keep these chains, exclusivity rows and stat implications coherent at the touch; the Obsmetrologia constraints are true but already priced.
The only signal is in the mids: the gain is entirely in wide-spread quotes (spread > 0.06: +4.3e-3 Brier, 10% of the markets, about 5.7 sigma by jackknife), where the mid of a one-sided book is noise and monotone ladder structure repairs it; on tight quotes the gain is 0 within error (-3e-5 +/- 4e-5). As a forecasting repair for illiquid ladder rungs (pass completions/attempts, MLB hits/earned runs allowed, HRR) projection helps modestly; as a cross-series (player vs player-stat) or exclusivity repair it does nothing measurable. Not tested: NBA (offseason), MLB beyond a 1-in-4 game sample, quotes closer than 2 h to start, in-play.
