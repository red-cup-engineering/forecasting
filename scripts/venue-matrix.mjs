#!/usr/bin/env node
/**
 * venue-matrix.mjs scan [--sports nfl,mlb,...] [--out file]
 *
 * Live, read-only. Builds the claim x venue matrix for upcoming games (see ../src/venue-matrix.mjs) from public
 * read endpoints only; no account, no wallet, no order. Requests are paced >= 350 ms apart per host and a host that
 * answers HTTP 429 is stopped for the rest of the run.
 *
 *   spine        ESPN scoreboard (site.api.espn.com), also the sportsbook column (competitions[0].odds moneyline)
 *   kalshi       api.elections.kalshi.com/trade-api/v2 /events?series_ticker=KX<L>GAME&status=open&with_nested_markets=true
 *   polymarket   gamma-api.polymarket.com /sports, /events?series_id=..; clob.polymarket.com /book?token_id=..
 *   azuro        api.onchainfeed.org/api/v1/public/market-manager games-by-filters, conditions-by-game-ids (odds only)
 * Dropped (verified live): Overtime/Thales (API key required), Manifold (no per-game winner markets).
 */
import { writeFileSync } from 'node:fs';
import { SPORTS, kalshiSides, matchGames, normalizeScoreboard, sideMatches } from '../src/sport-feeds.mjs';
import { americanToProb, bookEntry, claimRow, columnScores, coverEdge, complement, decimalToProb, devig, kalshiFee, polymarketFee, pointEntry } from '../src/venue-matrix.mjs';

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const AZURO = 'https://api.onchainfeed.org/api/v1/public/market-manager';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const PM_SPORT = { nfl: 'nfl', ncaaf: 'cfb', mlb: 'mlb', nhl: 'nhl', nba: 'nba', wnba: 'wnba', epl: 'epl', ucl: 'ucl', laliga: 'lal', bundesliga: 'bun', seriea: 'sea', ligue1: 'fl1', mls: 'mls' };
const AZ_SPORT = { football: 'american-football', baseball: 'baseball', hockey: 'ice-hockey', basketball: 'basketball', soccer: 'football' };
const DEFAULT_SPORTS = 'nfl,ncaaf,mlb,nhl,nba,epl,ucl,laliga,bundesliga,seriea,ligue1,mls';
const PACE_MS = 350; const HOST_PACE = { 'api.elections.kalshi.com': 900 }; // Kalshi answered 429 at 350 ms

// ---------------------------------------------------------------- paced, 429-aware http
const lastAt = new Map(); const stopped = new Set(); const log = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(url, init) {
  const host = new URL(url).host;
  if (stopped.has(host)) return null;
  const wait = (lastAt.get(host) ?? 0) + (HOST_PACE[host] ?? PACE_MS) - Date.now(); if (wait > 0) await sleep(wait);
  lastAt.set(host, Date.now());
  try {
    const res = await fetch(url, { ...init, headers: { accept: 'application/json', 'user-agent': 'venue-matrix/1 (read-only research)', ...(init?.headers ?? {}) }, signal: AbortSignal.timeout(30000) });
    if (res.status === 429) { stopped.add(host); log.push(`${host}: HTTP 429, host stopped`); return null; }
    if (!res.ok) { log.push(`${host}: HTTP ${res.status} ${url.slice(0, 120)}`); return null; }
    return await res.json();
  } catch (e) { log.push(`${host}: ${e.message} ${url.slice(0, 100)}`); return null; }
}

