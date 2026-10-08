#!/usr/bin/env node
/**
 * Reconstruct a combo state dir (trades / rfqs / legs / results .jsonl, the shape the stopped live collector
 * wrote) for past dates from Kalshi's PUBLIC market-data history, so combo-rigidity-measure.mjs and
 * leg-coherence-brier.mjs run unchanged over weekends the collector never saw. Read-only, unsigned.
 *
 *   node scripts/combo-backfill.mjs --from 2026-09-26 --to 2026-09-28 --out <dir>
 *        [--windows 24] [--window-minutes 5] [--sports-only | --crypto15m] [--seed 1]
 *
 * --crypto15m keeps combos whose legs are all KX*15M series and samples windows uniformly over the whole UTC
 * day (crypto trades 24h) instead of the sports slate.
 *
 * The full exchange tape is too large, so each date's slate (10Z of the date to 10Z of the next, weighted to
 * US sports hours 16Z-04Z) is sampled in --windows time windows, deterministically. Per window: every combo
 * (KXMVE*) print is kept; each combo's legs are resolved once (batch GET /markets?tickers=); every game a kept
 * combo touches gets its score-line families (GAME/MATCH/FIGHT, SPREAD, TOTAL, TEAMTOTAL, BTTS) listed once and
 * their 1-minute quote candles fetched over [window start - 30 min, window end] with the batch candlestick
 * endpoint; a non-score leg (prop) gets its own market's candles. Candles become `ev` book snapshots.
 *
 * Everything fetched is appended to <out>/cache/ as it arrives; a rerun resumes from there. Pacing and 429
 * backoff are the house client's (createKalshiClient, unsigned); a 429 that outlasts its 5 backoffs stops the
 * run with the caches saved (exit 3).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, renameSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createKalshiClient } from '@red-cup-engineering/kalshi-services-section/client';
import { isComboTicker, legMeta, mulberry32 } from '../src/combo-pricer.mjs';
import { SPORTS } from '../src/sport-feeds.mjs';

// ---------------------------------------------------------------- pure parts

const HOUR = 3600e3;
const sportsHour = (h) => h >= 16 || h < 4;

/** Final-score market kinds (the ones combo-rigidity's scoreRegion reads); everything else is a "prop" here. */
export const SCORE_KINDS = new Set(['GAME', 'MATCH', 'FIGHT', 'SPREAD', 'TOTAL', 'TEAMTOTAL', 'BTTS']);
const FAMILY_KINDS = ['GAME', 'MATCH', 'FIGHT', 'SPREAD', 'TOTAL', 'TEAMTOTAL', 'BTTS'];

const dateNum = (d) => Number(d.replaceAll('-', ''));

/**
 * Deterministic window sample for one date: `windows` non-overlapping slots of `windowMinutes` drawn without
 * replacement from the slate [date 10Z, date+1 10Z), sports hours (16Z-04Z) weighted `peak` times the rest
 * (Efraimidis-Spirakis keys). Returns [{minTs, maxTs}] in epoch seconds, ascending.
 */
export function sampleWindows({ date, windows = 24, windowMinutes = 5, seed = 1, peak = 6, startHour = 10 }) {
  const slot = windowMinutes * 60e3;
  const start = Date.parse(`${date}T00:00:00Z`) + startHour * HOUR;
  const n = Math.floor((24 * HOUR) / slot);
  const rnd = mulberry32(seed * 100000007 + dateNum(date));
  const keyed = Array.from({ length: n }, (_, i) => {
    const at = start + i * slot;
    const w = sportsHour(new Date(at).getUTCHours()) ? peak : 1;
    return { i, key: Math.log(Math.max(rnd(), 1e-12)) / w };
  });
  keyed.sort((a, b) => b.key - a.key || a.i - b.i);
  return keyed.slice(0, Math.min(windows, n)).map((k) => k.i).sort((a, b) => a - b)
    .map((i) => ({ minTs: (start + i * slot) / 1000, maxTs: (start + (i + 1) * slot) / 1000 - 1 }));
}

