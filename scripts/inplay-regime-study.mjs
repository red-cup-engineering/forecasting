#!/usr/bin/env node
/**
 * In-play regime study: does conditioning Kalshi game-winner prices on GAME STATE sharpen the late
 * favourite-longshot edge? Read-only public data; never places an order.
 *
 *   node scripts/inplay-regime-study.mjs --cache <dir> [--from 20260905 --to 20261006] [--sports nfl,ncaaf,mlb]
 *        [--fetch-only | --rows rows.jsonl] [--out report.json]
 *
 * Pipeline: ESPN scoreboards -> Kalshi settled winner markets -> matchGames -> ESPN play-by-play (wallclock) ->
 * Kalshi 1-minute candlesticks of ONE market per event (the other side is its complement: bid' = 1 - ask,
 * ask' = 1 - bid) -> per minute: the favourite side (mid >= 0.5), its bid/ask/mid, the settled value and the game
 * state at that wall-clock minute (latest play at or before it) labelled by src/game-regime.mjs.
 * Minutes at or after the last play are dropped (the game is over; the book is settling).
 *
 * Calibration: realised - mid by favourite-mid band x regime, delete-one-GAME jackknife SEs.
 * Rule: buy the favourite at the ask when ask in [0.90, 0.985], hold to settlement, taker fee
 * 0.07 x multiplier x P x (1-P) per contract (unrounded; multiplier from GET /series and the event's
 * fee_multiplier_override). One trade per game per regime: the first qualifying minute in that regime.
 *
 * Pacing: >= 450 ms per host. HTTP 429: wait 5-20 s and retry; after 5 consecutive 429s stop with partial results.
 * Everything fetched is cached under --cache (resume-safe).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPORTS, matchGames, normalizeScoreboard, sideMatches } from '../src/sport-feeds.mjs';
import { gameRegime } from '../src/game-regime.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const flag = (name) => process.argv.includes(`--${name}`);
const CACHE = arg('cache', join(tmpdir(), 'inplay-regime-cache'));
const FROM = arg('from', '20260905'); const TO = arg('to', '20261006');
const SPORT_KEYS = arg('sports', 'nfl,ncaaf,mlb').split(',');
const ROWS = join(CACHE, 'rows.jsonl');
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const PACE_MS = 450;
const THETA = 0.07; const BAND_LO = 0.90; const BAND_HI = 0.985;

// ---------- fetching: pacing, 429 backoff, cache ----------
class StopError extends Error {}
const lastHit = new Map(); let consecutive429 = 0; let stopped = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, file) {
  const path = join(CACHE, file);
  if (existsSync(path)) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { /* refetch */ } }
  if (stopped) throw new StopError('stopped');
  const host = new URL(url).host;
  for (;;) {
    const wait = (lastHit.get(host) ?? 0) + PACE_MS - Date.now(); if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    let res;
    try { res = await fetch(url, { headers: { accept: 'application/json' } }); } catch (e) { await sleep(2000); res = null; if (++netFail > 5) { stopped = true; throw new StopError(`network: ${e.message}`); } continue; }
    netFail = 0;
    if (res.status === 429) {
      if (++consecutive429 >= 5) { stopped = true; throw new StopError('5 consecutive 429s'); }
      await sleep(5000 + Math.random() * 15000); continue;
    }
    consecutive429 = 0;
    if (res.status === 404) { writeFileSync(path, 'null'); return null; }
    if (!res.ok) { await sleep(2000); if (++netFail > 5) { stopped = true; throw new StopError(`HTTP ${res.status} ${url}`); } continue; }
    const json = await res.json(); writeFileSync(path, JSON.stringify(json)); return json;
  }
}
let netFail = 0;

