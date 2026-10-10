#!/usr/bin/env node
// Prop-market coherence (Obsmetrologia frame 14): pathwise constraints among one game's player-prop markets.
//   node scripts/prop-coherence.mjs scan    [--sports nfl,mlb,nhl,nba] [--out file.json]
//   node scripts/prop-coherence.mjs history [--from 2026-09-04] [--to 2026-10-06] [--sports nfl,nhl,nba,mlb]
//                                           [--max-games N] [--lead-hours 2] [--collect-only] [--out file.json]
// Public read-only GETs, no auth, never an order. >= 450 ms between requests; HTTP 429 -> back off 5-20 s,
// 5 consecutive 429s -> stop and report partial results. Cache: props-cache/ in the session scratchpad.
import fs from 'node:fs';
import path from 'node:path';
import { SPORTS } from '../src/sport-feeds.mjs';
import { normMarket, buildConstraints, checkConstraints, projectMids } from '../src/prop-identities.mjs';

const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const CACHE = process.env.PROP_CACHE || '/tmp/claude-1000/-home-emsenn-info/bfd39b66-66a8-4bd1-abf7-8a75503c9632/scratchpad/props-cache';
fs.mkdirSync(CACHE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 450;
let last = 0, consecutive429 = 0, stopped = false;
class Stop extends Error {}
async function get(p) {
  if (stopped) throw new Stop('stopped after repeated 429');
  for (;;) {
    const w = last + GAP - Date.now(); if (w > 0) await sleep(w); last = Date.now();
    const r = await fetch(BASE + p, { headers: { accept: 'application/json', 'user-agent': 'prop-coherence/1 (read-only)' } });
    if (r.status === 429) {
      if (++consecutive429 > 5) { stopped = true; throw new Stop(`5 consecutive 429s at ${p}`); }
      await sleep(5000 + Math.random() * 15000); continue;
    }
    consecutive429 = 0;
    if (!r.ok) throw new Error(`HTTP ${r.status} ${p}`);
    return r.json();
  }
}
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(`--${n}`);
const sports = opt('sports', 'nfl,nhl,nba,mlb').split(',');
const seriesOf = (sp) => SPORTS[sp].props;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v));

async function feeMultipliers(list) {
  const f = path.join(CACHE, 'series-fee.json');
  const cache = readJson(f, {});
  for (const s of list) if (cache[s] === undefined) {
    try { const j = await get(`/series/${s}`); cache[s] = Number(j.series?.fee_multiplier ?? 1) || 1; } catch (e) { if (e instanceof Stop) throw e; cache[s] = 1; }
  }
  writeJson(f, cache);
  return cache;
}

const sportOfSeries = (s) => Object.keys(SPORTS).find((sp) => SPORTS[sp].props.includes(s));
const feeFor = (fm, s) => fm[s] ?? 1;

// ------------------------------------------------------------------ analysis helpers (shared)
function summariseChecks(results) {
  const viol = results.filter((r) => r.edge > 1e-9 && r.executable);
  return viol;
}
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f4 = (x) => (x == null ? 'n/a' : x.toFixed(4));

