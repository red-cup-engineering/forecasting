#!/usr/bin/env node
/**
 * Generator-admission lag recorder, grader and maker mark-outs (issue #246 E2: who sees the generator first).  READ-ONLY.
 *
 *   node scripts/generator-lag.mjs record   [--sport all|nfl,mlb,..] [--poll 1000] [--hours 12] [--discover-min 30] [--dir <state dir>]
 *   node scripts/generator-lag.mjs grade    [--day 2026-10-04] [--dir <state dir>]
 *   node scripts/generator-lag.mjs markouts [--day 2026-10-04] [--dir <state dir>] [--min-n 30]
 *
 * record: one clock, two tapes, every sport in src/sport-feeds.mjs (NFL, NCAAF, MLB, NHL, NBA, WNBA, seven soccer
 * leagues, ATP, WTA). The Kalshi WebSocket (signed handshake; `trade`, `ticker`, `orderbook_delta` and `market_lifecycle_v2` channels, frames kept verbatim as {r, m}; --channels trims them, --delta all|winner|none limits the heavy orderbook_delta channel) for every open
 * game-winner market and eligible player-prop market of the matched games, and each sport's ESPN public scoreboard
 * polled every --poll ms while one of its games is live or about to start (every 60 s otherwise), logging each
 * score, play or status change with its first-seen time and its sport. Discovery repeats every --discover-min
 * minutes; newly listed games join the same socket by update_subscription. ESPN games with no Kalshi winner event
 * and Kalshi events with no ESPN game are recorded in unmatched.jsonl. One feed.jsonl and one kalshi.jsonl per UTC
 * day under <dir>/<day>/ (default ~/.local/state/561-group/settlements/forecasting-service/generator-lag).
 * It never sends an order, an RFQ or a quote.
 *
 * grade: for each score change, src/generator-lag.mjs repriceLead on the scoring game's winner market.
 * lead > 0 means Kalshi had repriced before the free feed showed the score: a maker quoting off that feed
 * is picked off for `lead` ms on every scoring play.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createKalshiClient, kalshiCredentials, authHeaders } from '../../../src/client.mjs';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { repriceLead } from '../src/generator-lag.mjs';
import { SPORTS, matchGames, gameCode, tickerDate, normalizeScoreboard, feedState, sportList, seriesIndex } from '../src/sport-feeds.mjs';
import { HORIZONS, markouts, summarize, phaseIndex, phaseAt, tradeOf, parseTicker } from '../src/markouts.mjs';

const args = process.argv.slice(2); const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const log = (...a) => console.error(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = opt('day', new Date().toISOString().slice(0, 10));
const stateRoot = opt('dir', join(process.env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'generator-lag'));
const dir = join(stateRoot, day);
const dayDir = (t = Date.now()) => { const d = join(stateRoot, new Date(t).toISOString().slice(0, 10)); mkdirSync(d, { recursive: true }); return d; };
const recordDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'records', '2026-10-04-generator-lag');
const WS = { host: 'wss://api.elections.kalshi.com', path: '/trade-api/ws/v2' };

async function readJsonl(file, fn) {
  if (!existsSync(file)) return;
  // Kalshi frames end in a newline, so the first recorder wrote each {"r","m"} frame over two lines: rejoin until it parses.
  let pending = '';
  for await (const line of createInterface({ input: createReadStream(file), crlfDelay: Infinity })) {
    if (!line && !pending) continue;
    pending += line; let x; try { x = JSON.parse(pending); } catch { if (pending.length > 1e6) pending = ''; continue; }
    pending = ''; fn(x);
  }
}

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const etDate = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(t).replaceAll('-', '');
const board = async (sport, dates) => {
  const url = `${ESPN}/${SPORTS[sport].espn}/scoreboard${dates ? `?dates=${dates}` : ''}`;
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`espn ${sport} ${r.status}`);
  return normalizeScoreboard(SPORTS[sport].kind, await r.json(), SPORTS[sport].grouping);
};

// Kalshi public reads share one serial lane with spacing and 429 backoff: the rate limit is per IP.
let lane = Promise.resolve();
const kalshi = (fn) => (lane = lane.then(async () => {
  for (let i = 0; i < 6; i += 1) {
    try { const out = await fn(); await sleep(250); return out; } catch (e) { if (!/429|too_many/u.test(`${e.code} ${e.message}`)) throw e; await sleep(2000 * (i + 1)); }
  }
  throw new Error('kalshi rate limit');
}));

/** One discovery round for `sports`: matched games, their markets, and what failed to match. */
async function discover(client, sports) {
  const now = Date.now(); const out = { games: [], tickers: [], unmatched: [], propSeries: {} };
  const dates = [etDate(now - 86400e3), etDate(now), etDate(now + 86400e3)];
  await Promise.all(sports.map(async (sport) => {
    const s = SPORTS[sport];
    let espn = [];
    try {
      const lists = await Promise.all(dates.map((d) => board(sport, d)));
      const seen = new Map(); for (const g of lists.flat()) seen.set(g.id, g);
      espn = [...seen.values()].filter((g) => !g.completed && g.state !== 'post' && (g.state === 'in' || Date.parse(g.start) - now < 20 * 3600e3));
    } catch (e) { log('espn', sport, e.message); return; }
    let events = [];
    try { events = await kalshi(() => client.getEvents({ series_ticker: s.game, status: 'open' })); } catch (e) { log('kalshi events', s.game, e.message); return; }
    const m = matchGames(espn, events);
    for (const g of m.unmatchedGames) out.unmatched.push({ sport, side: 'espn', id: g.id, name: g.name, start: g.start });
    for (const e of m.unmatchedEvents) { const d = tickerDate(e.event_ticker); if (d !== null && d - now < 24 * 3600e3 && now - d < 36 * 3600e3) out.unmatched.push({ sport, side: 'kalshi', event: e.event_ticker, title: e.title }); }
    const byCode = new Map();
    for (const { game, event } of m.matched) {
      const code = gameCode(event.event_ticker); byCode.set(code, true);
      out.games.push({ sport, espnId: game.id, name: game.name, start: game.start, event: event.event_ticker, gameCode: code, winnerTickers: null });
      for (const mk of event.markets ?? []) if (mk.status === 'active') out.tickers.push(mk.ticker);
    }
    // winner markets: events lists carry no nested markets unless asked
    if (m.matched.length) {
      try {
        const nested = await kalshi(() => client.getEvents({ series_ticker: s.game, status: 'open', with_nested_markets: true }));
        for (const e of nested) if (byCode.has(gameCode(e.event_ticker))) for (const mk of e.markets ?? []) if (mk.status === 'active') out.tickers.push(mk.ticker);
      } catch (e) { log('kalshi nested', s.game, e.message); }
      for (const series of s.props) {
        try {
          const evs = await kalshi(() => client.getEvents({ series_ticker: series, status: 'open', with_nested_markets: true }));
          let n = 0;
          for (const e of evs) if (byCode.has(gameCode(e.event_ticker))) for (const mk of e.markets ?? []) if (mk.status === 'active') { out.tickers.push(mk.ticker); n += 1; }
          if (n) out.propSeries[series] = n;
        } catch (e) { log('kalshi prop', series, e.message); }
      }
    }
  }));
  out.tickers = [...new Set(out.tickers)];
  return out;
}