// ---------- play-by-play timelines ----------
const clockSec = (s) => { const m = /^(\d+):(\d+)/u.exec(s ?? ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
function sides(summary) {
  const cs = summary.header?.competitions?.[0]?.competitors ?? [];
  const home = cs.find((c) => c.homeAway === 'home'); const away = cs.find((c) => c.homeAway === 'away');
  return home && away ? { home: String(home.id), away: String(away.id), homeTeam: home.team, awayTeam: away.team } : null;
}
/** Football: [{t, period, sec, home, away, pos}] sorted by wall clock. */
export function footballTimeline(summary) {
  const drives = [...(summary.drives?.previous ?? []), ...(summary.drives?.current ? [summary.drives.current] : [])];
  const out = [];
  for (const d of drives) for (const p of d.plays ?? []) {
    const t = Date.parse(p.wallclock); if (!Number.isFinite(t) || p.period?.number == null) continue;
    out.push({ t, period: p.period.number, sec: clockSec(p.clock?.displayValue), home: Number(p.homeScore), away: Number(p.awayScore), pos: String(p.start?.team?.id ?? d.team?.id ?? '') });
  }
  return out.sort((a, b) => a.t - b.t);
}
/** MLB: [{t, inning, half, outs, home, away}]; ESPN's outs/scores are after the play; Mid/End rows open the next half. */
export function mlbTimeline(summary) {
  const out = [];
  for (const p of summary.plays ?? []) {
    const t = Date.parse(p.wallclock); const ty = p.period?.type; const n = p.period?.number;
    if (!Number.isFinite(t) || !n || !ty) continue;
    let inning = n; let half; let outs = p.outs ?? 0;
    if (ty === 'Top') half = 'top'; else if (ty === 'Bottom') half = 'bottom';
    else if (ty === 'Mid') { half = 'bottom'; outs = 0; } else if (ty === 'End') { half = 'top'; inning = n + 1; outs = 0; } else continue;
    if (outs >= 3) { if (half === 'top') half = 'bottom'; else { half = 'top'; inning += 1; } outs = 0; }
    out.push({ t, inning, half, outs, home: Number(p.homeScore), away: Number(p.awayScore) });
  }
  return out.sort((a, b) => a.t - b.t);
}
function stateAt(tl, tMs) { // latest entry with t <= tMs
  let lo = 0; let hi = tl.length - 1; let ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (tl[mid].t <= tMs) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans < 0 ? null : tl[ans];
}
function regimeOfState(sport, st, ids) {
  const diff = st.home - st.away; const margin = Math.abs(diff);
  const leader = diff === 0 ? null : diff > 0 ? 'home' : 'away';
  const trailer = leader === 'home' ? 'away' : 'home';
  if (sport === 'mlb') return { leader, ...gameRegime({ sport, inning: st.inning, half: st.half, outs: st.outs, margin, trailerIsAway: trailer === 'away' }) };
  const posSide = st.pos === ids.home ? 'home' : st.pos === ids.away ? 'away' : null;
  return { leader, ...gameRegime({ sport, period: st.period, clockSec: st.sec, margin, trailerHasBall: leader === null || posSide === null ? undefined : posSide === trailer }) };
}

// ---------- collection ----------
const dates = (from, to) => { const out = []; for (let d = Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6)); d <= Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6)); d += 864e5) out.push(new Date(d).toISOString().slice(0, 10).replaceAll('-', '')); return out; };
const num = (x) => (x === undefined || x === null || x === '' ? NaN : Number(x));

async function settledMarkets(series) {
  const min = Date.parse('2026-09-04T00:00:00Z') / 1000; const max = Date.parse('2026-10-08T00:00:00Z') / 1000;
  const all = []; let cursor = '';
  for (let page = 0; page < 50; page++) {
    const j = await get(`${KALSHI}/markets?series_ticker=${series}&status=settled&min_close_ts=${min}&max_close_ts=${max}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`, `markets-${series}-${page}.json`);
    all.push(...(j?.markets ?? [])); cursor = j?.cursor ?? ''; if (!cursor || !(j?.markets?.length)) break;
  }
  return all;
}
function eventsOf(markets) {
  const by = new Map();
  for (const m of markets) { if (!by.has(m.event_ticker)) by.set(m.event_ticker, []); by.get(m.event_ticker).push(m); }
  return [...by].filter(([, ms]) => ms.length === 2).map(([event_ticker, ms]) => ({ event_ticker, title: `${ms[0].yes_sub_title} vs ${ms[1].yes_sub_title}`, markets: ms }));
}

