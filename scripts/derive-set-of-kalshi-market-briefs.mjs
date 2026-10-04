#!/usr/bin/env node
// Derives a set of Kalshi market research briefs (src/kalshi-market-brief.mjs) for the
// open events closing soonest, across categories, and writes them as typed records to
// data/records/kalshi-market-briefs/YYYY-MM-DD/. Paper only: it reads Kalshi's
// unauthenticated market-data API and public weather data, and places nothing.
//
//   echo '{}' | node scripts/derive-set-of-kalshi-market-briefs.mjs
//   echo '{"withinHours":24,"maxEvents":40,"minVolume24h":100}' | node scripts/derive-set-of-kalshi-market-briefs.mjs
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runJavascriptNodeOperation } from '@red-cup-engineering/javascript-node-services-section/operation';
import { HOUSE_MODEL_HOOKS, KALSHI_API, baseRateFamily, buildKalshiMarketBrief, estimateHouseView, validateKalshiMarketBrief } from '../src/kalshi-market-brief.mjs';

/** This package's own root: briefs land under data/records/kalshi-market-briefs/. */
export const NODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const USER_AGENT = '561-group-forecasting-services-section (forecasting@561.group)';

/** GET a Kalshi public path with backoff on throttling; throws after the last attempt. */
async function kalshiGet(path, query, { fetchImpl = fetch, paceMs = 70 } = {}) {
  const url = new URL(`${KALSHI_API}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  let lastStatus = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await pause(paceMs);
    const res = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    if (res.ok) return res.json();
    lastStatus = res.status;
    if (res.status === 404) return null;
    if (res.status !== 429 && res.status < 500) break;
    await pause(1000 * 2 ** attempt);
  }
  throw new Error(`kalshi-market-briefs: GET ${url.pathname} answered ${lastStatus}`);
}

/** Every open market closing inside the scan window (multivariate combos excluded). */
async function openMarketsClosing({ nowSeconds, withinHours, maxPages = 80 }, io) {
  const markets = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page += 1) {
    const body = await kalshiGet('/markets', { status: 'open', limit: 1000, min_close_ts: nowSeconds, max_close_ts: nowSeconds + withinHours * 3600, mve_filter: 'exclude', cursor }, io);
    markets.push(...(body?.markets ?? []));
    cursor = body?.cursor ?? '';
    if (!cursor || !(body?.markets?.length > 0)) break;
  }
  return markets;
}

/** Run `work` over `items` with at most `limit` in flight. */
async function mapConcurrent(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]);
  }));
}

const dollars = (value) => (value === undefined || value === null || value === '' ? 0 : Number(value));

/**
 * Pick up to `maxEvents` events, diverse by category and family, liquid first: events are
 * ranked by 24-hour volume plus a tenth of open interest, then taken round-robin across
 * categories, at most `perFamily` from any one family (one gas-price state, one city's temperature).
 * Pure.
 * @param {{eventTicker: string, seriesTicker: string, category: string, family: string, score: number}[]} candidates
 * @returns {object[]}
 */
export function selectDiverseEvents(candidates, { maxEvents = 40, perFamily = 3, perCategory = Infinity } = {}) {
  const byCategory = new Map();
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (!byCategory.has(candidate.category)) byCategory.set(candidate.category, []);
    byCategory.get(candidate.category).push(candidate);
  }
  const taken = [], perFamilyCount = new Map();
  const queues = [...byCategory.entries()].sort((a, b) => b[1][0].score - a[1][0].score).map(([, list]) => list);
  while (taken.length < maxEvents && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      while (queue.length > 0) {
        const next = queue.shift();
        const key = `${next.category}|${next.family}`;
        if ((perFamilyCount.get(key) ?? 0) >= perFamily || (perFamilyCount.get(next.category) ?? 0) >= perCategory) continue;
        perFamilyCount.set(key, (perFamilyCount.get(key) ?? 0) + 1);
        perFamilyCount.set(next.category, (perFamilyCount.get(next.category) ?? 0) + 1);
        taken.push(next);
        break;
      }
      if (taken.length >= maxEvents) break;
    }
  }
  return taken;
}

const writeAtomic = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
};

/**
 * Derive and record the briefs for the open events closing within `withinHours`.
 * @param {{now?: string, reserveModelled?: number, withinHours?: number, maxEvents?: number, perFamily?: number, perCategory?: number, minVolume24h?: number, minHoursToClose?: number, scanDays?: number, modelledHorizonHours?: number, houseModels?: boolean, outRoot?: string, cacheDir?: string}} request
 * @param {{fetchImpl?: typeof fetch, paceMs?: number}} [io]
 * @returns {Promise<{asOf: string, directory: string, considered: object, written: number, refused: object[], briefs: object[]}>}
 */
export async function deriveSetOfKalshiMarketBriefs(request = {}, io = {}) {
  const now = request.now ? Date.parse(request.now) : Date.now();
  if (!Number.isFinite(now)) throw new TypeError('derive-set-of-kalshi-market-briefs: now must be an ISO instant');
  const withinHours = request.withinHours ?? 24;
  const maxEvents = request.maxEvents ?? 40;
  const minVolume24h = request.minVolume24h ?? 100;
  const asOf = new Date(now).toISOString();
  const date = asOf.slice(0, 10);
  const directory = join(resolve(request.outRoot ?? join(NODE_ROOT, 'data', 'records', 'kalshi-market-briefs')), date);
  const cacheDir = request.cacheDir ?? join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), '561-group', 'kalshi-market-briefs', 'nbm');

  // Kalshi filters on close_time, which for a game or a weekly series is long after the event
  // settles, so the scan reaches `scanDays` out and the window is applied here to whichever of
  // close_time and expected_expiration_time comes first. Events a house model prices (tomorrow's
  // temperature brackets) are also taken out to `modelledHorizonHours`.
  const scanDays = request.scanDays ?? 6;
  const modelledHorizonHours = request.modelledHorizonHours ?? 36;
  const minHoursToClose = request.minHoursToClose ?? 2;
  const scanned = await openMarketsClosing({ nowSeconds: Math.floor(now / 1000), withinHours: scanDays * 24 }, io);
  const hoursUntil = (at) => (Date.parse(at) - now) / 3600_000;
  const modelled = (market) => HOUSE_MODEL_HOOKS.some((hook) => hook.coversSeries?.(market.event_ticker.split('-')[0]));
  const markets = scanned.filter((market) => {
    const closes = hoursUntil(market.close_time), expires = hoursUntil(market.expected_expiration_time ?? market.close_time);
    const soonest = Math.min(closes, expires > 0 ? expires : Infinity);
    return soonest >= minHoursToClose && soonest <= (modelled(market) ? modelledHorizonHours : withinHours);
  });
  const events = new Map();
  for (const market of markets) {
    if (!(dollars(market.yes_ask_dollars) > 0 && dollars(market.yes_ask_dollars) < 1)) continue; // no offer to buy YES: no book to brief
    const entry = events.get(market.event_ticker) ?? { eventTicker: market.event_ticker, seriesTicker: market.event_ticker.split('-')[0], volume24h: 0, openInterest: 0, markets: 0 };
    entry.volume24h += dollars(market.volume_24h_fp);
    entry.openInterest += dollars(market.open_interest_fp);
    entry.markets += 1;
    events.set(market.event_ticker, entry);
  }
  const liquid = [...events.values()].filter((entry) => entry.volume24h >= minVolume24h)
    .map((entry) => ({ ...entry, score: entry.volume24h + 0.1 * entry.openInterest })).sort((a, b) => b.score - a.score);

  // Categories and families come from the series records, fetched once per series for the liquid head.
  const series = new Map();
  const wanted = [...new Set(liquid.slice(0, 1500).map((entry) => entry.seriesTicker))];
  await mapConcurrent(wanted, 8, async (ticker) => { series.set(ticker, (await kalshiGet(`/series/${ticker}`, {}, io).catch(() => null))?.series ?? null); });
  const candidates = liquid.filter((entry) => series.get(entry.seriesTicker)).map((entry) => {
    const row = series.get(entry.seriesTicker);
    return { ...entry, category: row.category ?? 'Unknown', family: baseRateFamily(entry.seriesTicker) ?? row.tags?.[0] ?? entry.seriesTicker };
  });
  const assemble = async (pick) => {
    const body = await kalshiGet(`/events/${pick.eventTicker}`, { with_nested_markets: 'true' }, io);
    if (!body?.event) throw new Error('event not found');
    // Kalshi has answered nested markets at the top level and inside the event; take whichever holds them.
    const nested = body.markets?.length ? body.markets : body.event.markets ?? [];
    const context = { event: body.event, series: series.get(pick.seriesTicker), markets: nested, now };
    const house = request.houseModels === false ? null : await estimateHouseView(context, { guidanceCacheDir: cacheDir, fetchImpl: io.fetchImpl });
    return { context, house };
  };

  // Slots are reserved for events a house model actually prices (a model that cannot price today's
  // bracket says nothing), then the rest are taken diverse and liquid.
  const assembled = new Map();
  const reserved = [];
  const reserve = request.houseModels === false ? 0 : request.reserveModelled ?? 4;
  for (const pick of candidates.filter((entry) => HOUSE_MODEL_HOOKS.some((hook) => hook.coversSeries?.(entry.seriesTicker))).slice(0, 40)) {
    if (reserved.length >= reserve) break;
    try {
      const built = await assemble(pick);
      if (built.house?.status === 'priced') { assembled.set(pick.eventTicker, built); reserved.push(pick); }
    } catch { /* an unreadable event is simply not reserved */ }
  }
  const taken = new Set(reserved.map((pick) => pick.eventTicker));
  const diverse = selectDiverseEvents(candidates.filter((entry) => !taken.has(entry.eventTicker)),
    { maxEvents: maxEvents - reserved.length, perFamily: request.perFamily ?? 3, perCategory: request.perCategory ?? Math.ceil(maxEvents / 4) });
  const chosen = [...reserved, ...diverse];

  const briefs = [], refused = [];
  for (const pick of chosen) {
    try {
      const built = assembled.get(pick.eventTicker) ?? await assemble(pick);
      const brief = buildKalshiMarketBrief({ ...built.context, house: built.house });
      const problems = validateKalshiMarketBrief(brief);
      if (problems.length > 0) throw new Error(`invalid brief: ${problems.join(', ')}`);
      writeAtomic(join(directory, `${brief.briefId.replace('@', '.')}.json`), brief);
      briefs.push({
        briefId: brief.briefId, eventTicker: brief.event.eventTicker, category: brief.event.category, title: brief.event.title, hoursToClose: brief.event.hoursToClose,
        markets: brief.markets.length, volume24h: brief.book.volume24h, houseStatus: brief.house.status, opportunities: brief.opportunities.length, url: brief.event.url,
      });
    } catch (error) {
      refused.push({ eventTicker: pick.eventTicker, reason: String(error.message ?? error) });
    }
  }
  const summary = {
    asOf, directory, withinHours,
    considered: { openMarketsScanned: scanned.length, marketsInWindow: markets.length, eventsWithABook: events.size, eventsAboveVolumeFloor: liquid.length, minVolume24h, selected: chosen.length },
    written: briefs.length, refused, briefs,
  };
  writeAtomic(join(directory, `index.${asOf.replace(/[-:.]/gu, '').slice(0, 15)}Z.json`), summary);
  return summary;
}

if (import.meta.main) {
  const result = await runJavascriptNodeOperation({
    name: 'derive-set-of-kalshi-market-briefs',
    description: 'Derives research briefs for the liquid, diverse Kalshi events closing soonest (rule, settlement source, book, market-implied odds, house probability where a model applies, base rates, what would move it, allocator opportunities) and records them under data/records/kalshi-market-briefs/YYYY-MM-DD/. Paper only.',
    operation: deriveSetOfKalshiMarketBriefs,
  }, { arguments: process.argv.slice(2), standardInput: process.stdin, standardOutput: process.stdout });
  process.exitCode = result.exitCode;
}
