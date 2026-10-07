// Scan Kalshi's public API for pathwise identities (baskets with a rule-constant payoff) and price them.
// Read-only GETs, no auth, no orders. >=160 ms between requests; stops on the first HTTP 429 (no retries).
//
//   node scripts/pathwise-identities.mjs scan [--out file.json] [--theta 0.07] [--fee-round none|cent]
//        [--max-tie-games 3|hard] [--no-games] [--top 12] [--rules]
//
// Every identity below is justified by (a) the Kalshi market's own rules text (quoted into the JSON/--rules
// output) and (b) a rule of the sport (slot counts, schedule length). Exhaustiveness (the listed markets are
// ALL the outcomes) is asserted only when the number of markets in the event equals the known league size;
// otherwise the identity is one-sided ([0, k]).
import fs from 'node:fs';
import {
  exclusiveIdentity, countIdentity, winConservationIdentity,
  priceIdentity, projectOntoIdentity, ladderExpectation,
} from '../src/pathwise-identities.mjs';

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const ESPN_NFL = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';
let MIN_GAP_MS = 350; // >=150 ms required; Kalshi 429s a 160 ms cadence on nested-market event pulls, so default slower (--gap)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ http (paced, 429 = stop)
class Stop extends Error {}
let lastReq = 0;
let stopped = false;
const errors = [];
async function getJson(url) {
  if (stopped) throw new Stop('stopped after 429');
  const wait = lastReq + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastReq = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'forecasting-pathwise-identities/1 (read-only)' } });
  if (r.status === 429) { stopped = true; throw new Stop(`HTTP 429 ${url}`); }
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
async function events(series) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 6; page++) {
    const q = new URLSearchParams({ series_ticker: series, status: 'open', with_nested_markets: 'true', limit: '200' });
    if (cursor) q.set('cursor', cursor);
    const d = await getJson(`${KALSHI}/events?${q}`);
    out.push(...(d.events || []));
    cursor = d.cursor;
    if (!cursor || !(d.events || []).length) break;
  }
  return out;
}
async function safeEvents(series) {
  try { return await events(series); } catch (e) { if (e instanceof Stop) throw e; errors.push(`${series}: ${e.message}`); return []; }
}

// ------------------------------------------------------------------ helpers
const num = (x) => (x == null || x === '' ? null : Number(x));
const book = (m) => ({ bid: num(m.yes_bid_dollars) ?? 0, ask: num(m.yes_ask_dollars) ?? 1, last: num(m.last_price_dollars), bidSize: num(m.yes_bid_size_fp) ?? 0, askSize: num(m.yes_ask_size_fp) ?? 0 });
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = (s) => String(s || '').replace(/Kalshi is not affiliated.*$/s, '').replace(/\s+/g, ' ').trim();
const ruleOf = (e) => {
  const m = (e.markets || [])[0];
  return m ? clean(`${m.rules_primary} ${m.rules_secondary || ''}`).slice(0, 420) : '';
};
const active = (e) => (e.markets || []).filter((m) => m.status === 'active');
const settledYes = (e) => (e.markets || []).filter((m) => m.result === 'yes').length;

