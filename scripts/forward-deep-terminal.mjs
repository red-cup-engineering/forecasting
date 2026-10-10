#!/usr/bin/env node
/**
 * Forward test of pre-registered rule DT (deep-terminal favourites). Shadow only, public GETs, >= 400 ms pacing.
 *
 *   node scripts/forward-deep-terminal.mjs cycle   safe every 1-2 min; with no live game it makes 3 ESPN calls and exits
 *   node scripts/forward-deep-terminal.mjs score   verdict status
 *
 * State: ~/.local/state/561-group/settlements/forecasting-service/forward/deep-terminal/
 *   log.jsonl     {type:'entry', game, ...} once per game; {type:'result', game, ticker, result}
 *   cycles.jsonl  one line per cycle that saw a live game
 *   checks.json   last result-check time per ticker (results are looked up at most every 10 min)
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { KALSHI, appendJsonl, jackknife, pacedGet, readJsonl, stateDir, verdict } from '../src/forward-shadow.mjs';
import { SPORTS, eventMatchesGame, normalizeScoreboard, sideMatches } from '../src/sport-feeds.mjs';
import { DT, dtEntry, dtNet, isDeepTerminal, liveState } from '../src/forward-deep-terminal.mjs';

const DIR = stateDir('deep-terminal'); const LOG = join(DIR, 'log.jsonl'); const CYC = join(DIR, 'cycles.jsonl'); const CHK = join(DIR, 'checks.json');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const KEYS = ['nfl', 'ncaaf', 'mlb'];

async function cycle() {
  mkdirSync(DIR, { recursive: true });
  const now = Date.now(); const rows = readJsonl(LOG);
  const entered = new Set(rows.filter((r) => r.type === 'entry').map((r) => r.game));
  const resolved = new Set(rows.filter((r) => r.type === 'result').map((r) => r.game));
  const out = []; const stat = { at: new Date(now).toISOString(), live: 0, deep: 0, entered: 0, skipped: {} };
  for (const key of KEYS) {
    const spec = SPORTS[key]; const q = key === 'ncaaf' ? '?groups=80&limit=300' : '?limit=300';
    const sb = await pacedGet(`${ESPN}/${spec.espn}/scoreboard${q}`);
    const raw = new Map((sb?.events ?? []).map((e) => [String(e.id), e]));
    const norm = normalizeScoreboard('team', sb);
    for (const g of norm) {
      if (g.state !== 'in') continue;
      stat.live += 1; const game = `${key}:${g.id}`; if (entered.has(game)) continue;
      const st = liveState(key, raw.get(g.id)); if (!isDeepTerminal(st)) continue;
      stat.deep += 1;
      const events = (await pacedGet(`${KALSHI}/events?series_ticker=${spec.game}&status=open&with_nested_markets=true&limit=200`))?.events ?? [];
      const ev = events.filter((e) => (e.markets ?? []).length === 2 && eventMatchesGame(e, g)).sort((a, b) => a.event_ticker.localeCompare(b.event_ticker))[0];
      if (!ev) { stat.skipped['no kalshi event'] = (stat.skipped['no kalshi event'] ?? 0) + 1; continue; }
      const team = st.teams[st.leader]; const tn = { names: [team.displayName, team.location, team.name, team.abbreviation, team.shortDisplayName, `${team.location ?? ''} ${team.name ?? ''}`.trim()].filter(Boolean) };
      const lm = ev.markets.filter((m) => sideMatches(m.yes_sub_title, tn));
      if (lm.length !== 1) { stat.skipped['ambiguous side'] = (stat.skipped['ambiguous side'] ?? 0) + 1; continue; }
      const market = (await pacedGet(`${KALSHI}/markets/${lm[0].ticker}`))?.market; if (!market) continue;
      const series = await pacedGet(`${KALSHI}/series/${spec.game}`); const evFull = await pacedGet(`${KALSHI}/events/${ev.event_ticker}`);
      const mult = evFull?.event?.fee_multiplier_override ?? evFull?.fee_multiplier_override ?? series?.series?.fee_multiplier ?? 1;
      const e = dtEntry(market, mult);
      if (e.reason) { stat.skipped[e.reason] = (stat.skipped[e.reason] ?? 0) + 1; console.log(`${game} deep-terminal, no entry: ${e.reason}`); continue; }
      out.push({ type: 'entry', game, sport: key, event_ticker: ev.event_ticker, leader: st.leader, score: `${st.away}-${st.home}`, margin: st.margin, regime: st.regime, state: st.detail, at: stat.at, ...e });
      entered.add(game); stat.entered += 1; console.log(`${game} ENTRY ${e.ticker} ask ${e.price} (${st.detail}, slack ${st.regime.slack})`);
    }
  }
  // results for entries not yet resolved, at most every 10 min per ticker
  const checks = existsSync(CHK) ? JSON.parse(readFileSync(CHK, 'utf8')) : {};
  for (const e of rows.filter((r) => r.type === 'entry' && !resolved.has(r.game))) {
    if (now - (checks[e.ticker] ?? 0) < 600e3) continue;
    checks[e.ticker] = now; const m = (await pacedGet(`${KALSHI}/markets/${e.ticker}`))?.market;
    if (m && (m.result === 'yes' || m.result === 'no')) { out.push({ type: 'result', game: e.game, ticker: e.ticker, result: m.result, at: new Date().toISOString() }); console.log(`${e.game} result ${m.result}`); }
  }
  writeFileSync(CHK, JSON.stringify(checks));
  appendJsonl(LOG, out); if (stat.live) appendJsonl(CYC, [stat]);
  console.log(`cycle: ${stat.live} live games, ${stat.deep} deep-terminal, ${stat.entered} new entries, ${out.length} rows`);
}

function score() {
  const rows = readJsonl(LOG); const res = new Map(rows.filter((r) => r.type === 'result').map((r) => [r.game, r.result]));
  const entries = rows.filter((r) => r.type === 'entry');
  const items = entries.filter((e) => res.has(e.game)).map((e) => ({ g: e.game, x: dtNet(e, res.get(e.game)) }));
  const st = jackknife(items); const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
  console.log(`DT forward test (pre-registered: >= ${DT.minGames} new games, mean net > 0, t > 2, delete-one-game jackknife)`);
  console.log(`entries ${entries.length}, settled ${items.length}, wins ${[...res.values()].filter((r) => r === 'yes').length}`);
  console.log(`mean net/contract ${f(st.mean)}  SE ${f(st.se)}  t ${f(st.t, 2)}`);
  console.log(`verdict: ${verdict(st, DT.minGames)}`);
}

const cmd = process.argv[2];
if (cmd === 'cycle') cycle().catch((e) => { console.error(e.message); process.exit(1); });
else if (cmd === 'score') score();
else { console.error('usage: forward-deep-terminal.mjs cycle|score'); process.exit(2); }