// ---------------------------------------------------------------- ESPN spine + sportsbook odds
async function espnGames(key) {
  const s = SPORTS[key]; const urls = [`${ESPN}/${s.espn}/scoreboard${key === 'ncaaf' ? '?groups=80&limit=200' : ''}`];
  if (['mlb', 'nhl', 'nba', 'wnba'].includes(key)) for (const d of [1, 2]) urls.push(`${ESPN}/${s.espn}/scoreboard?dates=${new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10).replaceAll('-', '')}`);
  const seen = new Map();
  for (const u of urls) {
    const j = await http(u); if (!j) continue;
    const raw = new Map((j.events ?? []).map((e) => [String(e.id), e]));
    for (const g of normalizeScoreboard('team', j)) {
      if (g.state !== 'pre' || seen.has(g.id)) continue;
      seen.set(g.id, { ...g, odds: espnOdds(raw.get(g.id)) });
    }
  }
  return [...seen.values()];
}
/** ESPN event -> per-competitor-index moneyline implied (with vig) probabilities and the draw, or null. */
function espnOdds(ev) {
  const c = ev?.competitions?.[0]; const o = c?.odds?.[0]; if (!o?.moneyline) return null;
  const ml = (side) => americanToProb(o.moneyline?.[side]?.close?.odds ?? o.moneyline?.[side]?.open?.odds);
  const raw = c.competitors.map((t) => ml(t.homeAway)); const draw = o.drawOdds?.moneyLine !== undefined ? americanToProb(o.drawOdds.moneyLine) : null;
  if (raw.some((p) => p === null)) return null;
  return { provider: o.provider?.name ?? 'sportsbook', raw, draw };
}

/**
 * Which competitor each name denotes, one-to-one. A short name can match several competitors ("Louisiana" is a
 * prefix of "Louisiana Tech"), so a name with one candidate claims it first and the rest take what is left.
 */
export function resolveSides(names, competitors) {
  const cand = names.map((n) => competitors.map((c, i) => (n !== null && sideMatches(n, c) ? i : -1)).filter((i) => i >= 0));
  const out = names.map(() => -1); const taken = new Set();
  for (let round = 0; round < names.length; round++) {
    let moved = false;
    cand.forEach((cs, k) => { const free = cs.filter((i) => !taken.has(i)); if (out[k] < 0 && free.length === 1) { out[k] = free[0]; taken.add(free[0]); moved = true; } });
    if (!moved) break;
  }
  return out;
}