// ------------------------------------------------------------------ specs (league facts)
// Exactly-one families. n = number of outcomes the league/rules allow (all markets in the event, any status).
const OUTCOME_FAMILIES = [
  { series: 'KXSB', n: 32 }, { series: 'KXNFLAFCCHAMP', n: 16 }, { series: 'KXNFLNFCCHAMP', n: 16 },
  ...['AFCEAST', 'AFCNORTH', 'AFCSOUTH', 'AFCWEST', 'NFCEAST', 'NFCNORTH', 'NFCSOUTH', 'NFCWEST'].map((d) => ({ series: `KXNFL${d}`, n: 4 })),
  { series: 'KXNBA', n: 30 }, { series: 'KXNBAEAST', n: 15 }, { series: 'KXNBAWEST', n: 15 },
  { series: 'KXNBAEAST1SEED', n: 15 }, { series: 'KXNBAWEST1SEED', n: 15 },
  ...['ATLANTIC', 'CENTRAL', 'SOUTHEAST', 'NORTHWEST', 'PACIFIC', 'SOUTHWEST'].map((d) => ({ series: `KXNBA${d}`, n: 5 })),
  { series: 'KXNHL', n: 32 }, { series: 'KXNHLEAST', n: 16 }, { series: 'KXNHLWEST', n: 16 },
  ...['ATLANTIC', 'METROPOLITAN', 'CENTRAL', 'PACIFIC'].map((d) => ({ series: `KXNHL${d}`, n: 8 })),
  { series: 'KXMLB', n: 12 }, { series: 'KXMLBAL', n: 6 }, { series: 'KXMLBNL', n: 6 },
  ...['ALEAST', 'ALCENT', 'ALWEST', 'NLEAST', 'NLCENT', 'NLWEST'].map((d) => ({ series: `KXMLB${d}`, n: 5 })),
  { series: 'KXMLSCUP', n: 30 }, { series: 'KXMLSEAST', n: 15 }, { series: 'KXMLSWEST', n: 15 },
  { series: 'KXUCL', n: 36 }, { series: 'KXWNBA' }, { series: 'KXNCAAF' }, { series: 'KXNCAAFBB10', n: 18 },
  { series: 'KXMLBSERIES', n: 2, kind: 'series' },
];
// Game winner families (one event per game).
const GAME_FAMILIES = [
  { series: 'KXNFLGAME', n: 2 }, { series: 'KXNBAGAME', n: 2 }, { series: 'KXNHLGAME', n: 2 }, { series: 'KXMLBGAME', n: 2 },
  { series: 'KXNCAAFGAME', n: 2 }, { series: 'KXNCAAMBGAME', n: 2 }, { series: 'KXWNBAGAME', n: 2 },
  { series: 'KXEPLGAME', n: 3 }, { series: 'KXUCLGAME', n: 3 }, { series: 'KXUELGAME', n: 3 }, { series: 'KXLALIGAGAME', n: 3 },
  { series: 'KXBUNDESLIGAGAME', n: 3 }, { series: 'KXSERIEAGAME', n: 3 }, { series: 'KXLIGUE1GAME', n: 3 }, { series: 'KXMLSGAME', n: 3 },
];
// "Exactly `slots` of the listed teams ..." families. conf: split by conference with perConf slots each.
const COUNT_FAMILIES = [
  { series: 'KXNFLPLAYOFF', slots: 14, n: 32, conf: 'NFL', perConf: 7 },
  { series: 'KXNFLROUNDQUAL', evSuffix: 'DIV', slots: 8, n: 32, conf: 'NFL', perConf: 4 },
  { series: 'KXNFLROUNDQUAL', evSuffix: 'CONF', slots: 4, n: 32, conf: 'NFL', perConf: 2 },
  { series: 'KXNBAPLAYOFF', slots: 16, n: 30, conf: 'NBA', perConf: 8 },
  { series: 'KXNBAPLAYIN', slots: 4, n: 15 },
  { series: 'KXNBAECFQUAL', slots: 2, n: 15 },
  { series: 'KXNHLPLAYOFF', slots: 16, n: 32, conf: 'NHL', perConf: 8 },
  { series: 'KXEPLRELEGATION', slots: 3, n: 20 }, { series: 'KXLALIGARELEGATION', slots: 3, n: 20 }, { series: 'KXSERIEARELEGATION', slots: 3, n: 20 },
  { series: 'KXEPLTOP6', slots: 6, n: 20 }, { series: 'KXLIGUE1TOP', evSuffix: 'TOP4', slots: 4, n: 18 }, { series: 'KXSERIEATOP', evSuffix: 'TOP4', slots: 4, n: 20 },
  { series: 'KXBUNDESLIGATOP4', slots: 4, n: 18 }, { series: 'KXLALIGATOP4', slots: 4, n: 20 },
  { series: 'KXNCAAFB10QUAL', slots: 2, n: 18 }, { series: 'KXNCAAFSECQ', slots: 2, n: 16 },
  { series: 'KXNCAAFACCQUAL', slots: 2, n: 17 }, { series: 'KXNCAAFB12QUAL', slots: 2, n: 16 },
  { series: 'KXNCAAFTOPSEED', slots: 4 }, { series: 'KXNCAAFSEED', exclusiveOnly: true },
];
const CONF_SOURCES = {
  NFL: [['AFC', 'KXNFLAFCCHAMP'], ['NFC', 'KXNFLNFCCHAMP']],
  NBA: [['East', 'KXNBAEAST'], ['West', 'KXNBAWEST']],
  NHL: [['East', 'KXNHLEAST'], ['West', 'KXNHLWEST']],
};
const NFL_GAMES = 17, NFL_TEAMS = 32;
const ESPN_ALIAS = { WAS: 'WSH', JAC: 'JAX', LVR: 'LV', LAS: 'LV', NOR: 'NO', TBB: 'TB', NEP: 'NE', KAN: 'KC', GNB: 'GB', SFO: 'SF' };

