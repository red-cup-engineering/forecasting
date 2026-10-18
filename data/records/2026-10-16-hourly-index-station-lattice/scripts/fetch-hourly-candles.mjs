#!/usr/bin/env node
/**
 * Fetch the one-minute candlesticks (best yes bid and yes ask: open, low, high, close; traded price; volume) of every traded
 * market of the settled hourly index events in data/events/<series>.jsonl, from 15 minutes before the market opens to its
 * close, into data/candles/<event>.jsonl (one line per market). The book's sizes are not recorded by the venue's history;
 * this is the best bid and ask each minute. Public endpoint; paced well under the read budget.
 *   node scripts/fetch-hourly-candles.mjs [--series KXTEMPNYCHS,...]
 */
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { series: { type: 'string', default: 'KXTEMPNYCHS,KXTEMPMIAH,KXTEMPCHIHS,KXTEMPLAXHS' } } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const base = 'https://api.elections.kalshi.com/trade-api/v2';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function get(path) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(base + path, { headers: { accept: 'application/json' } }).catch(() => null);
    if (response?.ok) { await pause(100); return response.json(); }
    if (attempt >= 6) throw new Error(`${path}: ${response.status}`);
    await pause(1000 * 2 ** attempt);
  }
}
await mkdir(join(root, 'candles'), { recursive: true });
for (const series of values.series.split(',')) {
  const events = (await readFile(join(root, 'events', `${series}.jsonl`), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  let done = 0;
  for (const event of events) {
    const file = join(root, 'candles', `${event.event_ticker}.jsonl`);
    if (await access(file).then(() => true, () => false)) continue;
    const rows = [];
    for (const market of event.markets.filter((m) => Number(m.volume_fp) > 0)) {
      const close = Date.parse(market.close_time) / 1000, open = Date.parse(market.open_time) / 1000;
      const page = await get(`/series/${series}/markets/${market.ticker}/candlesticks?start_ts=${open - 900}&end_ts=${close}&period_interval=1`);
      rows.push(JSON.stringify({ ticker: market.ticker, candles: page.candlesticks ?? [] }));
    }
    await writeFile(file, rows.join('\n') + (rows.length ? '\n' : ''));
    done += 1;
    if (done % 50 === 0) process.stdout.write(`${series} ${done}/${events.length}\n`);
  }
  process.stdout.write(`${series}: candles done\n`);
}