async function collect() {
  mkdirSync(CACHE, { recursive: true }); const summary = { stoppedEarly: null, perSport: {} };
  writeFileSync(ROWS, '');
  try {
    for (const key of SPORT_KEYS) {
      const spec = SPORTS[key]; const st = { scoreboardGames: 0, kalshiEvents: 0, matched: 0, noWallclock: 0, noCandles: 0, used: 0 }; summary.perSport[key] = st;
      const series = await get(`${KALSHI}/series/${spec.game}`, `series-${spec.game}.json`);
      const seriesMult = series?.series?.fee_multiplier ?? 1; st.seriesFeeMultiplier = seriesMult;
      const events = eventsOf(await settledMarkets(spec.game)); st.kalshiEvents = events.length;
      const games = [];
      for (const d of dates(FROM, TO)) {
        const q = key === 'ncaaf' ? '&groups=80&limit=300' : '&limit=300';
        const j = await get(`https://site.api.espn.com/apis/site/v2/sports/${spec.espn}/scoreboard?dates=${d}${q}`, `sb-${key}-${d}.json`);
        for (const g of normalizeScoreboard('team', j)) if (g.state === 'post' && g.completed) games.push(g);
      }
      const uniq = [...new Map(games.map((g) => [g.id, g])).values()]; st.scoreboardGames = uniq.length;
      const { matched } = matchGames(uniq, events); st.matched = matched.length;
      for (const { game, event } of matched) {
        const sum = await get(`https://site.api.espn.com/apis/site/v2/sports/${spec.espn}/summary?event=${game.id}`, `sum-${key}-${game.id}.json`);
        const ids = sum && sides(sum); const tl = ids && (key === 'mlb' ? mlbTimeline(sum) : footballTimeline(sum));
        if (!tl || tl.length < 20) { st.noWallclock++; continue; }
        const market = event.markets[0];
        const tn = (t) => ({ names: [t.displayName, t.location, t.name, t.abbreviation, t.shortDisplayName, `${t.location ?? ''} ${t.name ?? ''}`.trim()].filter(Boolean) });
        const yh = sideMatches(market.yes_sub_title, tn(ids.homeTeam)); const ya = sideMatches(market.yes_sub_title, tn(ids.awayTeam));
        if (yh === ya) { st.ambiguousSide = (st.ambiguousSide ?? 0) + 1; continue; }
        const yesHome = yh;
        const ev = await get(`${KALSHI}/events/${event.event_ticker}`, `event-${event.event_ticker}.json`);
        const mult = ev?.event?.fee_multiplier_override ?? ev?.fee_multiplier_override ?? seriesMult;
        const t0 = Math.floor(tl[0].t / 1000) - 600; const t1 = Math.ceil(tl.at(-1).t / 1000) + 600;
        const cj = await get(`${KALSHI}/series/${spec.game}/markets/${market.ticker}/candlesticks?start_ts=${t0}&end_ts=${t1}&period_interval=1`, `cs-${market.ticker}.json`);
        const cs = cj?.candlesticks ?? []; if (cs.length < 10) { st.noCandles++; continue; }
        const settle = num(market.settlement_value_dollars); if (!Number.isFinite(settle)) continue;
        const gid = `${key}:${game.id}`; const lastT = tl.at(-1).t; let carry = null; const rows = [];
        for (const c of cs) {
          const T = c.end_period_ts * 1000; if (T >= lastT) continue;
          const bid = num(c.yes_bid?.close_dollars); const ask = num(c.yes_ask?.close_dollars);
          if (Number.isFinite(bid) && Number.isFinite(ask)) carry = { bid, ask, T };
          const q = carry && T - carry.T <= 300000 ? carry : null; // forward-fill <= 5 min
          const s = stateAt(tl, T); if (!q || !s) continue;
          if (!(q.bid > 0 && q.ask < 1 && q.ask >= q.bid && q.ask - q.bid <= 0.1)) continue;
          const yesMid = (q.bid + q.ask) / 2; const favYes = yesMid >= 0.5;
          const fb = favYes ? q.bid : 1 - q.ask; const fa = favYes ? q.ask : 1 - q.bid;
          const r = regimeOfState(key, s, ids); const favSide = favYes === yesHome ? 'home' : 'away';
          rows.push({ g: gid, sport: key, ticker: market.ticker, T, bid: fb, ask: fa, mid: (fb + fa) / 2, real: favYes ? settle : 1 - settle, regime: r.regime, slack: r.slack, favLeads: r.leader === null ? null : r.leader === favSide, mult });
        }
        if (rows.length) { appendFileSync(ROWS, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); st.used++; }
      }
    }
  } catch (e) { if (e instanceof StopError) { summary.stoppedEarly = e.message; } else throw e; }
  writeFileSync(join(CACHE, 'collect-summary.json'), JSON.stringify(summary, null, 1));
  return summary;
}