// exact name, else a unique match on last word, else a unique match on first word (e.g. renamed franchises)
function confLookup(map, name) {
  const k = norm(name);
  if (map[k]) return map[k];
  const toks = k.split(' ');
  for (const pick of [(t) => t[t.length - 1], (t) => t[0]]) {
    const hits = new Set(Object.entries(map).filter(([key]) => pick(key.split(' ')) === pick(toks)).map(([, v]) => v));
    if (hits.size === 1) return [...hits][0];
  }
  return undefined;
}

// ------------------------------------------------------------------ scan
async function scan(opts, state) {
  const { ids, notes } = state; // filled in place so a 429 stop keeps everything gathered so far
  const evCache = new Map();
  const getEvents = async (s) => { if (!evCache.has(s)) evCache.set(s, await safeEvents(s)); return evCache.get(s); };
  const addBooks = (e) => Object.fromEntries(active(e).map((m) => [m.ticker, book(m)]));

  // 1. exactly-one families and game winners
  const fams = [...OUTCOME_FAMILIES, ...(opts.games ? GAME_FAMILIES.map((g) => ({ ...g, kind: 'game' })) : [])];
  for (const f of fams) {
    for (const e of await getEvents(f.series)) {
      const act = active(e);
      if (act.length < 2) continue;
      if (settledYes(e) > 0) continue; // outcome already decided
      const total = (e.markets || []).length;
      const exhaustive = !!e.mutually_exclusive && f.n !== undefined && total === f.n;
      if (!e.mutually_exclusive) { notes.push(`${e.event_ticker}: not mutually_exclusive, skipped`); continue; }
      const tieNote = f.series === 'KXNFLGAME' ? 'Rule: a tied NFL game resolves each team to $0.50, so the pair still sums to 1.' : '';
      const idn = exclusiveIdentity({
        id: e.event_ticker, kind: f.kind || 'exclusive', tickers: act.map((m) => m.ticker), exhaustive,
        rule: ruleOf(e), note: [exhaustive ? `exhaustive: ${total} markets = league size ${f.n}` : `one-sided: ${total} listed${f.n ? ` of ${f.n}` : ' (universe unknown)'}`, tieNote].filter(Boolean).join('; '),
      });
      ids.push({ idn, books: addBooks(e) });
    }
  }

  // 2. conference membership (from championship events)
  const confOf = {};
  for (const [league, srcs] of Object.entries(CONF_SOURCES)) {
    confOf[league] = {};
    for (const [name, series] of srcs) for (const e of await getEvents(series)) for (const m of e.markets || []) confOf[league][norm(m.yes_sub_title)] = name;
  }

  // 3. count families
  for (const f of COUNT_FAMILIES) {
    if (f.exclusiveOnly) {
      for (const e of await getEvents(f.series)) {
        if (!e.mutually_exclusive || active(e).length < 2) continue;
        ids.push({ idn: exclusiveIdentity({ id: e.event_ticker, tickers: active(e).map((m) => m.ticker), exhaustive: false, rule: ruleOf(e), note: `one-sided: ${(e.markets || []).length} of ~136 FBS teams listed` }), books: addBooks(e) });
      }
      continue;
    }
    for (const e of await getEvents(f.series)) {
      if (f.evSuffix && !e.event_ticker.endsWith(f.evSuffix)) continue;
      const act = active(e);
      if (act.length < 2) continue;
      const decided = settledYes(e);
      const total = (e.markets || []).length;
      const complete = f.n !== undefined && total === f.n;
      const slots = f.slots - decided;
      ids.push({
        idn: countIdentity({
          id: e.event_ticker, tickers: act.map((m) => m.ticker), slots, complete, rule: ruleOf(e),
          note: `${f.slots} slots; ${complete ? `exhaustive: ${total} = league size ${f.n}` : `one-sided: ${total} listed${f.n ? ` of ${f.n}` : ''}`}${decided ? `; ${decided} already decided yes` : ''}`,
        }),
        books: addBooks(e),
      });
      if (f.conf && decided === 0 && complete) {
        const groups = {};
        for (const m of act) { const c = confLookup(confOf[f.conf], m.yes_sub_title); (groups[c || '?'] ||= []).push(m); }
        if (groups['?']) { notes.push(`${e.event_ticker}: ${groups['?'].length} teams not in conference map, per-conference split skipped`); continue; }
        for (const [c, ms] of Object.entries(groups)) {
          ids.push({
            idn: countIdentity({ id: `${e.event_ticker}/${c}`, tickers: ms.map((m) => m.ticker), slots: f.perConf, complete: true, rule: ruleOf(e), note: `${f.perConf} slots per conference (${c}, ${ms.length} teams)` }),
            books: addBooks({ markets: ms, ...{} }),
          });
        }
      }
    }
  }

  // 4. NFL win conservation
  let nflInfo = null, nbaInfo = null;
  try { nflInfo = await nflWinConservation(opts, getEvents, ids, notes); } catch (e) { if (e instanceof Stop) throw e; errors.push(`KXNFLWINS: ${e.message}`); }

  // 5. NBA win totals: sparse ladders -> expectation bounds (informational, not a basket)
  try { nbaInfo = await nbaLadderCheck(getEvents); } catch (e) { if (e instanceof Stop) throw e; errors.push(`KXNBAWINS: ${e.message}`); }

  state.nflInfo = nflInfo; state.nbaInfo = nbaInfo;
}

