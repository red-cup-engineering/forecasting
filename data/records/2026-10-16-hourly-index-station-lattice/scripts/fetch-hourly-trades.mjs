#!/usr/bin/env node
/**
 * Fetch every settled hourly index event in a window with its markets (strike, result, settled index value,
 * volume) into data/events/<series>.jsonl, then every trade of every market that traded into
 * data/trades/<event>.jsonl. Public endpoints; paced well under the read budget.
 *   node scripts/fetch-hourly-trades.mjs --from 2026-10-01 --to 2026-10-17
 */
import { mkdir, writeFile, appendFile, access, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, series: { type: 'string', default: 'KXTEMPNYCHS,KXTEMPMIAH,KXTEMPCHIHS,KXTEMPLAXHS' } } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const base = 'https://api.elections.kalshi.com/trade-api/v2';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function get(path) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(base + path, { headers: { accept: 'application/json' } });
    if (response.ok) { await pause(120); return response.json(); }
    if (attempt >= 6) throw new Error(`${path}: ${response.status}`);
    await pause(1000 * 2 ** attempt);
  }
}
const from = Date.parse(`${values.from}T00:00:00Z`), to = Date.parse(`${values.to}T00:00:00Z`);
await mkdir(join(root, 'events'), { recursive: true });
await mkdir(join(root, 'trades'), { recursive: true });
for (const series of values.series.split(',')) {
  const eventsFile = join(root, 'events', `${series}.jsonl`);
  const events = [];
  let cursor = '';
  do {
    const page = await get(`/events?series_ticker=${series}&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`);
    for (const event of page.events) {
      const close = Date.parse(event.markets?.[0]?.close_time);
      if (close >= from && close < to && event.markets.every((m) => m.status === 'finalized' || m.status === 'settled')) events.push(event);
    }
    cursor = page.cursor;
    if (page.events.length && Date.parse(page.events.at(-1).markets?.[0]?.close_time) < from) break;
  } while (cursor);
  await writeFile(eventsFile, events.map((event) => JSON.stringify({ event_ticker: event.event_ticker, markets: event.markets.map((m) => ({ ticker: m.ticker, strike_type: m.strike_type, floor_strike: m.floor_strike, cap_strike: m.cap_strike, open_time: m.open_time, close_time: m.close_time, result: m.result, expiration_value: m.expiration_value, volume_fp: m.volume_fp })) })).join('\n') + '\n');
  process.stdout.write(`${series}: ${events.length} settled events\n`);
  for (const event of events) {
    const file = join(root, 'trades', `${event.event_ticker}.jsonl`);
    if (await access(file).then(() => true, () => false)) continue;
    const rows = [];
    for (const market of event.markets.filter((m) => Number(m.volume_fp) > 0)) {
      let c = '';
      do { const page = await get(`/markets/trades?ticker=${market.ticker}&limit=1000${c ? `&cursor=${c}` : ''}`); rows.push(...page.trades); c = page.cursor; } while (c);
    }
    await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''));
  }
  process.stdout.write(`${series}: trades done\n`);
}
