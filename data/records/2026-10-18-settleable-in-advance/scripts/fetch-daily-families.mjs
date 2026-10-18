#!/usr/bin/env node
/**
 * Fetch what the settleable-in-advance measurement of the daily families needs, into data/ next to this record's scripts:
 *
 *   events   every settled event of the given series that closed in the window, with its markets (strike type and strikes, open and
 *            close, result, settlement value, volume)                                     data/events/<series>.jsonl
 *   trades   every trade of every traded market                                          data/trades/<event>.jsonl
 *   candles  the one-minute best bid and ask of every traded market                      data/candles/<event>.jsonl
 *   asos     the station's one-minute ASOS temperature (whole F) and precipitation, from the Iowa Environmental Mesonet's
 *            one-minute archive, for the stations of the temperature and rain series      data/asos/<ICAO>.csv
 *
 * Public endpoints only (Kalshi's market data; IEM), paced well under their read budgets; a file already fetched is not fetched again.
 *   node scripts/fetch-daily-families.mjs --what events,trades,candles,asos --series KXHIGHLAX,KXRAIN --from 2026-10-01 --to 2026-10-18
 */
import { mkdir, writeFile, appendFile, access, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { what: { type: 'string', default: 'events,trades,candles' }, series: { type: 'string' }, from: { type: 'string', default: '2026-10-01' }, to: { type: 'string', default: '2026-10-18' }, stations: { type: 'string' } } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const base = 'https://api.elections.kalshi.com/trade-api/v2';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (path) => access(path).then(() => true, () => false);
async function get(url, { json = true } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, { headers: { accept: json ? 'application/json' : 'text/csv' } }).catch(() => null);
    if (response?.ok) { await pause(110); return json ? response.json() : response.text(); }
    if (attempt >= 7) throw new Error(`${url}: ${response?.status ?? 'network'}`);
    await pause(1000 * 2 ** attempt);
  }
}
const from = Date.parse(`${values.from}T00:00:00Z`), to = Date.parse(`${values.to}T00:00:00Z`);
const what = new Set(values.what.split(','));
const series = (values.series ?? '').split(',').filter(Boolean);
const eventsOf = async (s) => (await readFile(join(root, 'events', `${s}.jsonl`), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

if (what.has('events')) {
  await mkdir(join(root, 'events'), { recursive: true });
  for (const s of series) {
    const file = join(root, 'events', `${s}.jsonl`), events = [];
    let cursor = '';
    do {
      const page = await get(`${base}/events?series_ticker=${s}&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
      for (const event of page.events) {
        const closes = (event.markets ?? []).map((m) => Date.parse(m.close_time)).filter(Number.isFinite);
        if (closes.length && Math.max(...closes) >= from && Math.max(...closes) < to && (event.markets ?? []).length && event.markets.every((m) => m.status === 'finalized' || m.status === 'settled')) events.push(event);
      }
      cursor = page.cursor;
      const lastCloses = (page.events.at(-1)?.markets ?? []).map((m) => Date.parse(m.close_time)).filter(Number.isFinite);
      if (lastCloses.length && Math.max(...lastCloses) < from) break;
    } while (cursor);
    await writeFile(file, events.map((e) => JSON.stringify({ event_ticker: e.event_ticker, markets: e.markets.map((m) => ({ ticker: m.ticker, strike_type: m.strike_type, floor_strike: m.floor_strike, cap_strike: m.cap_strike, open_time: m.open_time, close_time: m.close_time, expiration_time: m.expiration_time, result: m.result, expiration_value: m.expiration_value, volume_fp: m.volume_fp, rules_primary: m.rules_primary })) })).join('\n') + (events.length ? '\n' : ''));
    process.stdout.write(`${s}: ${events.length} settled events\n`);
  }
}
if (what.has('trades')) {
  await mkdir(join(root, 'trades'), { recursive: true });
  for (const s of series) for (const event of await eventsOf(s)) {
    const file = join(root, 'trades', `${event.event_ticker}.jsonl`);
    if (await exists(file)) continue;
    const rows = [];
    for (const market of event.markets.filter((m) => Number(m.volume_fp) > 0)) {
      let c = '';
      do { const page = await get(`${base}/markets/trades?ticker=${market.ticker}&limit=1000${c ? `&cursor=${c}` : ''}`); rows.push(...page.trades.map((t) => JSON.stringify(t))); c = page.cursor; } while (c);
    }
    await writeFile(file, rows.join('\n') + (rows.length ? '\n' : ''));
  }
  process.stdout.write('trades done\n');
}
if (what.has('candles')) {
  await mkdir(join(root, 'candles'), { recursive: true });
  for (const s of series) for (const event of await eventsOf(s)) {
    const file = join(root, 'candles', `${event.event_ticker}.jsonl`);
    if (await exists(file)) continue;
    const rows = [];
    for (const market of event.markets.filter((m) => Number(m.volume_fp) > 0)) {
      const open = Date.parse(market.open_time) / 1000, close = Date.parse(market.close_time) / 1000, candles = [];
      // 5000 one-minute periods is the most one request returns
      for (let start = open; start < close; start += 4800 * 60) candles.push(...((await get(`${base}/series/${s}/markets/${market.ticker}/candlesticks?start_ts=${start}&end_ts=${Math.min(close, start + 4800 * 60)}&period_interval=1`)).candlesticks ?? []));
      rows.push(JSON.stringify({ ticker: market.ticker, candles }));
    }
    await writeFile(file, rows.join('\n') + (rows.length ? '\n' : ''));
  }
  process.stdout.write('candles done\n');
}
if (what.has('asos')) {
  await mkdir(join(root, 'asos'), { recursive: true });
  const start = new Date(from - 86_400_000), end = new Date(to + 86_400_000);
  const ymd = (d) => [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  for (const station of (values.stations ?? '').split(',').filter(Boolean)) {
    const file = join(root, 'asos', `${station}.csv`);
    if (await exists(file)) continue;
    const iata = station.length === 4 && station.startsWith('K') ? station.slice(1) : station;
    const [y1, m1, d1] = ymd(start), [y2, m2, d2] = ymd(end);
    const text = await get(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos1min.py?station=${iata}&vars=tmpf&vars=precip&sts=${start.toISOString().slice(0, 16)}Z&ets=${end.toISOString().slice(0, 16)}Z&sample=1min&what=download&tz=UTC`, { json: false });
    void y1; void m1; void d1; void y2; void m2; void d2;
    await writeFile(file, text);
    process.stdout.write(`${station}: ${text.split('\n').length - 1} rows\n`);
    await pause(1500);
  }
}
void appendFile;
