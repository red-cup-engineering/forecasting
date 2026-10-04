# Kalshi live-event mentions: repricing lag and a live shadow monitor (junior engineer slice for info-e1, 2026-10-04)

Research, backtest and shadow only. No orders, no signing, no keys/.env. Public Kalshi endpoints (honest UA) and public YouTube auto-captions/audio only. Nothing outside this directory was written; no git operations.

## Verdict

Not a viable lane at an agent's realistic latency (10-30 s from the word being on a public stream). The market has already repriced.

- On 15 settled events (89 YES words that were priced < 0.80 at the jump; KXTRUMPMENTION / KXTRUMPMENTIONB / KXVANCEMENTION), using for each event the FASTEST public YouTube feed found, the price at utterance+15 s is ~0.99 in 91-99% of cases (the 9% case is the most pessimistic clock calibration, P=12 s); EV per contract after fee at +15 s is +0.2c to +3.0c depending on that calibration, CI touching zero, and 0-8% of cases had >=100 contracts offered at <= 0.95. At +30 s and later it is +0.2c with no fills.
- At +10 s EV is +0.5c to +8.7c (clock-calibration dependent), fills >=100 ct in 0-19% of cases. At +5 s EV is +1.7c to +18.8c, fills >=100 ct in 4-26%. Only a sub-5-second pipeline from stream ingest (including HLS delay, ASR and decision) could earn anything, and these use the best feed per event, post-hoc selected, so they are upper bounds.
- Many words were priced up BEFORE the fastest public feed showed them (median lag is negative at P<=6 s; p25 -18 s): the market moves on in-venue / TV / faster-source information that a YouTube-stream agent cannot beat.
- The shadow monitor is built and runs (below). What it lacks is an event: no mention event was live and speaking while I worked (Vandalia rally ended ~01:58Z; next scheduled: KXTRUMPMENTION-26OCT06 Anduril remarks, KXFEDMENTION-26OCT post-FOMC on 2026-10-28/29). Only a pipeline self-test on a live news stream was run, and the box was at load average ~25, so the ASR latency below is a pessimistic number. A shadow run on those two events would give the absolute, un-calibrated answer.

## 1. Mechanics (results/series_rules.json has the raw rule text per series)

- All mention families are `fee_type: quadratic` (taker fee 0.07 * P * (1-P) per contract, ceil to cent per order), `can_close_early: true`, binary YES/NO at 1c ticks. A "said" = the exact word/phrase or its plural or possessive form (also plural nouns inside proper nouns/noun phrases); grammatical/tense inflections do NOT count; "A / B" strikes accept either; "(N+ times)" strikes are counts. Speaker must be the named person in an official capacity; hot-mic and archival footage do not count.
- Resolution source: "video of the event using the live broadcast or stream"; if Kalshi staff cannot reach consensus, internal and external (official) transcripts (listed news sources). KXTRUMPSAY* (monthly/weekly windows, "before Oct 5 12:00am ET") use public statements, direct quotes published by Source Agencies and Truth Social/Twitter posts, not an event.
- Trading does NOT halt during the event. Markets open days before (e.g. KXTRUMPMENTION-26OCT02 opened 2026-09-28), trade all through the event and keep trading at 0.99 after the word is said. `close_time` is set when Kalshi staff close the whole event, often hours to a day after the event (median ~16 h after the first jump in our sample; KXTRUMPMENTION-26OCT02 closed 2026-10-03T16:00Z for a rally on Oct 2 evening), and `occurrence_datetime` is the event end as recorded by staff, not a per-word time. There is no per-word early close in practice (the whole event closes together; individual YES markets occasionally close later).
- Events are scheduled by Kalshi ("originally scheduled for ..."); postponement within 14 days keeps the markets open; cancellation resolves the "event does not qualify" market to Yes.
- Volume and price path (results/lag_summary.txt, 242 YES markets, 15 events): median market total 15k contracts, median event 20-30 markets of which about half resolve YES. Median YES-word price 1 h before the jump 0.77, 10 min before 0.79, 1 min before 0.78 (p25 0.50): most words that get said were already favoured; the surprises (< 0.5) are the only exploitable ones. Median 14 trades and ~880 contracts within +-60 s of the jump. 43% of volume trades before the jump, the rest at 0.99 afterwards.
- Series seen with settled events since 2026-08-15 (results/events.json): KXTRUMPMENTION (+B), KXTRUMPSAY, KXTRUMPSAYCOMPANY/COUNTRY/NICKNAME, KXVANCEMENTION, KXLEAVITTMENTION, KXFEDMENTION (Powell post-FOMC), KXSECPRESSMENTION (WH press briefing, gaggles excluded), KXEARNINGSMENTION* (about 190 company series; call + Q&A). Only the first three kinds were backtested here (below).