async function record() {
  const sports = sportList(opt('sport', 'all')); const poll = Number(opt('poll', 1000));
  const until = Date.now() + Number(opt('hours', 12)) * 3600e3; const everyMs = Number(opt('discover-min', 30)) * 60e3;
  mkdirSync(dayDir(), { recursive: true });
  const client = createKalshiClient(); const creds = kalshiCredentials();
  const kfile = () => join(dayDir(), 'kalshi.jsonl'); const ffile = () => join(dayDir(), 'feed.jsonl');
  const gamesAll = new Map();   // `${sport}:${espnId}` -> game
  const known = new Set();      // tickers ever discovered
  const unmatchedSeen = new Set();
  let wsMsgs = 0; let ws; let wsOpen = false; let nextId = 10; let acks = 0;
  const CH = opt('channels', 'trade,ticker,orderbook_delta,market_lifecycle_v2').split(',');
  const deltaMode = opt('delta', 'all'); // all | winner | none: which markets get orderbook_delta (the heavy channel)
  const idx = seriesIndex();
  const wants = (c, t) => c !== 'orderbook_delta' || deltaMode === 'all' || (deltaMode === 'winner' && idx.get(parseTicker(t).series)?.cls === 'winner');
  const chan = Object.fromEntries(CH.map((c) => [c, { sid: null, asked: false, sent: new Set() }]));

  const send = (cmd, params) => { ws.send(JSON.stringify({ id: nextId++, cmd, params })); };
  const flush = () => {
    if (!wsOpen) return;
    CH.forEach((c, i) => {
      const st = chan[c]; const todo = [...known].filter((t) => wants(c, t) && !st.sent.has(t)); if (!todo.length) return;
      if (!st.asked) { // first subscribe of this channel on this socket; the rest follow by update_subscription once its sid is back
        const first = todo.slice(0, 200); st.asked = true; first.forEach((t) => st.sent.add(t));
        ws.send(JSON.stringify({ id: i + 1, cmd: 'subscribe', params: { channels: [c], market_tickers: first } })); return;
      }
      if (st.sid === null) return;
      for (let k = 0; k < todo.length; k += 500) { // update_subscription takes exactly one sid per command
        const chunk = todo.slice(k, k + 500); chunk.forEach((t) => st.sent.add(t));
        send('update_subscription', { sid: st.sid, market_tickers: chunk, action: 'add_markets' });
      }
    });
  };

  let round = 0;
  const run = async () => {
    round += 1; const t0 = Date.now();
    let d; try { d = await discover(client, sports); } catch (e) { log('discover', e.message); return; }
    for (const g of d.games) gamesAll.set(`${g.sport}:${g.espnId}`, g);
    const before = known.size; for (const t of d.tickers) known.add(t);
    const bySport = {}; for (const g of d.games) bySport[g.sport] = (bySport[g.sport] ?? 0) + 1;
    const fresh = d.unmatched.filter((u) => { const k = `${u.side}:${u.id ?? u.event}`; if (unmatchedSeen.has(k)) return false; unmatchedSeen.add(k); return true; });
    for (const u of fresh) appendFileSync(join(dayDir(), 'unmatched.jsonl'), JSON.stringify({ r: Date.now(), ...u }) + '\n');
    writeFileSync(join(dayDir(), 'games.json'), JSON.stringify({ round, at: new Date().toISOString(), sports, games: [...gamesAll.values()], tickers: [...known], propSeries: d.propSeries, unmatched: d.unmatched }, null, 1));
    log(`discover #${round} ${Date.now() - t0}ms games`, JSON.stringify(bySport), 'markets', known.size, `(+${known.size - before})`, 'props', JSON.stringify(d.propSeries), 'unmatched', d.unmatched.length, `(new ${fresh.length})`);
    flush();
  };

  const connect = () => {
    const h = authHeaders({ ...creds, method: 'GET', path: WS.path }); delete h.accept; delete h['content-type'];
    ws = new WebSocket(WS.host + WS.path, { headers: h });
    ws.onopen = () => { log('ws open'); wsOpen = true; for (const c of CH) Object.assign(chan[c], { sid: null, asked: false, sent: new Set() }); flush(); };
    ws.onmessage = (m) => {
      wsMsgs += 1; const r = Date.now(); const raw = String(m.data).trim();
      // update_subscription acks echo the whole cumulative market list (~100 KB each); they carry no market data, so count them instead of journaling them
      if (raw.length > 2000 && /^\{"id":\d+,"sid":\d+,"seq":\d+,"type":"ok"/u.test(raw)) { acks += 1; return; }
      try { appendFileSync(kfile(), `{"r":${r},"m":${raw}}\n`); } catch (e) { log('write', e.message); }
      if (raw.length < 400 && /"type":"(subscribed|error)"/u.test(raw)) {
        const x = JSON.parse(raw);
        if (x.type === 'subscribed') chan[x.msg.channel].sid = x.msg.sid; else log('ws error msg', raw);
        flush();
      }
    };
    ws.onerror = (e) => log('ws error', e.message ?? '');
    ws.onclose = (e) => { wsOpen = false; log('ws close', e.code, e.reason); if (Date.now() < until && !stopping) setTimeout(connect, 2000); };
  };

  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);

  await run(); connect();
  const disc = setInterval(() => { if (!stopping) run(); }, everyMs);

  // per-sport ESPN polling: fast while a tracked game is live or within 15 min of its start, 60 s otherwise
  const last = new Map(); const nextPoll = Object.fromEntries(sports.map((s) => [s, 0])); const busy = new Set(); let polls = 0; let rows = 0;
  const active = (sport) => [...gamesAll.values()].some((g) => g.sport === sport && !g.done && Date.parse(g.start) - Date.now() < 15 * 60e3);
  const pollSport = async (sport) => {
    const t0 = Date.now();
    try {
      const gs = await board(sport); const r = Date.now();
      for (const e of gs) {
        const g = gamesAll.get(`${sport}:${e.id}`); if (!g) continue;
        if (e.completed || e.state === 'post') g.done = true;
        const state = feedState(e); const key = `${sport}:${e.id}`; const sk = JSON.stringify(state);
        if (last.get(key) === sk) continue;
        const prev = last.get(key) ? JSON.parse(last.get(key)) : null; last.set(key, sk);
        const scored = Boolean(prev) && JSON.stringify(prev.scores) !== JSON.stringify(state.scores);
        appendFileSync(ffile(), JSON.stringify({ r, rtt: r - t0, sport, espnId: e.id, event: g.event, code: g.gameCode, ...state, scored, prevScores: prev?.scores ?? null, text: e.playText, playType: e.playType, clock: e.clock, period: e.period }) + '\n'); rows += 1;
      }
      polls += 1;
    } catch (e) { log('feed', sport, e.message); }
  };
  let lastLog = Date.now();
  while (Date.now() < until && !stopping) {
    const now = Date.now();
    for (const s of sports) {
      if (busy.has(s) || now < nextPoll[s]) continue;
      nextPoll[s] = now + (active(s) ? poll : 60e3);
      busy.add(s); pollSport(s).finally(() => busy.delete(s));
    }
    if (now - lastLog > 60e3) { lastLog = now; log('polls', polls, 'feed rows', rows, 'ws msgs', wsMsgs, 'acks dropped', acks, 'markets', known.size); }
    await sleep(200);
  }
  clearInterval(disc); stopping = true; ws?.close(); log('done');
  process.exit(0);
}

