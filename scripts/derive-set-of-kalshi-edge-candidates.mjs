#!/usr/bin/env node
// Derives the set of Kalshi edge candidates: reads the last `days` of settled non-combo markets
// and their pre-close candlesticks from Kalshi's unauthenticated market-data API, measures
// realised rate versus price per (series family, horizon, price bucket, side, mode) net of
// Kalshi's fee, splits time into fit/test halves, and records the lanes whose held-out lower
// bound is positive under data/records/kalshi-edge-candidates/YYYY-MM-DD/. Paper research only:
// it places nothing and holds no credentials.
//
//   echo '{}' | node scripts/derive-set-of-kalshi-edge-candidates.mjs
//   echo '{"days":7,"maxMarketsPerCategory":40000}' | node scripts/derive-set-of-kalshi-edge-candidates.mjs
//
// Memory: market rows are kept compact; candles are folded into event-level cell aggregates and
// dropped batch by batch, so the working set stays far below a few hundred MB.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJavascriptNodeOperation } from '@red-cup-engineering/javascript-node-services-section/operation';
import { KALSHI_API } from '../src/kalshi-market-brief.mjs';
import {
  HORIZONS_HOURS, addMarketToEvent, derivePrefixFamilies, evaluateCells, foldEvent, hashString,
  newCellBook, newEventAccumulator, quoteAt, renderCandidatesReadme, describeRule, tradesFromQuote,
} from '../src/kalshi-edge-candidates.mjs';

/** This package's own root: records land under data/records/kalshi-edge-candidates/. */
export const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const USER_AGENT = '561-group-forecasting-services-section (forecasting@561.group)';
const seconds = (iso) => Math.floor(Date.parse(iso) / 1000);

/** A shared pacer: at most one request start per `paceMs` across all concurrent workers (~14/s at 70ms). */
function makePacer(paceMs) {
  let next = 0;
  return async () => { const now = Date.now(); const at = Math.max(now, next); next = at + paceMs; if (at > now) await pause(at - now); };
}

