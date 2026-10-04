# Kalshi observable-progress markets, 2026-10-03 (junior engineer slice for info-e1)

Result: NO edge found in any family tested. Thesis (running value publicly observable => beat the market) is not supported where we could test it. Paper-only, no orders. Public APIs only, honest User-Agent (kalshi_obs_lib.UA).

Data caveat: /markets only holds markets settled after the historical cutoff (2026-08-04); older ones come from /historical/markets and /historical/markets/{t}/candlesticks (different JSON keys, handled in kalshi_obs_lib._slim). The session scratchpad holding the raw dumps was lost mid-run (restart); results/ files hold the outputs, scripts regenerate everything (obs_survey_collect.py, then each study).

## 1. Survey (live + archived settled markets, mve_filter=exclude; pulled before the restart, MENTIONS counts then were live-only)
family | series | settled mkts | settled events | settled vol (contracts) | open mkts
MENTIONS | 457 | 8564 live-only (81339 mkts / 4050 events / 427 series incl. archive) | 477 | 95.2M live | 1363
GAS (AAA) | 71 | 15358 | 889 | 91.3M | 799
RT (Rotten Tomatoes) | 179 | 596 | 47 | 34.6M | 238
NETFLIX | 25 | 3143 | 269 | 23.6M | 135
BILLBOARD_CHART | 205 | 6365 | 570 | 20.0M | 399
YT (views/charts) | 11 | 5981 | 398 | 9.4M | 431
TSA | 5 (only KXTSAW has markets) | 2969 | 273 | 6.5M | 21
STREAMS (Luminate/Spotify) | 245 | 6675 | 1561 | 2.4M | 1336
PRECIP_CUM (monthly rain/snow) | 28 | 67 | 8 | 1.5M | 101
SPOTIFY_CHART daily | 31 | 6798 | 453 | 1.1M | 0
METACRITIC | 66 | 240 | 24 | 0.7M | 78
TWEETS (Fed/IMF/WEF/POTUS) | 8 | 183 | 33 | 0.16M | 0
Top series: KXAAAGASW 50.7M, KXAAAGASD 16.8M, KXAAAGASM 3.3M (AAA, quadratic, LIP on many strikes); KXRT 20.0M (376 mkts/24 ev, LIP 3972 programs historically); KXTOPSONG 4.7M weekly; KXBBCHARTPOSITIONSONG 1.2M; KXALBUMSTREAMS 0.46M (Luminate, one_off, LIP 494); KXARTISTSTREAMS weekly 0.34M; KXTRUMPMENTION 30.5M (41 ev), KXTRUMPSAY 14.6M, KXTRUMPMENTIONB 6.6M, KXWORLDNEWSMENTION 6.5M, KXVANCEMENTION 2.5M. All fee_type quadratic except KXAAAGASM (quadratic_with_maker_fees).
Settlement source / running value / update cadence / pollability:
- GAS: AAA national average. Front page gasprices.aaa.com shows "Price as of <date>" + yesterday/week/month/year-ago; robots Crawl-delay 10, page cached 10 min. Daily market D opens 12:00Z on D-1 and closes 23:59 ET D-1, settles on AAA value of D (i.e. it forecasts tomorrow's published value); weekly opens Mon, settles next Monday; monthly level. Pollable: YES (forward collector below).
- TSA: weekly avg of daily screenings (published ~next morning). tsa.gov returns 403 Access Denied to an honestly-identified client (even robots.txt); Kalshi has no archived daily TSA series (TSA/KXTSA empty). Running value NOT reconstructable, not pollable.
- RT: rottentomatoes.com (robots allow pages; ToS believed to prohibit automated access, not verified). Score at a date; running value public but no history. Not polled: flag for the Senior.
- YT views/charts, Billboard, Spotify charts, Luminate streams: sources are charts.youtube.com / Billboard / Spotify Charts / Luminate (paywalled). No official keyless API; scraping against ToS. Not polled. kworb.net (robots Allow) mirrors Spotify/YouTube charts: possible third-party source, ToS unverified.
- MENTIONS: settle on transcripts of the event; no running value except "already said" (market closes early on YES).
- Tweets: X, not publicly pollable keyless.
- LIP: /incentive_programs has ~tens of thousands of historic programs (80 MB dump); gas strikes carry period_reward 3,000,000 (units per API), target_size 1000. Not valued here.

## 2. Out-of-sample tests (Kalshi hourly candles, bid/ask close at the decision hour, taker fee ceil-to-cent per 100-lot, event-bootstrap CIs)
| family | test | n (distinct events) | result | verdict |
| GAS daily (KXAAAGASD) | AR(3) on AAA daily diffs vs Kalshi mid, 4 decision hours, strikes within 4c; fit <2026-07-15 | 188 events (80 test) | Brier mid .0387 vs AR .0857 (AR-mid CI +.032..+.067, AR worse); market sharpens .062 -> .032 through the day = prices intraday info beyond AAA history; taker EV test -6.95c [-10.7,-3.0] | NO EDGE (market better) |
| GAS weekly (KXAAAGASW) | OLS on weekly diffs, H=7d at Mon 14:00Z | 117 weeks, only 37 fit / 34 test events had candles (archive) | Brier mid .132 vs AR .353 test; taker EV -5.6c [-16.5,+8.7] (n=27) | NO EDGE, thin |
| TSA weekly | seasonal (week-364d x trailing 4wk YoY) rolling forecast, sd .029 log | 103 forecastable weeks, 93 with candles | Mon: Brier mid .0891 vs model .0977, EV@edge>.10 +5.0c [-5.6,+15.5] (n=60); Fri: mid .0582 vs .1083 (model worse), EV -1.9c [-7.9,+5.7] | NO EDGE (CI spans 0); thesis untestable (no daily values) |
| RT, YT views, streams, charts, Netflix | not testable: no archived source history, polling disallowed/blocked | - | - | UNTESTED |
| MENTIONS | see section 3 | 98 events with anchors (5000 newest markets with vol>=50) | see below | NO EDGE |

## 3. Mentions (results/mentions.txt)
All 81,339 settled mention markets (4050 events, 427 series): YES rate 0.358 where fewer than 3 prior same-word observations exist. Using earlier events of the same series as a stand-in for prior transcripts: word in ALL >=3 prior events: 1752 markets (2.2%), YES 0.800 [0.781,0.818]; in NONE: 3233 (4.0%), YES 0.105 [0.095,0.116]; mixed 41.3%, YES 0.473. So only ~6% of outcomes are strongly predictable from history and even those are not deterministic. No transcript-level or appearance-schedule data was used (not built); this is the stated limit of "knowable".
Cheap YES by ask bucket (taker, after fee), anchor open+1h / +24h, markets still open then, bigger sample than 6-7 but only 98 events: ask .10-.30 hit rates 7.7%-15.8% (open+1h; n=119, 64 events) and 3%-21% at +24h, all at or below the price; EV/ct negative or CI spanning 0 in every cheap bucket (e.g. 0.20-0.30 all series +1h: hit .158 [.093,.256], EV -10.2c [-17.7,-2.3]; 0.15-0.20 +24h: hit .167, EV -1.8c [-11.1,+5.2]; Trump .10-.20 +24h: hit .137 [.068,.257], EV -2.5c [-11.0,+2.9]). The earlier "14-17% hit" is reproduced at 0.15-0.30 prices but costs 15-25c, so no underpricing. NO side at open+1h is also negative (spreads at open are wide: ask-close at +1h of illiquid markets is the spread).
Base-rate model (same-word rate in earlier same-series events, shrunk to series rate): Brier test h=1 market .2106 vs model .2254; h=24 .1849 vs .2257; taker EV when edge>.1: -6.2c [-12.7,+2.3] (h1), -1.2c [-9.1,+6.1] (h24). Market beats the base-rate model; blend helps in-sample only marginally.
Caveats: the sample is the newest 5000 volume>=50 markets so fit/test cover Aug-Oct 2026 only; anchors are open-time based (not close-based, which would be look-ahead); no maker-fill/adverse-selection simulation was run (candle low not stored).

## 4. Forward collector (running)
scripts/obs_gas_collect.py: every 15 min (jittered), 1 AAA front-page request (conditional GET, honest UA, Crawl-delay respected) + 3 Kalshi list calls (KXAAAGASD/W/M near-the-money strikes: bid, ask, last, volume, OI, close). Writes collector/aaa-gas-YYYY-MM-DD.jsonl (UTC day files, ~4 KB/tick), bounded 168 h per start. It died with the session restart and was restarted at 2026-10-03 ~21:59Z. Keep running: `cd <record>; setsid nohup python3 scripts/obs_gas_collect.py --out collector --interval 900 --hours 168 >> collector/gas-collector.log 2>&1 &` (re-run to resume; or a 15-min timer with --once). What to read from it: when AAA's "as of" date and national_avg flip (does AAA publish D's value before the market closes? if yes at all before 23:59 ET D-1, that is a real edge) and whether Kalshi strikes reprice at the flip. Nothing else is being collected.

## 5. Paper lane recommendation
None of the families clears. The one open question worth a paper lane after ~2 weeks of collector data: AAA gas daily, but only if the collector shows the AAA value for D appearing on the page before the D market closes (23:59 ET D-1) and Kalshi lagging it. Based on the 14:00Z->02:00Z Brier sharpening (market already prices intraday info) I expect it will not. Mentions: no lane. TSA/RT/YT: untestable without a lawful source; needs a Senior decision on ToS (RT) or a keyed YouTube Data API.

Scripts: kalshi_obs_lib.py, obs_families.py, obs_survey_collect.py (HIST=1 for archive), obs_survey_report.py, obs_lip_collect.py, obs_gas_daily.py, obs_gas_weekly.py, obs_tsa_weekly.py, obs_mentions.py, obs_gas_collect.py.
