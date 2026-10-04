#!/usr/bin/env node
// Catalog every settled KXEARNINGSMENTION* / KXMENTIONEARN* market with call start (milestone) and
// minute candlesticks around the call. Public unsigned GETs only (credentials: null), ~200 ms apart,
// backoff on 429, everything cached as JSON under --cache (default the session scratchpad).
//   node scripts/earnings-mentions-collect.mjs [--cache DIR] [--max-series N] [--no-candles]
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createKalshiClient } from '../../../src/client.mjs';
import { isEarningsSeries } from '../src/earnings-mentions.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : (args[i + 1] ?? true); };
const cache = opt('cache', '/tmp/claude-1000/-home-emsenn-info/ff528934-809b-45da-8279-b7a50087597e/scratchpad/cache');
mkdirSync(join(cache, 'candles'), { recursive: true });
const client = createKalshiClient({ credentials: null });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function polite(fn) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const wait = Math.max(0, last + 200 - Date.now());
    if (wait) await sleep(wait);
    last = Date.now();
    try { return await fn(); } catch (error) {
      if (error.status === 429 || error.code === 'network') { await sleep(1000 * 2 ** attempt); continue; }
      throw error;
    }
  }
  throw new Error('gave up after retries');
}
const load = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const save = (path, value) => writeFileSync(path, JSON.stringify(value));

let series = load(join(cache, 'series.json'));
if (!series) {
  const payload = await polite(() => client.call('GET', '/series', { signed: false }));
  series = payload.series.map((s) => s.ticker).filter(isEarningsSeries);
  save(join(cache, 'series.json'), series);
}
console.error(`series: ${series.length}`);

// Milestones carry the call start.
let milestones = load(join(cache, 'milestones.json'));
if (!milestones) {
  milestones = [];
  let cursor;
  for (let i = 0; i < 200; i += 1) {
    const p = await polite(() => client.call('GET', '/milestones', { query: { limit: 200, category: 'Mentions', cursor }, signed: false }));
    for (const m of p.milestones) if (/earnings/i.test(m.title ?? '') || m.type === 'company_report') milestones.push({ start: m.start_date, end: m.end_date, title: m.title, events: m.related_event_tickers ?? [] });
    cursor = p.cursor; if (!cursor) break;
  }
  save(join(cache, 'milestones.json'), milestones);
}
console.error(`milestones: ${milestones.length}`);

const maxSeries = Number(opt('max-series', series.length));
const markets = [];
for (const s of series.slice(0, maxSeries)) {
  const path = join(cache, `markets-${s}.json`);
  let rows = load(path);
  if (!rows) { rows = await polite(() => client.getMarkets({ series_ticker: s, status: 'settled' })); save(path, rows); }
  const hpath = join(cache, `hmarkets-${s}.json`);
  let hrows = load(hpath);
  if (!hrows) {
    hrows = [];
    let cursor;
    for (let i = 0; i < 50; i += 1) {
      const p = await polite(() => client.call('GET', '/historical/markets', { query: { series_ticker: s, limit: 200, cursor }, signed: false }));
      hrows.push(...(p.markets ?? [])); cursor = p.cursor; if (!cursor) break;
    }
    save(hpath, hrows);
  }
  const seen = new Set(rows.map((m) => m.ticker));
  markets.push(...rows, ...hrows.filter((m) => !seen.has(m.ticker)).map((m) => ({ ...m, _historical: true })));
}
console.error(`settled markets: ${markets.length}`);
const startOf = new Map();
for (const m of milestones) for (const e of m.events) startOf.set(e, Date.parse(m.start));
const slim = markets.map((m) => ({
  ticker: m.ticker, event: m.event_ticker, series: m.event_ticker.replace(/-[^-]+$/u, ''),
  word: m.custom_strike?.Word ?? m.yes_sub_title, result: m.result, open: m.open_time, close: m.close_time,
  volume: Number(m.volume_fp ?? m.volume), historical: Boolean(m._historical), callStart: startOf.get(m.event_ticker) ?? null, occ: m.occurrence_datetime,
}));
save(join(cache, 'catalog.json'), slim);
console.error(`with call start: ${slim.filter((m) => m.callStart).length}`);

if (!args.includes('--no-candles')) {
  let n = 0;
  const start = Math.floor(slim.length * Number(opt('start-frac', 0)));
  const walk = [...slim.slice(start), ...slim.slice(0, start)];
  if (opt('order', 'forward') === 'reverse') walk.reverse();
  for (const m of walk) {
    if (!m.callStart || !['yes', 'no'].includes(m.result)) continue;
    const path = join(cache, 'candles', `${m.ticker}.json`);
    if (existsSync(path)) continue;
    const t = m.callStart / 1000;
    const query = { start_ts: Math.floor(t - 26 * 3600), end_ts: Math.floor(t + 600), period_interval: 1 };
    const rows = m.historical
      ? await polite(() => client.call('GET', `/historical/markets/${m.ticker}/candlesticks`, { query, signed: false })).then((p) => p.candlesticks ?? [])
      : await polite(() => client.getCandlesticks(m.series, m.ticker, query));
    save(path, rows);
    if (++n % 200 === 0) console.error(`candles ${n}`);
  }
}
console.error('done');