async function nflWinConservation(opts, getEvents, ids, notes) {
  const evs = await getEvents('KXNFLWINS');
  if (evs.length === 0) return null;
  const st = await getJson(ESPN_NFL);
  const rec = {};
  const walk = (n) => {
    for (const en of n.standings?.entries || []) {
      const s = Object.fromEntries(en.stats.map((x) => [x.name, x.value]));
      rec[en.team.abbreviation] = { wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0, name: en.team.displayName };
    }
    (n.children || []).forEach(walk);
  };
  walk(st);
  const teams = [];
  const problems = [];
  for (const e of evs) {
    const code = e.event_ticker.replace(/^KXNFLWINS-\d\d/, '');
    const r = rec[code] || rec[ESPN_ALIAS[code]];
    if (!r) { problems.push(`no ESPN record for Kalshi code ${code}`); continue; }
    const played = r.wins + r.losses + r.ties;
    const rungs = active(e).map((m) => ({ ticker: m.ticker, k: m.floor_strike, m }));
    teams.push({ team: code, wins: r.wins, remaining: NFL_GAMES - played, rungs });
  }
  if (teams.length !== NFL_TEAMS) problems.push(`only ${teams.length}/${NFL_TEAMS} teams matched`);
  if (teams.length === 0) return null;
  const decidedGames = Object.values(rec).reduce((s, r) => s + r.wins + r.losses + r.ties, 0) / 2;
  const tieGames = opts.maxTieGames; // number or undefined (= hard rule bound)
  const res = winConservationIdentity({
    id: 'KXNFLWINS/league-wins', teams, maxTieGames: tieGames,
    rule: clean(`${evs[0].markets[0].rules_primary}`),
    note: `${decidedGames} games decided (ESPN standings); ${res0(teams)} future team-games; payoff = future games - future tied games; tie bound ${tieGames === undefined ? 'hard (every remaining game)' : `assumed <= ${tieGames} tie games`}`,
  });
  problems.push(...res.problems);
  const books = {};
  for (const t of teams) for (const r of t.rungs) books[r.ticker] = book(r.m);
  ids.push({ idn: res.identity, books });
  for (const p of problems) notes.push(`KXNFLWINS: ${p}`);
  return { decidedGames, games: res.games, tieCap: res.tieCap, problems };
}
const res0 = (teams) => teams.reduce((s, t) => s + t.remaining, 0);