/** Inclusive list of YYYY-MM-DD dates. */
export function dateRange(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 24 * HOUR) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** A crypto 15-minute leg: KXBTC15M, KXETH15M, ... (one market per asset per window). */
export const isCrypto15mLeg = (marketTicker, eventTicker) => /^KX[A-Z0-9]+15M$/u.test(legMeta(marketTicker, eventTicker).series);

/** Is this leg market a sports market (a sport prefix legMeta recognises, or a sport-feeds series)? */
const SPORT_SERIES = new Set(Object.values(SPORTS).flatMap((s) => [s.game, ...s.props]));
export function isSportsLeg(marketTicker, eventTicker) {
  const m = legMeta(marketTicker, eventTicker);
  return SPORT_SERIES.has(m.series) || m.sport !== m.series.replace(/^KX/u, '');
}

/** A score-line leg's family: the series prefix and game code that name every score-line event of its game. */
export function scoreFamily(marketTicker, eventTicker) {
  const m = legMeta(marketTicker, eventTicker);
  if (m.sport === m.series.replace(/^KX/u, '') || !SCORE_KINDS.has(m.kind)) return null;
  return { prefix: m.series.slice(0, m.series.length - m.kind.length), game: m.game };
}
export const familyEvents = ({ prefix, game }) => FAMILY_KINDS.map((k) => `${prefix}${k}-${game}`);

/**
 * `ev` snapshots from candle rows [{event, ticker, ts (s), bid, ask}]: for every event, a snapshot at each
 * minute where any of its markets has a candle, holding every market's latest close up to `maxCarryS` old
 * (older books are dropped, so a window's books never masquerade as fresh in a later one). Sorted by t.
 */
export function* eachSnapshot(rows, { maxCarryS = 1800 } = {}) {
  const byEvent = new Map();
  for (const r of rows) (byEvent.get(r.event) ?? byEvent.set(r.event, []).get(r.event)).push(r);
  for (const [event, rs] of byEvent) {
    rs.sort((a, b) => a.ts - b.ts);
    const latest = new Map();
    for (let i = 0; i < rs.length;) {
      const ts = rs[i].ts;
      for (; i < rs.length && rs[i].ts === ts; i += 1) latest.set(rs[i].ticker, rs[i]);
      const markets = [];
      for (const [ticker, c] of latest) if (ts - c.ts <= maxCarryS) markets.push({ ticker, bid: c.bid, ask: c.ask });
      markets.sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
      yield { k: 'ev', t: ts * 1000, event, markets };
    }
  }
}

export function buildSnapshots(rows, opts) {
  return [...eachSnapshot(rows, opts)].sort((a, b) => a.t - b.t || (a.event < b.event ? -1 : 1));
}

/** The same snapshots as globally sorted JSONL lines, held as strings so a weekend fits in memory. */
export function snapshotLines(rows, opts) {
  const keyed = [];
  for (const s of eachSnapshot(rows, opts)) keyed.push([s.t, s.event, JSON.stringify(s)]);
  keyed.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  return keyed.map((k) => k[2]);
}

/** An append-only JSONL cache keyed by `keyOf(row)`; tolerates a torn last line; later rows win. */
export function openCache(file, keyOf) {
  const map = new Map();
  if (existsSync(file)) for (const l of readFileSync(file, 'utf8').split('\n')) { if (!l) continue; try { const r = JSON.parse(l); map.set(keyOf(r), r); } catch { /* torn line */ } }
  return { map, has: (k) => map.has(k), get: (k) => map.get(k), add(row) { map.set(keyOf(row), row); appendFileSync(file, `${JSON.stringify(row)}\n`); } };
}

/** Parse a batch-candlestick response into snapshot rows (close quotes in dollars, 0 when absent). */
export function candleRows(payload, eventOf) {
  const rows = [];
  for (const m of payload.markets ?? []) {
    const event = eventOf(m.market_ticker); if (!event) continue;
    for (const c of m.candlesticks ?? []) rows.push({ event, ticker: m.market_ticker, ts: c.end_period_ts, bid: Number(c.yes_bid?.close_dollars) || 0, ask: Number(c.yes_ask?.close_dollars) || 0 });
  }
  return rows;
}