// ---------- analysis ----------
const BANDS = [[0.5, 0.8], [0.8, 0.9], [0.9, 0.95], [0.95, 0.97], [0.97, 0.99], [0.99, 1.0001]];
const bandName = (b) => `${b[0].toFixed(2)}-${b[1] > 1 ? '1.00' : b[1].toFixed(2)}`;
const REGIMES = ['early', 'contested', 'terminal'];

/** mean of x with delete-one-group jackknife SE. items: [{g, x}] */
export function jackMean(items) {
  const n = items.length; if (!n) return { n: 0, games: 0, mean: NaN, se: NaN };
  const by = new Map(); let S = 0;
  for (const it of items) { const e = by.get(it.g) ?? { s: 0, n: 0 }; e.s += it.x; e.n++; by.set(it.g, e); S += it.x; }
  const mean = S / n; const G = by.size; if (G < 2) return { n, games: G, mean, se: NaN };
  const reps = [...by.values()].map((e) => (S - e.s) / (n - e.n)); const rbar = reps.reduce((a, b) => a + b, 0) / G;
  const v = ((G - 1) / G) * reps.reduce((a, r) => a + (r - rbar) ** 2, 0);
  return { n, games: G, mean, se: Math.sqrt(v) };
}
const fee = (mult, p) => THETA * mult * p * (1 - p);