async function kalshiGet(path, query, { fetchImpl = fetch, pace }) {
  const url = new URL(`${KALSHI_API}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  let lastStatus = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await pace();
    let res;
    try { res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(90_000) }); }
    catch { await pause(1000 * 2 ** attempt); continue; }
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (res.status === 404 || res.status === 400) return null;
    await pause(1000 * 2 ** attempt);
  }
  throw new Error(`kalshi-edge-candidates: GET ${url.pathname} answered ${lastStatus}`);
}

const writeAtomic = (path, text) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text);
  renameSync(temporary, path);
};

/**
 * Derive and record the edge candidates for the last `days` of settled markets.
 * @param {{now?: string, days?: number, minVolume?: number, horizons?: number[], minEvents?: number, z?: number, orderSize?: number, maxSpread?: number, maxMarketsPerCategory?: number, concurrency?: number, outRoot?: string}} request
 * @param {{fetchImpl?: typeof fetch, paceMs?: number}} [io]
 */
export async function deriveSetOfKalshiEdgeCandidates(request = {}, io = {}) {
  const now = request.now ? Date.parse(request.now) : Date.now();
  if (!Number.isFinite(now)) throw new TypeError('derive-set-of-kalshi-edge-candidates: now must be an ISO instant');
  const days = request.days ?? 7, minVolume = request.minVolume ?? 10;
  const horizons = request.horizons ?? HORIZONS_HOURS, minEvents = request.minEvents ?? 30, z = request.z ?? 1.96;
  const orderSize = request.orderSize ?? 10, maxSpread = request.maxSpread ?? 0.1;
  const perCategory = request.maxMarketsPerCategory ?? 40_000, concurrency = request.concurrency ?? 6;
  const asOf = new Date(now).toISOString(), date = asOf.slice(0, 10);
  const directory = join(resolve(request.outRoot ?? join(NODE_ROOT, 'data', 'records', 'kalshi-edge-candidates')), date);
  const http = { fetchImpl: io.fetchImpl, pace: makePacer(io.paceMs ?? 70) };
  const startedAt = Date.now();
  let requests = 0;
  const get = (path, query) => { requests += 1; return kalshiGet(path, query, http); };

  // 1. Series: category and fee schedule, kept compact (the listing is large; only three fields survive).
  const series = new Map();
  for (const row of (await get('/series', {}))?.series ?? []) series.set(row.ticker, { category: row.category ?? 'Unknown', feeType: row.fee_type ?? 'quadratic', multiplier: row.fee_multiplier ?? 1 });
  const prefixes = derivePrefixFamilies([...series.keys()]);

  // 2. Settled markets, paged by close time, kept as compact rows.
  const toSeconds = Math.floor(now / 1000), fromSeconds = toSeconds - days * 86400;
  const rows = [];
  let cursor = '', pages = 0, marketsRead = 0;
  do {
    const body = await get('/markets', { status: 'settled', limit: 1000, min_close_ts: fromSeconds, max_close_ts: toSeconds, mve_filter: 'exclude', cursor });
    pages += 1;
    for (const market of body?.markets ?? []) {
      marketsRead += 1;
      if ((market.result !== 'yes' && market.result !== 'no') || Number(market.volume_fp || 0) < minVolume) continue;
      const seriesTicker = market.event_ticker.split('-')[0];
      rows.push({ t: market.ticker, e: market.event_ticker, s: seriesTicker, c: seconds(market.close_time), y: market.result === 'yes' });
    }
    cursor = body?.cursor ?? '';
  } while (cursor && pages < 2000);

  // 3. Per-category cap by deterministic event hash (whole events are kept or dropped together).
  const eventsByCategory = new Map();
  for (const row of rows) {
    const category = series.get(row.s)?.category ?? 'Unknown';
    const set = eventsByCategory.get(category) ?? new Map();
    set.set(row.e, (set.get(row.e) ?? 0) + 1);
    eventsByCategory.set(category, set);
  }
  const keepFraction = new Map();
  for (const [category, events] of eventsByCategory) {
    let total = 0; for (const n of events.values()) total += n;
    keepFraction.set(category, total <= perCategory ? 1 : perCategory / total);
  }
  const sampled = rows.filter((row) => (hashString(row.e) % 10_000) / 10_000 < keepFraction.get(series.get(row.s)?.category ?? 'Unknown'));
  rows.length = 0;
  sampled.sort((a, b) => a.c - b.c);
  const cutoff = sampled.length > 0 ? sampled[Math.floor(sampled.length / 2)].c : toSeconds;

  // 4. Candles in batches of <=50 markets spanning <=12h of closes (window <=37h); fold into event-level cells.
  const batches = [];
  for (let i = 0; i < sampled.length;) {
    let j = i;
    while (j < sampled.length && j - i < 50 && sampled[j].c - sampled[i].c <= 12 * 3600) j += 1;
    batches.push(sampled.slice(i, j)); i = j;
  }
  const remaining = new Map();
  for (const row of sampled) remaining.set(row.e, (remaining.get(row.e) ?? 0) + 1);
  const staging = new Map(), book = newCellBook();
  const quoted = new Set();
  let marketsQuoted = 0, cursorBatch = 0;
  const finishMarket = (row, candles) => {
    const info = series.get(row.s) ?? { category: 'Unknown', feeType: 'quadratic', multiplier: 1 };
    const families = [`series:${row.s}`, `category:${info.category}`];
    if (prefixes.has(row.s)) families.push(prefixes.get(row.s));
    let accumulator = staging.get(row.e);
    if (!accumulator) { accumulator = newEventAccumulator(row.c); staging.set(row.e, accumulator); }
    accumulator.firstClose = Math.min(accumulator.firstClose, row.c);
    let any = false;
    for (const horizon of horizons) {
      const quote = quoteAt(candles, row.c, horizon, { maxSpread });
      if (!quote) continue;
      any = true;
      addMarketToEvent(accumulator, families, horizon, tradesFromQuote(quote, row.y, { feeType: info.feeType, multiplier: info.multiplier, orderSize }));
    }
    if (any) { marketsQuoted += 1; quoted.add(row.e); }
    const left = remaining.get(row.e) - 1;
    remaining.set(row.e, left);
    if (left === 0) { foldEvent(book, accumulator, cutoff); staging.delete(row.e); remaining.delete(row.e); }
  };
  const worker = async () => {
    while (cursorBatch < batches.length) {
      const batch = batches[cursorBatch++];
      const end = batch[batch.length - 1].c, start = batch[0].c - 25 * 3600;
      const body = await get('/markets/candlesticks', { market_tickers: batch.map((row) => row.t).join(','), start_ts: start, end_ts: end, period_interval: 60 }).catch(() => null);
      const byTicker = new Map((body?.markets ?? []).map((m) => [m.market_ticker, m.candlesticks ?? []]));
      for (const row of batch) finishMarket(row, byTicker.get(row.t) ?? []);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  for (const [event, accumulator] of staging) foldEvent(book, accumulator, cutoff); // events cut short by a failed batch

  // 5. Evaluate and record.
  const evaluation = evaluateCells(book, { z, minEvents });
  const window = { from: new Date(fromSeconds * 1000).toISOString(), to: new Date(toSeconds * 1000).toISOString(), cutoff: new Date(cutoff * 1000).toISOString() };
  const counts = { marketsRead, marketsSampled: sampled.length, marketsQuoted, events: quoted.size, requests };
  const params = { days, minVolume, horizons, minEvents, z, orderSize, maxSpread, maxMarketsPerCategory: perCategory };
  const withRule = (row) => ({ ...row, rule: describeRule(row) });
  const results = {
    type: 'KalshiEdgeCandidates', version: 1, asOf, window, params, counts,
    tested: evaluation.tested, zBonferroni: evaluation.zBonferroni,
    candidates: evaluation.candidates.map(withRule),
    topTestedCells: evaluation.cells.slice(0, 200),
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000), peakRssMb: Math.round(process.memoryUsage().rss / 1048576),
  };
  writeAtomic(join(directory, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  writeAtomic(join(directory, 'README.md'), renderCandidatesReadme({ asOf, window, counts, evaluation, params }));
  return { asOf, directory, counts, tested: evaluation.tested, candidates: evaluation.candidates.length, survivingBonferroni: evaluation.candidates.filter((c) => c.survivesBonferroni).length, top: evaluation.candidates.slice(0, 10).map((c) => describeRule(c)), elapsedSeconds: results.elapsedSeconds, peakRssMb: results.peakRssMb };
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({
    name: 'derive-set-of-kalshi-edge-candidates',
    description: 'Derives Kalshi edge candidates from the last N days of settled non-combo markets and their pre-close candles: realised rate versus price per series family, horizon, price bucket, side and mode, net of Kalshi fees, with fit/test halves and Wilson bounds; records candidate lanes under data/records/kalshi-edge-candidates/YYYY-MM-DD/. Paper research only.',
    operation: deriveSetOfKalshiEdgeCandidates,
  }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