## 2. Lag measurement on settled events

Method (scripts/):
1. `lm_events.py` catalogs settled events from Kalshi `/markets` (results/events.json).
2. `lm_videos.py` searches YouTube for the archived live stream of each event, downloads word-timed auto-captions (json3) and info, and scores each candidate feed by how many YES words have a caption hit near their price jump. 15 events got a usable feed (31 feeds; per-feed scores in results/cand/).
3. `lm_lag.py`: for every YES market (volume >= 300, not an "N+ times" count), J = first trade at >= 0.90 after an earlier trade < 0.80 on the public trade tape (`/markets/trades`, sub-second timestamps). The caption utterance best explaining the jump (within +-90 s of J) gives u; video t=0 wall time is `release_timestamp - P`. Price at u+s is the last trade at or before u+s; "fill" is the contracts taken by YES-takers at <= 0.95 in [u+s, u+s+5 s]. EV per contract = (1 - p) - fee for p <= 0.97 (nothing bought above), conditional on the word having been said and detected correctly (pi=1; the pi=0.9 column charges 10% wrong detections). CIs bootstrap events (2000 draws).
4. Only markets with pre-jump price < 0.80 count (a tradable edge existed), n = 89.

Clock calibration. Archive video t=0 versus wall time is not published. On a live stream (CRUX, 3MxzUymFUOg) the HLS playlist carries EXT-X-PROGRAM-DATE-TIME: t0_wall = release_timestamp - 6.09 s, so P = 6.09 for that stream. Other broadcasters' P is unknown, so every number is shown at P = 0, 6.09 and 12 s. YouTube's captions were checked against my own whisper transcription of the Mobile rally (caption time within ~1 s of speech on the media timeline). Absolute lag therefore has about +-6 s of unresolved uncertainty; per-feed relative values are reliable (same event, different feeds: RSBN +5.0, GOP -8.0, ANI -27.8, Agenda-Free TV -40.9 s median J-u on 2026-10-02 as stream delay differs).

What the agent actually cares about is J minus the moment the word reaches the agent's feed, which is exactly this J-u on the feed it watches (plus its own ASR+decision time), so no "true speech time" is needed.

Lag J-u on the fastest feed per event (positive = market jumps after the word appears on the feed):

| P assumed | p10 | p25 | median | p75 | p90 |
| 0 s | -36.7 | -24.6 | -8.6 | -3.4 | +2.1 |
| 6.09 s | -30.7 | -18.5 | -2.8 | +2.6 | +6.6 |
| 12 s | -24.7 | -12.6 | +2.4 | +8.2 | +12.5 |

Price and EV by agent latency after the word appears on the fastest feed (n = 89 YES words, 15 events; EV/ct after fee, pi = 1, event-bootstrap 95% CI):

| latency | P=0 | P=6.09 | P=12 | P=6.09 share ask<=0.95 | P=6.09 >=100 ct filled at <=0.95 |
| +0 s | +6.1c [+0.6,+14.5] | +17.6c [+6.9,+27.7] | +27.3c [+15.0,+38.2] | 42% | 26% |
| +5 s | +1.7c [0,+4.6] | +8.0c [+1.5,+15.6] | +18.8c [+8.9,+28.2] | 26% | 15% |
| +10 s | +0.5c [0,+1.3] | +3.0c [0,+8.4] | +8.7c [+1.9,+16.6] | 9% | 7% |
| +15 s | +0.5c [0,+1.2] | +0.2c [0,+0.7] | +3.0c [0,+8.9] | 1% | 0% |
| +30 s | +0.2c | +0.2c | +0.2c | 1% | 0% |
| +60 s | +0.2c | +0.2c | +0.2c | 1% | 0% |