// ------------------------------------------------------------------ scan
async function scan() {
  const out = { at: new Date().toISOString(), sports: {}, violations: [], games: [], nearest: [], partial: false };
  const all = sports.flatMap((sp) => seriesOf(sp));
  let fm;
  try {
    fm = await feeMultipliers(all);
    const games = new Map(); // `${sport}:${game}` -> markets
    for (const sp of sports) for (const s of seriesOf(sp)) {
      let cursor = '';
      for (let page = 0; page < 10; page++) {
        const j = await get(`/events?series_ticker=${s}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
        for (const e of j.events ?? []) for (const m of e.markets ?? []) {
          if (m.status !== 'active') continue;
          const nm = normMarket(m, { feeMultiplier: feeFor(fm, s) });
          const key = `${sp}:${nm.game}`;
          if (!games.has(key)) games.set(key, []);
          games.get(key).push(nm);
        }
        cursor = j.cursor; if (!cursor) break;
      }
    }
    for (const [key, ms] of games) {
      const sp = key.split(':')[0];
      const cs = buildConstraints(ms);
      const byT = new Map(ms.map((m) => [m.ticker, m]));
      const res = checkConstraints(cs, byT);
      const quoted = ms.filter((m) => m.mid != null);
      const qc = buildConstraints(quoted);
      const pr = quoted.length ? projectMids(quoted, qc) : null;
      let resid = 0, maxMove = 0;
      if (pr) for (const m of quoted) { const d = pr.proj.get(m.ticker) - m.mid; resid += d * d; maxMove = Math.max(maxMove, Math.abs(d)); }
      const v = summariseChecks(res);
      const rawV = res.filter((r) => r.rawEdge > 1e-9 && r.executable);
      const exe = res.filter((r) => r.executable).sort((a, b) => b.edge - a.edge);
      for (const r of exe.slice(0, 3)) out.nearest.push({ game: key, ...r });
      const midViol = res.filter((r) => r.midsResidual != null && r.midsResidual > 1e-9);
      out.games.push({ key, sport: sp, markets: ms.length, quoted: quoted.length, constraints: cs.length, evaluable: res.length, violations: v.length, rawViolationsBeforeFees: rawV.length, bestNetEdge: exe[0]?.edge ?? null, midViolations: midViol.length, midResidualL2: Math.sqrt(resid), maxMove, converged: pr?.converged ?? null });
      for (const r of v) out.violations.push({ game: key, ...r });
    }
  } catch (e) {
    if (e instanceof Stop) out.partial = true; else throw e;
    out.error = String(e.message);
  }
  const by = {};
  for (const g of out.games) { const b = (by[g.sport] ??= { games: 0, markets: 0, constraints: 0, evaluable: 0, violations: 0, midViolations: 0, gamesWithViolation: 0, maxMove: 0 }); b.games++; b.markets += g.markets; b.constraints += g.constraints; b.evaluable += g.evaluable; b.violations += g.violations; b.rawViolationsBeforeFees = (b.rawViolationsBeforeFees ?? 0) + g.rawViolationsBeforeFees; b.bestNetEdge = Math.max(b.bestNetEdge ?? -9, g.bestNetEdge ?? -9); b.midViolations += g.midViolations; b.gamesWithViolation += g.violations ? 1 : 0; b.maxMove = Math.max(b.maxMove, g.maxMove); }
  out.sports = by;
  out.violations.sort((a, b) => b.edge - a.edge);
  out.nearest.sort((a, b) => b.edge - a.edge);
  const byKind = {}; for (const v of out.violations) byKind[v.kind] = (byKind[v.kind] ?? 0) + 1;
  out.violationsByKind = byKind;
  console.log(JSON.stringify({ at: out.at, partial: out.partial, sports: out.sports, violationsByKind: byKind }, null, 1));
  for (const v of out.nearest.slice(0, 6)) console.log(`nearest: net edge ${f4(v.edge)} raw ${f4(v.rawEdge)} ${v.kind} ${v.id}`);
  for (const v of out.violations.slice(0, 15)) console.log(`edge ${f4(v.edge)} depth ${v.depth ?? 'n/a'} ${v.kind} ${v.id}`);
  const f = opt('out', path.join(CACHE, 'scan.json')); writeJson(f, out); console.error('wrote', f);
}

// ------------------------------------------------------------------ history
const DAY = 86400;
async function collectSeries(s, fromTs, toTs) {
  const f = path.join(CACHE, `markets-${s}-${fromTs}-${toTs}.json`);
  const c = readJson(f, null); if (c) return c;
  const keep = [];
  let cursor = '';
  for (let p = 0; p < 60; p++) {
    const j = await get(`/markets?series_ticker=${s}&status=settled&limit=1000&min_close_ts=${fromTs}&max_close_ts=${toTs}${cursor ? `&cursor=${cursor}` : ''}`);
    for (const m of j.markets) keep.push({ ticker: m.ticker, strike_type: m.strike_type, floor_strike: m.floor_strike, yes_sub_title: m.yes_sub_title, result: m.result, settlement_value_dollars: m.settlement_value_dollars, occurrence_datetime: m.occurrence_datetime, volume_fp: m.volume_fp });
    cursor = j.cursor; if (!cursor || !j.markets.length) break;
  }
  writeJson(f, keep); return keep;
}
const gameStart = (m) => Date.parse(m.occurrence_datetime) / 1000 - 3 * 3600; // occurrence_datetime = start + 3h on every prop series seen

async function collectCandles(game, markets, leadH) {
  const f = path.join(CACHE, `candles-${game}.json`);
  const c = readJson(f, {});
  const start = gameStart(markets[0]);
  const need = markets.filter((m) => c[m.ticker] === undefined);
  for (let i = 0; i < need.length; i += 50) {
    const ch = need.slice(i, i + 50);
    const j = await get(`/markets/candlesticks?market_tickers=${ch.map((m) => m.ticker).join(',')}&start_ts=${start - (leadH + 24) * 3600}&end_ts=${start - leadH * 3600}&period_interval=60`);
    const got = new Map((j.markets ?? []).map((x) => [x.market_ticker, x.candlesticks]));
    for (const m of ch) {
      const cs = got.get(m.ticker) ?? [];
      let q = null;
      for (let k = cs.length - 1; k >= 0; k--) {
        const x = cs[k]; const b = Number(x.yes_bid?.close_dollars), a = Number(x.yes_ask?.close_dollars);
        if (Number.isFinite(a) && Number.isFinite(b) && x.end_period_ts <= start - leadH * 3600) { q = { bid: b, ask: a, ts: x.end_period_ts, oi: Number(x.open_interest_fp), vol: Number(x.volume_fp) }; break; }
      }
      c[m.ticker] = q;
    }
  }
  writeJson(f, c); return c;
}

function jackknife(per) { // per: [{d, n}] per game; statistic = sum d / sum n
  const D = per.reduce((s, x) => s + x.d, 0), N = per.reduce((s, x) => s + x.n, 0);
  const G = N ? D / N : null; const g = per.length;
  const B = per.reduce((s, x) => s + (x.b ?? 0), 0);
  if (g < 2 || !N) return { gain: G, se: null, games: g, n: N, brierMid: N ? B / N : null };
  const loo = per.map((x) => (N - x.n > 0 ? (D - x.d) / (N - x.n) : G));
  const mean = loo.reduce((s, x) => s + x, 0) / g;
  const se = Math.sqrt(((g - 1) / g) * loo.reduce((s, x) => s + (x - mean) ** 2, 0));
  return { gain: G, se, games: g, n: N, brierMid: B / N, relGain: B ? D / B : null };
}

async function history() {
  const fromTs = Math.floor(Date.parse(opt('from', '2026-09-04')) / 1000);
  const toTs = Math.floor(Date.parse(opt('to', '2026-10-06')) / 1000) + DAY;
  const leadH = Number(opt('lead-hours', '2'));
  const maxGames = Number(opt('max-games', '100000'));
  const out = { from: opt('from', '2026-09-04'), to: opt('to', '2026-10-06'), leadHours: leadH, partial: false, notes: [] };
  let fm = {};
  const gamesAll = []; // {sport, game, markets:[norm+quote+outcome]}
  try {
    fm = await feeMultipliers(sports.flatMap((sp) => seriesOf(sp)));
    for (const sp of sports) {
      const byGame = new Map();
      for (const s of seriesOf(sp)) {
        const ms = await collectSeries(s, fromTs, toTs);
        for (const m of ms) { const g = m.ticker.split('-')[1]; if (!byGame.has(g)) byGame.set(g, []); byGame.get(g).push(m); }
      }
      const keys = [...byGame.keys()].sort();
      const step = Math.max(1, Math.ceil(keys.length / maxGames));
      const chosen = keys.filter((_, i) => i % step === 0);
      if (step > 1) out.notes.push(`${sp}: every ${step}th of ${keys.length} games`);
      for (const g of chosen) gamesAll.push({ sport: sp, game: g, raw: byGame.get(g) });
    }
    if (!flag('analyze-only')) for (const G of gamesAll) {
      const q = await collectCandles(G.game, G.raw, leadH);
      G.q = q;
    }
  } catch (e) { if (e instanceof Stop) { out.partial = true; out.notes.push(String(e.message)); } else throw e; }
  if (flag('collect-only')) { console.log('collected', gamesAll.length, 'games', out.partial ? 'PARTIAL' : ''); return; }
  // --------- analysis
  const variants = { ladder: ['ladder'], 'ladder+impl+sum': ['ladder', 'implication', 'sum'], all: ['ladder', 'implication', 'sum', 'exclusive', 'notd'] };
  const acc = {}; // variant -> key -> [{game,d,n}] ; key = `sport` | `sport:series` | 'ALL'
  const book = {}; // dutch-book accounting
  const addPer = (v, k, game, d, n, b) => { ((acc[v] ??= {})[k] ??= new Map()); const mp = acc[v][k]; const e = mp.get(game) ?? { d: 0, n: 0, b: 0 }; e.d += d; e.n += n; e.b += b; mp.set(game, e); };
  let gamesUsed = 0, nonConv = 0, voided = 0;
  for (const G of gamesAll) {
    const cacheQ = G.q ?? readJson(path.join(CACHE, `candles-${G.game}.json`), {});
    const voidKeys = new Set();
    const ms = [];
    for (const r of G.raw) {
      const nm = normMarket({ ...r, yes_bid_dollars: cacheQ[r.ticker]?.bid, yes_ask_dollars: cacheQ[r.ticker]?.ask }, { feeMultiplier: fm[r.ticker.split('-')[0]] ?? 1 });
      const sv = Number(r.settlement_value_dollars);
      if (!(sv === 0 || sv === 1)) { voidKeys.add(nm.key); voided++; continue; }
      nm.y = sv; nm.q = cacheQ[r.ticker];
      ms.push(nm);
    }
    const live = ms.filter((m) => m.q && !voidKeys.has(m.key));
    const quoted = live.filter((m) => m.mid != null);
    if (quoted.length < 2) continue;
    gamesUsed++;
    const byT = new Map(quoted.map((m) => [m.ticker, m]));
    // Dutch books at the (hourly close) touch
    const all = buildConstraints(quoted);
    const res = checkConstraints(all, byT);
    const bk = (book[G.sport] ??= { games: 0, gamesWithViol: 0, byKind: {} });
    bk.games++; let any = false;
    for (const r of res) {
      const b = (bk.byKind[r.kind] ??= { evaluable: 0, violated: 0, rawViolated: 0, midViolated: 0, edges: [], rawEdges: [] });
      b.evaluable++;
      if (r.rawEdge > 1e-9 && r.executable) { b.rawViolated++; b.rawEdges.push(r.rawEdge); }
      if (r.midsResidual != null && r.midsResidual > 1e-9) b.midViolated++;
      if (r.edge > 1e-9 && r.executable) { b.violated++; b.edges.push(r.edge); any = true; }
    }
    if (any) bk.gamesWithViol++;
    for (const [vn, kinds] of Object.entries(variants)) {
      const cs = all.filter((c) => kinds.includes(c.kind));
      const { proj, converged } = projectMids(quoted, cs);
      if (!converged) nonConv++;
      for (const m of quoted) {
        const p = proj.get(m.ticker);
        const bm = (m.mid - m.y) ** 2, bp = (p - m.y) ** 2;
        const tight = m.ask - m.bid <= 0.06;
        for (const k of ['ALL', G.sport, `${G.sport}:${m.series}`, ...(tight ? ['ALL|tight', `${G.sport}|tight`] : ['ALL|wide', `${G.sport}|wide`])]) addPer(vn, k, G.game, bm - bp, 1, bm);
      }
    }
  }
  out.gamesUsed = gamesUsed; out.nonConverged = nonConv; out.voidedMarkets = voided;
  out.brierGain = {};
  for (const [vn, ks] of Object.entries(acc)) for (const [k, mp] of Object.entries(ks)) {
    const j = jackknife([...mp.values()]);
    (out.brierGain[vn] ??= {})[k] = j;
  }
  out.dutchBooks = {};
  for (const [sp, b] of Object.entries(book)) {
    out.dutchBooks[sp] = { games: b.games, gamesWithViolation: b.gamesWithViol, byKind: Object.fromEntries(Object.entries(b.byKind).map(([k, v]) => [k, { evaluable: v.evaluable, midViolated: v.midViolated, rawViolatedBeforeFees: v.rawViolated, maxRawEdgeBeforeFees: v.rawEdges.length ? Math.max(...v.rawEdges) : null, violated: v.violated, rate: v.evaluable ? v.violated / v.evaluable : null, medianEdge: median(v.edges), maxEdge: v.edges.length ? Math.max(...v.edges) : null, sumEdge: v.edges.reduce((s, x) => s + x, 0) }])) };
  }
  console.log(JSON.stringify(out, null, 1));
  const f = opt('out', path.join(CACHE, 'history.json')); writeJson(f, out); console.error('wrote', f);
}

if (cmd === 'scan') await scan();
else if (cmd === 'history') await history();
else { console.error('usage: prop-coherence.mjs scan|history [options]'); process.exit(2); }