async function nbaLadderCheck(getEvents) {
  const evs = await getEvents('KXNBAWINS');
  if (evs.length === 0) return null;
  let lo = 0, point = 0, hi = 0, listed = 0, unlisted = 0;
  for (const e of evs) {
    const rungs = active(e).map((m) => ({ k: m.floor_strike, p: (book(m).bid + book(m).ask) / 2 }));
    const x = ladderExpectation(rungs, { kMin: 1, kMax: 82 });
    lo += x.lo; point += x.point; hi += x.hi; listed += x.listed; unlisted += x.unlisted;
  }
  const target = (evs.length * 82) / 2;
  return { teams: evs.length, target, lo, point, hi, listed, unlisted };
}

// ------------------------------------------------------------------ report
const f2 = (x) => (x == null ? '-' : x.toFixed(2));
const f3 = (x) => (x == null ? '-' : (x >= 0 ? '+' : '') + x.toFixed(3));
function row(r) {
  const p = r.price, pr = r.proj;
  const pay = p.payoff.lo === p.payoff.hi ? `${p.payoff.hi}` : `${p.payoff.lo}..${p.payoff.hi}`;
  return [
    r.id.length > 34 ? r.id.slice(0, 33) + '~' : r.id, String(p.n), f2(p.sumBids), f2(p.sumMids), f2(p.sumAsks), pay,
    f3(p.buyEdge), f3(p.sellEdge), f3(p.midsResidual), `${pr.maxMove.toFixed(3)} ${pr.worst.ticker ? pr.worst.ticker.split('-').slice(-1)[0] : ''}`.trim(),
    p.minBidSize == null ? '-' : `${Math.floor(p.minBidSize)}/${Math.floor(p.minAskSize)}`, r.thin ? 'thin' : '',
  ];
}
const HEAD = ['id', 'n', 'sumBid', 'sumMid', 'sumAsk', 'payoff', 'buyEdge', 'sellEdge', 'midRes', 'worstMove', 'lots S/B', 'liq'];
function table(rows) {
  const all = [HEAD, ...rows.map(row)];
  const w = HEAD.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r) => r.map((c, i) => (i === 0 || i === 9 || i === 11 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ')).join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd !== 'scan') { console.error('usage: pathwise-identities.mjs scan [--out file] [--theta 0.07] [--fee-round none|cent] [--max-tie-games N|hard] [--gap ms>=150] [--no-games] [--top N] [--rules]'); process.exit(cmd ? 2 : 0); }
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i < 0 ? d : argv[i + 1]; };
  const opts = {
    theta: Number(flag('theta', 0.07)), feeRound: flag('fee-round', 'none'),
    games: !argv.includes('--no-games'), top: Number(flag('top', 12)),
    maxTieGames: flag('max-tie-games', '3') === 'hard' ? undefined : Number(flag('max-tie-games', '3')),
  };
  const out = flag('out', null);
  MIN_GAP_MS = Math.max(150, Number(flag('gap', MIN_GAP_MS)));

  const result = { ids: [], notes: [], nflInfo: null, nbaInfo: null };
  try { await scan(opts, result); } catch (e) { if (e instanceof Stop) console.error(`STOPPED: ${e.message} (partial results below)`); else throw e; }

  const rows = result.ids.map(({ idn, books }) => {
    const price = priceIdentity(idn, books, { theta: opts.theta, feeRound: opts.feeRound });
    const proj = projectOntoIdentity(price.mids, idn, { target: 'point' });
    return { id: idn.id, kind: idn.kind, idn, price, proj, thin: price.avgSpread > 0.35 };
  });
  const structural = rows.filter((r) => r.kind !== 'game');
  const games = rows.filter((r) => r.kind === 'game');
  const best = (r) => Math.max(r.price.buyEdge, r.price.sellEdge);
  structural.sort((a, b) => best(b) - best(a));
  games.sort((a, b) => best(b) - best(a));

  console.log(`pathwise identities @ ${new Date().toISOString()}  theta=${opts.theta} fee-round=${opts.feeRound}  (edges = per-lot dollars after taker fees; + = riskless at top of book)`);
  console.log(table(structural));
  if (games.length) {
    console.log(`\nper-game winner families: ${games.length} events; best ${opts.top} by edge`);
    console.log(table(games.slice(0, opts.top)));
    const pos = games.filter((r) => best(r) > 0).length;
    console.log(`games with positive buy or sell edge after fees: ${pos}/${games.length}`);
  }
  if (result.nflInfo) console.log(`\nNFL win conservation: ${result.nflInfo.decidedGames} games decided, ${result.nflInfo.games} to play; tie-game bound used = ${result.nflInfo.tieCap}`);
  const wc = rows.find((r) => r.id === 'KXNFLWINS/league-wins');
  if (wc) console.log(`  point payoff ${wc.idn.payoff.point}: sumMid ${f2(wc.price.sumMids)} sumBid ${f2(wc.price.sumBids)} sumAsk ${f2(wc.price.sumAsks)}; buyEdge@point ${f3(wc.price.buyEdgePoint)} sellEdge@point ${f3(wc.price.sellEdgePoint)}`);
  if (result.nbaInfo) { const n = result.nbaInfo; console.log(`NBA win totals (sparse 5-win rungs, not a basket): sum E[W] in [${f2(n.lo)}, ${f2(n.hi)}], interpolated ${f2(n.point)}, rule constant ${n.target}`); }
  if (opts.rules) for (const r of structural) console.log(`\n# ${r.id} [${r.kind}] payoff ${JSON.stringify(r.idn.payoff)}\n  rule: ${r.idn.rule}\n  note: ${r.idn.note}`);
  for (const n of result.notes) console.log(`note: ${n}`);
  for (const e of errors) console.log(`error: ${e}`);

  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      at: new Date().toISOString(), opts, nflInfo: result.nflInfo, nbaInfo: result.nbaInfo, notes: result.notes, errors,
      identities: rows.map((r) => ({ id: r.id, kind: r.kind, payoff: r.idn.payoff, rule: r.idn.rule, note: r.idn.note, tickers: r.idn.markets.map((m) => m.ticker), price: { ...r.price, mids: undefined }, projection: { maxMove: r.proj.maxMove, worst: r.proj.worst, feasible: r.proj.feasible, lambda: r.proj.lambda } })),
    }, null, 1));
    console.log(`\nwrote ${out}`);
  }
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