async function markoutsCmd() {
  const minN = Number(opt('min-n', 30)); const idx = seriesIndex();
  const prev = new Date(Date.parse(day) - 86400e3).toISOString().slice(0, 10);
  const feed = [];
  for (const d of [prev, day]) await readJsonl(join(stateRoot, d, 'feed.jsonl'), (f) => feed.push(f));
  const phases = phaseIndex(feed);
  const trades = []; const seen = new Set(); let dup = 0;
  await readJsonl(join(dir, 'kalshi.jsonl'), (rec) => { const t = tradeOf(rec); if (!t) return; if (t.id && seen.has(t.id)) { dup += 1; return; } if (t.id) seen.add(t.id); trades.push(t); });
  const rows = markouts(trades);
  for (const r of rows) {
    const { series, code } = parseTicker(r.ticker); const meta = idx.get(series);
    r.sport = meta?.sport ?? 'other'; r.cls = meta?.cls ?? 'other'; r.phase = phaseAt(phases, code, r.r);
  }
  const by = { all: summarize(rows, () => 'all'), sport: summarize(rows, (r) => r.sport), class: summarize(rows, (r) => r.cls), phase: summarize(rows, (r) => r.phase), sportClassPhase: summarize(rows, (r) => `${r.sport}/${r.cls}/${r.phase}`) };
  const report = { day, dir, trades: trades.length, duplicates: dup, horizonsMs: HORIZONS, unit: 'dollars per contract, maker side; negative = adverse selection', by };
  writeFileSync(join(dir, 'markouts.json'), JSON.stringify(report, null, 1));
  const c = (x) => (x === null || x === undefined ? '    -' : (x * 100).toFixed(2).padStart(6));
  const line = (k, g) => `${k.padEnd(34)} ${String(g.trades).padStart(7)} ` + HORIZONS.map((h) => { const m = g[h]; return `${c(m.mean)} [${c(m.lo)},${c(m.hi)}] n=${String(m.n).padEnd(6)}`; }).join(' | ');
  console.log(`maker mark-outs, cents per contract, mean [95% CI], day ${day}, ${trades.length} trades (${dup} duplicates dropped); columns ${HORIZONS.map((h) => `+${h / 1000}s`).join(' | ')}`);
  for (const k of ['all', 'sport', 'class', 'phase']) { console.log(`\nby ${k}`); for (const [key, g] of Object.entries(by[k])) console.log(line(key, g)); }
  console.log(`\nsport/class/phase with at least ${minN} trades`);
  for (const [key, g] of Object.entries(by.sportClassPhase)) if (g.trades >= minN) console.log(line(key, g));
}

