#!/usr/bin/env node
/**
 * Depth on offer, sampled: the venue keeps no history of its order books, so the queue a resting bid joins can only be measured
 * forward. This reads (public GETs only, paced) the order book of every open market of the given series every `--every` seconds for
 * `--rounds` rounds, and keeps the top of each side with its sizes, into data/books/<date>.jsonl, one line per market per round.
 *   node scripts/sample-books.mjs --series KXHIGHLAX,KXRAIN --rounds 12 --every 300
 */
import { mkdir, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { series: { type: 'string' }, rounds: { type: 'string', default: '12' }, every: { type: 'string', default: '300' }, rate: { type: 'string', default: '6' } } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'books');
await mkdir(root, { recursive: true });
const base = 'https://api.elections.kalshi.com/trade-api/v2';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const get = async (path) => { for (let a = 0; a < 5; a += 1) { const r = await fetch(base + path).catch(() => null); if (r?.ok) return r.json(); await pause(1000 * 2 ** a); } return null; };
const gap = 1000 / Number(values.rate);
const list = async () => {
  const out = [];
  for (const series of values.series.split(',')) { const page = await get(`/markets?series_ticker=${series}&status=open&limit=1000`); for (const m of page?.markets ?? []) out.push({ ticker: m.ticker, series, close: m.close_time, strike_type: m.strike_type, floor: m.floor_strike, cap: m.cap_strike }); await pause(gap); }
  return out;
};
for (let round = 0; round < Number(values.rounds); round += 1) {
  const started = Date.now(), markets = await list(), lines = [];
  for (const m of markets) {
    const book = await get(`/markets/${m.ticker}/orderbook?depth=5`), at = Date.now();
    if (book) lines.push(JSON.stringify({ at, ...m, yes: book.orderbook_fp?.yes_dollars ?? [], no: book.orderbook_fp?.no_dollars ?? [] }));
    await pause(gap);
  }
  await appendFile(join(root, `${new Date().toISOString().slice(0, 10)}.jsonl`), lines.join('\n') + '\n');
  process.stdout.write(`round ${round} ${lines.length} books ${(Date.now() - started) / 1000}s\n`);
  await pause(Math.max(0, Number(values.every) * 1000 - (Date.now() - started)));
}
