// Shared helpers for the microstructure record. Read-only: public market data plus the desk's signed GETs.
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const recordDir = join(here, '..');
export const dataDir = join(recordDir, 'data');
export const resultsDir = join(recordDir, 'results');
mkdirSync(dataDir, { recursive: true });
mkdirSync(resultsDir, { recursive: true });

export const clientPath = fileURLToPath(new URL('../../../../../../src/client.mjs', import.meta.url));
const { createKalshiClient } = await import(clientPath);
export const makeClient = (opts) => createKalshiClient(opts);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const num = (x) => (x === undefined || x === null || x === '' ? null : Number(x));
export const cents = (x) => Math.round(Number(x) * 100);

export const weatherSeries = readFileSync(join(here, '../../2026-10-03-kalshi-temperature-tail-backtest/series.txt'), 'utf8')
  .split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
export const gasSeries = ['KXAAAGASD', 'KXAAAGASDNY', 'KXAAAGASDMA'];

export const appendNdjson = (file, rows) => { if (rows.length) appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
export const readNdjson = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Orderbook levels in cents: yesBids (buy YES) and yesAsks (sell YES = 100 - no bid), best first. */
export function levels(ob) {
  const bids = (ob?.yes_dollars ?? []).map(([p, q]) => [cents(p), Number(q)]).sort((a, b) => b[0] - a[0]);
  const asks = (ob?.no_dollars ?? []).map(([p, q]) => [100 - cents(p), Number(q)]).sort((a, b) => a[0] - b[0]);
  return { bids, asks };
}

/** Public trades for one ticker, newest first, back to minTs (unix seconds). */
export async function tradesFor(client, ticker, { minTs, maxTs, maxPages = 40 } = {}) {
  const out = [];
  let cursor;
  for (let page = 0; page < maxPages; page += 1) {
    const p = await client.call('GET', '/markets/trades', { query: { ticker, limit: 1000, min_ts: minTs, max_ts: maxTs, cursor }, signed: false });
    out.push(...(p.trades ?? []));
    cursor = p.cursor;
    if (!cursor || !(p.trades ?? []).length) break;
  }
  return out;
}
export const slimTrade = (t) => ({ id: t.trade_id, tk: t.ticker, t: t.created_time, p: cents(t.yes_price_dollars), n: Number(t.count_fp), s: t.taker_side });

const gasStates = 'MA NY PA CO AZ MN CA MI OH FL IL NC IN NM WA SC MO AK OR CT UT NJ KS MD WI TN TX GA ME VA NV'.split(' ');
export const gasSeriesAll = ['KXAAAGASD', 'KXDIESELD', ...gasStates.map((s) => `KXAAAGASD${s}`)];