export function analyse(rows) {
  const groups = { football: (r) => r.sport !== 'mlb', mlb: (r) => r.sport === 'mlb', all: () => true };
  const report = { calibration: {}, trading: {}, counts: {} };
  for (const [gname, pred] of Object.entries(groups)) {
    const rs = rows.filter(pred); report.counts[gname] = { minutes: rs.length, games: new Set(rs.map((r) => r.g)).size };
    report.calibration[gname] = [];
    for (const b of BANDS) for (const reg of [...REGIMES, 'all']) {
      const cell = rs.filter((r) => r.mid >= b[0] && r.mid < b[1] && (reg === 'all' || r.regime === reg));
      const j = jackMean(cell.map((r) => ({ g: r.g, x: r.real - r.mid })));
      report.calibration[gname].push({ band: bandName(b), regime: reg, ...j, mid: cell.length ? cell.reduce((a, r) => a + r.mid, 0) / cell.length : NaN });
    }
    // trading rule: first qualifying minute per game per regime
    const byGame = new Map(); for (const r of rs) { if (!byGame.has(r.g)) byGame.set(r.g, []); byGame.get(r.g).push(r); }
    const variants = { baseline: (r) => true, ...Object.fromEntries(REGIMES.map((x) => [x, (r) => r.regime === x])), 'terminal&favLeads': (r) => r.regime === 'terminal' && r.favLeads === true, 'terminal&favTrails': (r) => r.regime === 'terminal' && r.favLeads === false, 'terminal-slack-1': (r) => r.regime === 'terminal' && r.slack === -1, 'terminal-deep(slack<=-2)': (r) => r.regime === 'terminal' && r.slack <= -2, 'not-terminal': (r) => r.regime !== 'terminal' };
    report.trading[gname] = {};
    for (const [vname, vp] of Object.entries(variants)) {
      const trades = [];
      for (const [g, list] of byGame) {
        const hit = list.filter((r) => r.ask >= BAND_LO && r.ask <= BAND_HI && vp(r)).sort((a, b) => a.T - b.T)[0];
        if (hit) trades.push({ g, ask: hit.ask, f: fee(hit.mult, hit.ask), pnl: hit.real - hit.ask - fee(hit.mult, hit.ask), real: hit.real });
      }
      const net = jackMean(trades.map((t) => ({ g: t.g, x: t.pnl })));
      const avg = (k) => (trades.length ? trades.reduce((a, t) => a + t[k], 0) / trades.length : NaN);
      report.trading[gname][vname] = { trades: trades.length, win: trades.length ? trades.filter((t) => t.real >= 0.999).length / trades.length : NaN, avgAsk: avg('ask'), avgFee: avg('f'), gross: avg('real') - avg('ask'), net: net.mean, se: net.se, roi: net.mean / avg('ask'), losses: trades.filter((t) => t.pnl < 0).length, worst: trades.length ? Math.min(...trades.map((t) => t.pnl)) : NaN, total: trades.reduce((a, t) => a + t.pnl, 0) };
    }
  }
  return report;
}

const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
export function markdown(report) {
  let s = '';
  for (const [g, tab] of Object.entries(report.calibration)) {
    s += `\n### Calibration, ${g} (${report.counts[g].minutes} favourite-minutes, ${report.counts[g].games} games)\n\n| mid band | regime | minutes | games | mean mid | realised - mid | SE |\n|---|---|---:|---:|---:|---:|---:|\n`;
    for (const r of tab) if (r.n) s += `| ${r.band} | ${r.regime} | ${r.n} | ${r.games} | ${f(r.mid)} | ${f(r.mean)} | ${f(r.se)} |\n`;
  }
  for (const [g, tab] of Object.entries(report.trading)) {
    s += `\n### Late-favourite rule, ${g}: buy favourite at ask in [${BAND_LO}, ${BAND_HI}], hold, taker fee; first qualifying minute per game per regime\n\n| variant | trades | win rate | avg ask | gross/contract | avg fee | net/contract | SE | ROI on cost | losing trades | worst | total net per 1 contract each |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
    for (const [v, r] of Object.entries(tab)) s += `| ${v} | ${r.trades} | ${f(r.win, 3)} | ${f(r.avgAsk)} | ${f(r.gross)} | ${f(r.avgFee)} | ${f(r.net)} | ${f(r.se)} | ${f(r.roi, 3)} | ${r.losses} | ${f(r.worst, 3)} | ${f(r.total, 2)} |\n`;
  }
  return s;
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  let summary = null;
  if (!arg('rows', null)) summary = await collect();
  if (flag('fetch-only')) { console.log(JSON.stringify(summary, null, 1)); return; }
  const rowsFile = arg('rows', ROWS);
  const rows = readFileSync(rowsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const report = analyse(rows); report.collect = summary ?? (existsSync(join(CACHE, 'collect-summary.json')) ? JSON.parse(readFileSync(join(CACHE, 'collect-summary.json'), 'utf8')) : null);
  const out = arg('out', null); if (out) writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report.collect, null, 1)); console.log(markdown(report));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