async function grade() {
  const trades = new Map();
  await readJsonl(join(dir, 'kalshi.jsonl'), (x) => {
    if (x.m?.type !== 'trade') return; const m = x.m.msg;
    (trades.get(m.market_ticker) ?? trades.set(m.market_ticker, []).get(m.market_ticker)).push({ r: x.r, p: Number(m.yes_price_dollars) });
  });
  const rows = [];
  const feedRows = []; await readJsonl(join(dir, 'feed.jsonl'), (f) => feedRows.push(f));
  {
    for (const f of feedRows) {
      if (!f.scored) continue;
    const scorer = Object.keys(f.scores).find((k) => f.scores[k] !== f.prevScores[k]);
    // every recorded market of the game (both winners, every anytime-TD) on our receive clock; the largest graded move wins
    const code = f.event.split('-')[1];
    const mk = [...trades.keys()].filter((t) => t.split('-')[1] === code);
    const best = mk.map((t) => ({ t, res: repriceLead(f.r, trades.get(t).map((x) => ({ t: x.r, p: x.p }))) })).filter((x) => x.res.graded).sort((a, b) => Math.abs(b.res.move) - Math.abs(a.res.move))[0];
    rows.push({ sport: f.sport ?? 'nfl', event: f.event, at: new Date(f.r).toISOString(), scorer, points: f.scores[scorer] - f.prevScores[scorer], playType: f.playType, text: f.text, market: best?.t ?? null, ...(best?.res ?? { graded: false }) });
    }
  }
  const graded = rows.filter((r) => r.graded); const leads = graded.map((r) => r.leadMs).sort((a, b) => a - b);
  const q = (p) => (leads.length ? leads[Math.min(leads.length - 1, Math.floor(p * leads.length))] : null);
  const report = { day, scoringChanges: rows.length, graded: graded.length, leadMs: { p10: q(0.1), p25: q(0.25), median: q(0.5), p75: q(0.75), p90: q(0.9) }, marketFirstFrac: graded.length ? graded.filter((r) => r.leadMs > 0).length / graded.length : null };
  mkdirSync(recordDir, { recursive: true });
  writeFileSync(join(recordDir, `grade-${day}.json`), JSON.stringify({ report, rows }, null, 1));
  console.log(JSON.stringify(report, null, 1));
}

if (cmd === 'record') await record();
else if (cmd === 'grade') await grade();
else if (cmd === 'markouts') await markoutsCmd();
else { console.error('usage: generator-lag.mjs record|grade|markouts'); process.exit(2); }