// ---------------------------------------------------------------- Kalshi
async function kalshiEvents(key) {
  const series = SPORTS[key].game; const meta = await http(`${KALSHI}/series/${series}`);
  const mult = Number(meta?.series?.fee_multiplier ?? 1);
  const events = []; let cursor = '';
  do {
    const j = await http(`${KALSHI}/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    if (!j) break; events.push(...j.events); cursor = j.cursor ?? '';
  } while (cursor);
  return { events, fee: kalshiFee(mult), mult };
}
function kalshiEntries(ev, game, fee) {
  const out = new Map(); const mk = ev.markets ?? [];
  const idxs = resolveSides(mk.map((m) => (/^tie$/iu.test(m.yes_sub_title) ? null : m.yes_sub_title)), game.competitors);
  for (const [k, m] of mk.entries()) {
    const sub = m.yes_sub_title; const idx = idxs[k];
    const claim = idx >= 0 ? `win:${idx}` : /^tie$/iu.test(sub) ? 'draw' : null; if (!claim) continue;
    out.set(claim, bookEntry({ venue: 'kalshi', claim, bid: m.yes_bid_dollars, ask: m.yes_ask_dollars, fee, bidSize: Number(m.yes_bid_size_fp), askSize: Number(m.yes_ask_size_fp) }));
  }
  return out;
}

// ---------------------------------------------------------------- Polymarket
async function polySeries() { const j = await http(`${GAMMA}/sports`); return new Map((j ?? []).map((s) => [s.sport, s.series])); }
async function polyEvents(seriesId) {
  const out = [];
  for (let off = 0; off < 600; off += 100) {
    const j = await http(`${GAMMA}/events?series_id=${seriesId}&closed=false&limit=100&offset=${off}`);
    if (!j) break; out.push(...j); if (j.length < 100) break;
  }
  return out.filter((e) => /-\d{4}-\d\d-\d\d$/u.test(e.slug) && (e.markets ?? []).some((m) => m.sportsMarketType === 'moneyline'));
}
const polyMatches = (e, g) => {
  const sides = (e.title ?? '').split(/\s+vs\.?\s+/iu); if (sides.length !== 2 || g.competitors.length !== 2) return false;
  if (Math.abs(Date.parse(e.startTime) - Date.parse(g.start)) > 6 * 3600e3) return false;
  const [x, y] = g.competitors;
  return (sideMatches(sides[0], x) && sideMatches(sides[1], y)) || (sideMatches(sides[0], y) && sideMatches(sides[1], x));
};
async function topOfBook(tokenId, fallback) {
  const j = await http(`${CLOB}/book?token_id=${tokenId}`);
  if (j && Array.isArray(j.bids) && Array.isArray(j.asks)) {
    const bid = j.bids.reduce((a, b) => (Number(b.price) > Number(a?.price ?? -1) ? b : a), null);
    const ask = j.asks.reduce((a, b) => (Number(b.price) < Number(a?.price ?? 2) ? b : a), null);
    return { bid: bid ? Number(bid.price) : null, ask: ask ? Number(ask.price) : null, bidSize: bid ? Number(bid.size) : null, askSize: ask ? Number(ask.size) : null, src: 'clob' };
  }
  return { ...fallback, src: 'gamma' };
}
async function polyEntries(ev, game) {
  const out = new Map(); const tokens = (m) => JSON.parse(m.clobTokenIds ?? '[]');
  for (const m of ev.markets) {
    if (m.sportsMarketType !== 'moneyline' || m.closed || m.acceptingOrders === false) continue;
    const outcomes = JSON.parse(m.outcomes ?? '[]'); const rate = Number(m.feeSchedule?.rate ?? m.feeRate ?? 0.05); const fee = polymarketFee(rate);
    const fb = { bid: Number(m.bestBid) || null, ask: Number(m.bestAsk) || null };
    const toks = tokens(m); if (!toks.length) continue;
    const t0 = await topOfBook(toks[0], fb);
    if (outcomes[0] === 'Yes') { // soccer: one Yes/No market per claim
      const claim = /draw/iu.test(m.question) ? 'draw' : (() => { const nm = /^Will (.+?) win\b/iu.exec(m.question)?.[1]; const i = nm ? resolveSides([nm], game.competitors)[0] : -1; return i >= 0 ? `win:${i}` : null; })();
      if (claim) out.set(claim, bookEntry({ venue: 'polymarket', claim, bid: t0.bid, ask: t0.ask, fee, bidSize: t0.bidSize, askSize: t0.askSize }));
    } else { // two-way moneyline: token 0 is outcomes[0]; the other side is its complement
      const [i0, i1] = resolveSides(outcomes, game.competitors);
      if (i0 < 0 || i1 < 0 || i0 === i1) continue;
      const e0 = bookEntry({ venue: 'polymarket', claim: `win:${i0}`, bid: t0.bid, ask: t0.ask, fee, bidSize: t0.bidSize, askSize: t0.askSize });
      out.set(`win:${i0}`, e0); out.set(`win:${i1}`, complement(e0, `win:${i1}`));
    }
  }
  return out;
}

// ---------------------------------------------------------------- Azuro (odds only)
async function azuroGames(kind) {
  const slug = AZ_SPORT[kind]; if (!slug) return [];
  const out = [];
  for (let page = 1; page <= 6; page++) {
    const j = await http(`${AZURO}/games-by-filters?gameState=Prematch&environment=PolygonUSDT&orderBy=startsAt&orderDirection=asc&page=${page}&sportSlug=${slug}&perPage=100`);
    if (!j) break; out.push(...j.games); if (page >= j.totalPages) break;
  }
  return out;
}
const azMatches = (a, g) => {
  const sides = (a.title ?? '').split(/\s+-\s+/u); if (sides.length !== 2 || g.competitors.length !== 2) return false;
  if (Math.abs(Number(a.startsAt) * 1000 - Date.parse(g.start)) > 3 * 3600e3) return false;
  const [x, y] = g.competitors;
  return (sideMatches(sides[0], x) && sideMatches(sides[1], y)) || (sideMatches(sides[0], y) && sideMatches(sides[1], x));
};
async function azuroEntries(a, game, draws) {
  const j = await http(`${AZURO}/conditions-by-game-ids`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameIds: [a.gameId], environment: 'PolygonUSDT' }) });
  const conds = (j?.conditions ?? []).filter((c) => c.state === 'Active');
  // The full-game result with exactly the outcomes the sport's claims have: two ways, or three for soccer.
  const cond = conds.find((c) => c.outcomes.length === (draws ? 3 : 2) && (draws ? c.title === 'Full Time Result' : c.title === 'Game: Winner'));
  if (!cond) return new Map();
  const claims = []; const raw = [];
  const idxs = resolveSides(cond.outcomes.map((o) => (/^draw$/iu.test(o.title) ? null : o.title)), game.competitors);
  for (const [k, o] of cond.outcomes.entries()) {
    const claim = /^draw$/iu.test(o.title) ? 'draw' : idxs[k] >= 0 ? `win:${idxs[k]}` : null;
    if (!claim) return new Map(); claims.push(claim); raw.push(decimalToProb(o.odds));
  }
  const d = devig(raw); if (!d) return new Map();
  return new Map(claims.map((c, i) => [c, pointEntry({ venue: 'azuro', claim: c, p: d.probs[i], vig: d.vig })]));
}

// ---------------------------------------------------------------- assemble
function espnEntries(game) {
  const o = game.odds; const out = new Map(); if (!o) return out;
  const hasDraw = o.draw !== null && o.draw !== undefined; const d = devig(hasDraw ? [...o.raw, o.draw] : o.raw); if (!d) return out;
  d.probs.slice(0, 2).forEach((p, i) => out.set(`win:${i}`, pointEntry({ venue: 'espn-book', claim: `win:${i}`, p, vig: d.vig })));
  if (hasDraw) out.set('draw', pointEntry({ venue: 'espn-book', claim: 'draw', p: d.probs[2], vig: d.vig }));
  return out;
}

export async function scan({ sports }) {
  const pmSeries = await polySeries(); const games = []; const fees = {};
  for (const key of sports) {
    const gs = await espnGames(key); if (!gs.length) continue;
    const k = await kalshiEvents(key); fees[key] = { kalshiMultiplier: k.mult };
    const { matched } = matchGames(gs, k.events);
    const kalshiOf = new Map(matched.map((m) => [m.game.id, m.event]));
    const pmAll = PM_SPORT[key] && pmSeries.has(PM_SPORT[key]) ? await polyEvents(pmSeries.get(PM_SPORT[key])) : [];
    const kind = SPORTS[key].espn.startsWith('soccer') ? 'soccer' : SPORTS[key].espn.split('/')[0];
    const azAll = await azuroGames(kind);
    const draws = kind === 'soccer';
    for (const g of gs) {
      const columns = {};
      const kev = kalshiOf.get(g.id); if (kev) columns.kalshi = kalshiEntries(kev, g, k.fee);
      const pev = pmAll.find((e) => polyMatches(e, g)); if (pev) columns.polymarket = await polyEntries(pev, g);
      const aev = azAll.find((a) => azMatches(a, g)); if (aev) columns.azuro = await azuroEntries(aev, g, draws);
      const eb = espnEntries(g); if (eb.size) columns['espn-book'] = eb;
      const claimIds = ['win:0', 'win:1', ...(draws ? ['draw'] : [])];
      const rows = claimIds.map((c) => claimRow(c, Object.values(columns).map((m) => m.get(c)).filter(Boolean)));
      const cover = coverEdge(claimIds.map((c) => Object.values(columns).map((m) => m.get(c)).filter(Boolean)));
      games.push({ sport: key, id: g.id, name: g.name, start: g.start, teams: g.competitors.map((c) => c.key), venues: Object.keys(columns), rows, cover, vig: Object.fromEntries(Object.entries(columns).map(([v, m]) => [v, [...m.values()][0]?.vig ?? null]).filter(([, x]) => x !== null)) });
    }
  }
  return { generatedAt: new Date().toISOString(), games, fees };
}

// ---------------------------------------------------------------- summary + print
export function summarize(res) {
  const pairs = {}; const rows = res.games.flatMap((g) => g.rows.filter((r) => r.entries.length).map((r) => Object.assign(r, { game: `${g.sport} ${g.name}`, label: r.claim === 'draw' ? 'draw' : `${g.teams[Number(r.claim.slice(4))]} wins` })));
  for (const g of res.games) for (let i = 0; i < g.venues.length; i++) for (let j = i + 1; j < g.venues.length; j++) { const k = `${g.venues[i]}+${g.venues[j]}`; pairs[k] = (pairs[k] ?? 0) + 1; }
  const gaps = rows.map((r) => ({ r, gap: r.gap })).filter((x) => x.gap).sort((a, b) => b.gap.gross - a.gap.gross);
  const dist = rows.flatMap((r) => r.entries.flatMap((x, i) => r.entries.slice(i + 1).map((y) => ({ r, a: x.venue, b: y.venue, d: Math.max(0, x.lo - y.hi, y.lo - x.hi) })))).sort((a, b) => b.d - a.d);
  return {
    games: res.games.length, gamesBySport: res.games.reduce((a, g) => ({ ...a, [g.sport]: (a[g.sport] ?? 0) + 1 }), {}), pairs,
    topExecutableGaps: gaps.slice(0, 8).map((x) => ({ game: x.r.game, claim: x.r.label, ...x.r.gap })),
    topIntervalDistances: dist.slice(0, 8).map((x) => ({ game: x.r.game, claim: x.r.label, a: x.a, b: x.b, d: x.d })),
    grossGapClaims: gaps.filter((x) => x.gap.gross > 1e-9).length, dutchClaims: gaps.filter((x) => x.gap.net > 0).length, grossCovers: res.games.filter((g) => g.cover && g.cover.gross > 1e-9).length, dutchCovers: res.games.filter((g) => g.cover && g.cover.net > 0).length,
    scores: columnScores(rows),
  };
}
const f = (x) => (x === null || x === undefined ? '  -  ' : x.toFixed(3));
function print(res) {
  for (const g of res.games) {
    if (g.venues.length < 2) continue;
    console.log(`\n${g.sport.toUpperCase()} ${g.name}  ${g.start}  [${g.venues.join(', ')}]  vig ${Object.entries(g.vig).map(([v, x]) => `${v}=${(x * 100).toFixed(1)}%`).join(' ')}`);
    for (const r of g.rows) {
      const cons = r.consensus ? (r.consensus.empty ? `EMPTY by ${f(r.consensus.size)}` : `[${f(r.consensus.lo)},${f(r.consensus.hi)}]`) : 'n/a';
      const cols = r.entries.map((e) => `${e.venue}${e.executable ? `[${f(e.lo)},${f(e.hi)}]` : `~${f(e.lo)}`}:${r.readings[e.venue].reading}${r.readings[e.venue].direction === 'inside' || r.readings[e.venue].direction === 'none' ? '' : `/${r.readings[e.venue].direction}`}`).join('  ');
      const gap = r.gap ? `bid-over-ask ${r.gap.gross.toFixed(3)} gross, ${r.gap.net.toFixed(3)} net of fees (buy ${r.gap.buy}, sell ${r.gap.sell})` : 'bid-over-ask n/a';
      const label = r.claim === 'draw' ? 'draw' : `${g.teams[Number(r.claim.slice(4))]} wins`;
      console.log(`  ${label.padEnd(26)} cons ${cons.padEnd(18)} ${gap}\n      ${cols}`);
    }
    if (g.cover) console.log(`  cover cost ${(1 - g.cover.gross).toFixed(3)} -> edge ${g.cover.gross.toFixed(3)} gross ${g.cover.net.toFixed(3)} net (${g.cover.legs.map((l) => `${l.claim}@${l.venue}`).join(' ')})${g.cover.crossVenue ? ' CROSS-VENUE' : ''}`);
  }
}

const argv = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}`) {
  if (argv[0] !== 'scan') { console.error('usage: venue-matrix.mjs scan [--sports nfl,mlb,...] [--out file]'); process.exit(2); }
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const sports = (opt('--sports') ?? DEFAULT_SPORTS).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const s of sports) if (!SPORTS[s]) { console.error(`unknown sport ${s}`); process.exit(2); }
  const res = await scan({ sports }); res.summary = summarize(res); res.log = log;
  print(res); console.log('\nSUMMARY', JSON.stringify(res.summary, null, 1)); if (log.length) console.log('LOG', log);
  if (opt('--out')) writeFileSync(opt('--out'), JSON.stringify(res, null, 1));
}