export function parseArgs(argv) {
  const a = (name, d) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : d; };
  return { from: a('from'), to: a('to', a('from')), out: a('out'), windows: Number(a('windows', 24)), windowMinutes: Number(a('window-minutes', 5)), seed: Number(a('seed', 1)), sportsOnly: argv.includes('--sports-only'), crypto15m: argv.includes('--crypto15m') };
}

// ---------------------------------------------------------------- the run

class StopRun extends Error {}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.from || !args.out) { console.error('usage: combo-backfill.mjs --from YYYY-MM-DD [--to YYYY-MM-DD] --out DIR [--windows 24] [--window-minutes 5] [--sports-only]'); process.exit(2); }
  const out = args.out; const cdir = join(out, 'cache'); mkdirSync(join(cdir, 'tape'), { recursive: true }); mkdirSync(join(cdir, 'candles'), { recursive: true });
  const client = createKalshiClient({ credentials: null, minIntervalMs: 250, retries429: 5 });
  const t0 = Date.now(); const counts = { requests: 0, byKind: {} };
  const log = (...m) => console.error(`[${((Date.now() - t0) / 1000).toFixed(0)}s req=${counts.requests}]`, ...m);

  async function get(kind, path, query) {
    for (let attempt = 0; ; attempt += 1) {
      counts.requests += 1; counts.byKind[kind] = (counts.byKind[kind] ?? 0) + 1;
      try { return await client.call('GET', path, { query, signed: false }); } catch (e) {
        if (e.code === 'http-429') throw new StopRun('429 persisted through 5 backoffs');
        if (e.code === 'http-404') return null;
        if (attempt < 3 && (e.code === 'network' || /^http-5/u.test(e.code ?? ''))) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw e;
      }
    }
  }

  const combos = openCache(join(cdir, 'combos.jsonl'), (r) => r.t);     // {t, legs:[[ticker,side,event]]|null, r}
  const markets = openCache(join(cdir, 'markets.jsonl'), (r) => r.t);   // {t, r}
  const events = openCache(join(cdir, 'events.jsonl'), (r) => r.e);     // {e, m:[[ticker,result]]|null}

  try {
    // ---- 1. tape windows
    const windows = dateRange(args.from, args.to).flatMap((date) => sampleWindows({ date, windows: args.windows, windowMinutes: args.windowMinutes, seed: args.seed, ...(args.crypto15m ? { peak: 1, startHour: 0 } : {}) }));
    const windowFile = (w) => join(cdir, 'tape', `${w.minTs}.json`);
    const tape = new Map();
    for (const [wi, w] of windows.entries()) {
      if (existsSync(windowFile(w))) { tape.set(w.minTs, JSON.parse(readFileSync(windowFile(w), 'utf8'))); continue; }
      const seen = new Set(); const trades = []; let all = 0; let cursor;
      do {
        const p = await get('tape', '/markets/trades', { min_ts: w.minTs, max_ts: w.maxTs, limit: 1000, cursor });
        for (const t of p?.trades ?? []) { all += 1; if (isComboTicker(t.ticker) && !seen.has(t.trade_id)) { seen.add(t.trade_id); trades.push(t); } }
        cursor = p?.cursor || undefined;
      } while (cursor);
      const rec = { ...w, tapeTrades: all, trades };
      writeFileSync(`${windowFile(w)}.tmp`, JSON.stringify(rec)); renameSync(`${windowFile(w)}.tmp`, windowFile(w));
      tape.set(w.minTs, rec); log(`window ${wi + 1}/${windows.length} ${new Date(w.minTs * 1000).toISOString()} tape=${all} combo=${trades.length}`);
    }

    // ---- 2. combo legs + results (batch)
    const comboTickers = [...new Set([...tape.values()].flatMap((w) => w.trades.map((t) => t.ticker)))];
    const batch = async (tickers, kind, sink) => {
      for (let i = 0; i < tickers.length; i += 100) {
        const p = await get(kind, '/markets', { tickers: tickers.slice(i, i + 100).join(','), limit: 1000 });
        const got = new Map((p?.markets ?? []).map((m) => [m.ticker, m]));
        for (const t of tickers.slice(i, i + 100)) sink(t, got.get(t));
      }
    };
    const needCombos = comboTickers.filter((t) => !combos.has(t));
    await batch(needCombos, 'combos', (t, m) => combos.add({ t, legs: m?.mve_selected_legs?.map((l) => [l.market_ticker, l.side, l.event_ticker]) ?? null, r: m?.result ?? '' }));
    log(`combos resolved: ${comboTickers.length} unique (${needCombos.length} fetched)`);

    // ---- 3. keep set
    const kept = new Set(comboTickers.filter((t) => { const c = combos.get(t); return c?.legs?.length && (!args.sportsOnly || c.legs.some(([m, , e]) => isSportsLeg(m, e))) && (!args.crypto15m || c.legs.every(([m, , e]) => isCrypto15mLeg(m, e))); }));
    const legEvent = new Map(); for (const t of kept) for (const [m, , e] of combos.get(t).legs) legEvent.set(m, e);

    // ---- 4. score-line families of every touched game
    const families = new Map();
    for (const [m, e] of legEvent) { const f = scoreFamily(m, e); if (f) families.set(`${f.prefix}|${f.game}`, f); }
    const seriesOf = (e) => e.split('-')[0]; const stat = new Map();
    for (const r of events.map.values()) { const s = (stat.get(seriesOf(r.e)) ?? stat.set(seriesOf(r.e), { hit: 0, miss: 0 }).get(seriesOf(r.e))); r.m ? s.hit++ : s.miss++; }
    const own = new Set([...legEvent.values()]);
    let famN = 0;
    for (const f of families.values()) for (const e of familyEvents(f)) {
      if (events.has(e)) continue;
      const s = stat.get(seriesOf(e)); if (!own.has(e) && s && !s.hit && s.miss >= 3) continue; // series that has no events at all
      const p = await get('events', `/events/${e}`, { with_nested_markets: true });
      const s2 = stat.get(seriesOf(e)) ?? stat.set(seriesOf(e), { hit: 0, miss: 0 }).get(seriesOf(e));
      const ms = p?.event?.markets ?? p?.markets;
      if (ms?.length) { s2.hit++; events.add({ e, m: ms.map((m) => [m.ticker, m.result ?? '']) }); } else { s2.miss++; events.add({ e, m: null }); }
      if (++famN % 50 === 0) log(`families: ${famN} events listed`);
    }
    const famMarkets = (f) => familyEvents(f).flatMap((e) => (events.get(e)?.m ?? []).map(([t]) => [t, e]));
    const marketEvent = new Map(legEvent);
    for (const f of families.values()) for (const [t, e] of famMarkets(f)) marketEvent.set(t, e);

    // ---- 5. results for leg markets not covered by a family listing
    const famResult = new Map(); for (const r of events.map.values()) for (const [t, res] of r.m ?? []) famResult.set(t, res);
    const needLegs = [...legEvent.keys()].filter((t) => !famResult.has(t) && !markets.has(t));
    await batch(needLegs, 'legs', (t, m) => markets.add({ t, r: m?.result ?? '' }));
    log(`leg results: ${needLegs.length} fetched`);

    // ---- 6. candles per window
    const marketsOfWindow = (w) => {
      const need = new Set();
      for (const t of tape.get(w.minTs).trades) {
        if (!kept.has(t.ticker)) continue;
        for (const [m, , e] of combos.get(t.ticker).legs) {
          need.add(m);
          const f = scoreFamily(m, e); if (f) for (const [fm] of famMarkets(f)) need.add(fm);
        }
      }
      return [...need].filter((m) => marketEvent.has(m));
    };
    const span = Math.ceil(args.windowMinutes + 31); const chunk = Math.max(1, Math.min(100, Math.floor(9000 / span)));
    for (const [wi, w] of windows.entries()) {
      const file = join(cdir, 'candles', `${w.minTs}.json`);
      if (existsSync(file)) continue;
      const want = marketsOfWindow(w); const rows = [];
      for (let i = 0; i < want.length; i += chunk) {
        const p = await get('candles', '/markets/candlesticks', { market_tickers: want.slice(i, i + chunk).join(','), start_ts: w.minTs - 1800, end_ts: w.maxTs, period_interval: 1 });
        rows.push(...candleRows(p ?? {}, (t) => marketEvent.get(t)));
      }
      writeFileSync(`${file}.tmp`, JSON.stringify(rows)); renameSync(`${file}.tmp`, file);
      log(`candles ${wi + 1}/${windows.length}: ${want.length} markets, ${rows.length} rows`);
    }

    // ---- 7. write the state dir
    const trades = [...tape.values()].flatMap((w) => w.trades).filter((t) => kept.has(t.ticker)).sort((a, b) => (a.created_time < b.created_time ? -1 : 1));
    const nd = (rows) => (rows.length ? `${rows.map((r) => JSON.stringify(r)).join('\n')}\n` : '');
    writeFileSync(join(out, 'trades.jsonl'), nd(trades));
    writeFileSync(join(out, 'rfqs.jsonl'), nd([...kept].map((t) => ({ k: 'rfq', ticker: t, legs: combos.get(t).legs.map(([m, s]) => [m, s]) }))));
    const res = new Map();
    for (const [t, r] of famResult) if (r === 'yes' || r === 'no') res.set(t, r);
    for (const r of markets.map.values()) if (r.r === 'yes' || r.r === 'no') res.set(r.t, r.r);
    for (const t of kept) { const r = combos.get(t).r; if (r === 'yes' || r === 'no') res.set(t, r); }
    writeFileSync(join(out, 'results.jsonl'), nd([...res].map(([ticker, result]) => ({ k: 'res', ticker, result }))));
    const candleRowsAll = readdirSync(join(cdir, 'candles')).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(readFileSync(join(cdir, 'candles', f), 'utf8')));
    const uniq = new Map(); for (const r of candleRowsAll) uniq.set(`${r.ticker}@${r.ts}`, r);
    const snaps = snapshotLines([...uniq.values()]);
    const fd = openSync(join(out, 'legs.jsonl'), 'w');
    for (let i = 0; i < snaps.length; i += 5000) writeSync(fd, `${snaps.slice(i, i + 5000).join('\n')}\n`);
    closeSync(fd);

    const gamesOf = (t) => { const g = new Map(); for (const [m, , e] of combos.get(t).legs) { const k = legMeta(m, e).game; g.set(k, (g.get(k) ?? 0) + 1); } return g; };
    const cluster = (t) => [...gamesOf(t).values()].some((n) => n > 1);
    const summary = {
      from: args.from, to: args.to, windows: windows.length, windowMinutes: args.windowMinutes, sportsOnly: args.sportsOnly, crypto15m: args.crypto15m,
      tapeTrades: [...tape.values()].reduce((s, w) => s + w.tapeTrades, 0), comboPrintsAll: [...tape.values()].reduce((s, w) => s + w.trades.length, 0),
      comboPrints: trades.length, combos: kept.size, sameGameClusterCombos: [...kept].filter(cluster).length,
      sameGameClusterPrints: trades.filter((t) => cluster(t.ticker)).length, settledCombos: [...kept].filter((t) => res.has(t)).length,
      settledPrints: trades.filter((t) => res.has(t.ticker)).length, games: families.size, snapshots: snaps.length,
      thisRun: { requests: counts.requests, byKind: counts.byKind, seconds: Math.round((Date.now() - t0) / 1000) },
    };
    const prev = existsSync(join(out, 'summary.json')) ? JSON.parse(readFileSync(join(out, 'summary.json'), 'utf8')) : null;
    summary.cumulative = { requests: (prev?.cumulative?.requests ?? 0) + counts.requests, seconds: (prev?.cumulative?.seconds ?? 0) + summary.thisRun.seconds };
    writeFileSync(join(out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary, null, 2));
  } catch (e) {
    if (e instanceof StopRun) { log(`STOPPED: ${e.message}; caches saved in ${cdir}, rerun to resume`); process.exit(3); }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