All feeds pooled (not independent, P=6.09): +9.1c / +4.3c / +1.7c / +0.2c at +0/+5/+10/+15 s. Bias direction: the utterance is chosen to best explain the jump (shrinks lag toward 0), only the best feed per event is used, and detection is assumed perfect; all of this flatters the lane. Ignoring feed delay, a 100-lot at 0.95-0.97 earns 1-2c/ct before the fill is even available.

Honest limits of this table: captions are YouTube ASR (misses words and sometimes the wrong speaker at rallies; 96 of 237 jump words had a caption hit within +-90 s, so the unmatched 60% are not in the numbers), the lag floor cannot be separated from feed delay, events are Aug-Oct 2026 Trump/Vance only, and earnings-call / Fed / briefing series were not tested (no archived timed feeds were collected for them; same mechanics, so I expect the same). The earlier pre-event study stands.

## 3. Live shadow monitor (built; scripts/lm_live.py)

```
python3 lm_live.py --event KXTRUMPMENTION-26OCT06 --url https://www.youtube.com/watch?v=<live id> \
    --out results/live/KXTRUMPMENTION-26OCT06.jsonl --yt <venv>/bin/yt-dlp [--model tiny.en|base.en] [--minutes 120]
# needs: yt-dlp, ffmpeg, faster-whisper (I used a venv in the session scratchpad; nothing installed repo-wide)
```
Flow: `/markets?event_ticker` gives the active strikes (count strikes skipped); yt-dlp resolves the live HLS audio; ffmpeg (live_start_index -1) pipes 16 kHz mono; a reader thread keeps an 8 s ring buffer stamped with arrival wall time; faster-whisper (tiny.en, int8, 2 threads, word timestamps) re-transcribes the newest window continuously; words are matched with the same plural/possessive/slash rules as the backtest; on the first match of an unsaid strike it takes a Kalshi quote immediately, records `would_buy` (ask <= --max-ask 0.95, size 100, taker fee), and follow-up quotes at +5/+15/+30/+60 s. JSONL records: start, asr (with --debug), detect (t_word_wall, t_detect, lat_s, asr_s, ask/bid/last, ask_pre, would_buy, fee, context), followup, slow, stop. Memory: python 260 MB + ffmpeg 57 MB (< 600 MB). After an event, compare `t_detect` with the first >=0.90 trade in `/markets/trades` (this yields the absolute lag including the real stream delay, with no P calibration problem).

Self-test: on a live NBC News stream (words "the, trump, ..."), detections and follow-ups were written (results/live/selftest.jsonl). With load average ~25 on the shared machine, tiny.en took 4-17 s of ASR per 8 s window, so detection latency was 8-14 s; unloaded it should be a few seconds but that is not measured. HLS itself adds ~1.5-9 s behind ingest (measured from PROGRAM-DATE-TIME). A 10-30 s stack is therefore what a CPU whisper agent will have.

What blocks a real result: no mention event live while I was working. Run it on KXTRUMPMENTION-26OCT06 (Oct 6) and the Oct 28/29 FOMC press conference (KXFEDMENTION-26OCT) and keep `would_buy` decisions to see the un-calibrated number. What would change the verdict: a sub-5 s pipeline from ingest (low-latency HLS or RTMP tap, GPU or streaming ASR), or an out-of-band faster source than YouTube.

## Files
- scripts/: kalshi_obs_lib.py (copy of the earlier lib), lm_lib.py (caption words, rule-matching, trades, fee, Wilson), lm_events.py, lm_add_open.py, lm_videos.py, lm_pick.py, lm_lag.py, lm_paths.py, lm_live.py.
- results/: events.json (settled mention events since 2026-08-15, includes provisional KXTRUMPMENTION-26OCT03 where result is inferred from last price and not used in any number), series_rules.json, raw_*.json, sets_*.json (chosen feeds), lag_fastest_P*_rows.{json,csv} and lag_all_P6.09_rows.* (per-market rows), lag_summary.txt (all tables above including -10/-5 s rows), cand/ (per-event feed candidates with scores), live/ (self-test log), videos_run*.log.
- Caches (trade tapes, caption files) are in the session scratchpad, not here; scripts regenerate them (`LM_CACHE`, default /tmp/lm_cache). Rerun order: lm_events.py -> lm_videos.py <yt-dlp> <cache> EVENT... -> lm_pick.py <cache> -> lm_lag.py <cache> results/sets_fastest.json 6.09 results/lag_fastest_P6.09.
