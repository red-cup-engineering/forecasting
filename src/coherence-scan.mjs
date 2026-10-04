/**
 * Live coherence scan over Kalshi's open universe: public market data only, no order,
 * no signature. Fetches events (with nested markets) and series metadata, builds the
 * constraint families, assesses each, and re-solves every Dutch book with order-book depth.
 */
import { createHash } from 'node:crypto';
import { assessFamily } from './coherence.mjs';
import { polymarketDepth } from './coherence-polymarket.mjs';
import {
  buildLadder, ladderFamily, ladderGroups, exclusiveFamily, stationDayFamily, windowUnionFamily,
  parseRainRule, datesBetween, quoteOf, thetaOf, isNumericStrike,
} from './coherence-families.mjs';

export const BASE = 'https://api.elections.kalshi.com/trade-api/v2';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, fetchImpl = fetch, tries = 5) {
  for (let i = 0; i < tries; i += 1) {
    const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await pause(500 * 2 ** i); continue; }
    throw new Error(`HTTP ${r.status} ${url}`);
  }
  throw new Error(`gave up ${url}`);
}

/** The open universe (combo/MVE events excluded); events carry their active markets. */
export async function fetchUniverse({ fetchImpl = fetch, maxPages = 200, throttleMs = 100, onPage } = {}) {
  const seriesRaw = (await getJson(`${BASE}/series`, fetchImpl)).series;
  const series = new Map(seriesRaw.map((s) => [s.ticker, {
    ticker: s.ticker, title: s.title, frequency: s.frequency, category: s.category,
    fee_type: s.fee_type, fee_multiplier: s.fee_multiplier,
    sources: JSON.stringify((s.settlement_sources ?? []).map((x) => x.name).sort()),
  }]));
  const events = [];
  let cursor = '';
  for (let p = 0; p < maxPages; p += 1) {
    const d = await getJson(`${BASE}/events?status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${cursor}` : ''}`, fetchImpl);
    for (const e of d.events) {
      if (e.event_ticker.startsWith('KXMVE')) continue;
      const weather = e.category === 'Climate and Weather';
      events.push({
        event_ticker: e.event_ticker, series_ticker: e.series_ticker, category: e.category, title: e.title,
        mutually_exclusive: e.mutually_exclusive,
        markets: e.markets.filter((m) => m.status === 'active' || m.status === 'open').map((m) => ({
          ticker: m.ticker, strike_type: m.strike_type, floor_strike: m.floor_strike, cap_strike: m.cap_strike,
          yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars,
          yes_bid_size_fp: m.yes_bid_size_fp, yes_ask_size_fp: m.yes_ask_size_fp,
          close_time: m.close_time, rules_primary: weather ? m.rules_primary : undefined,
        })),
      });
    }
    onPage?.(p, events.length);
    cursor = d.cursor;
    if (!cursor || !d.events.length) break;
    await pause(throttleMs);
  }
  return { events, series };
}

const stationOf = (m) => /\((CLI[A-Z0-9]+)\)/u.exec(m.rules_primary ?? '')?.[1] ?? null;
const extremeOf = (m) => (/maximum temperature/u.test(m.rules_primary ?? '') ? 'high' : /minimum temperature/u.test(m.rules_primary ?? '') ? 'low' : null);
const dateOfEvent = (t) => /(-\d\d[A-Z]{3}\d\d)$/u.exec(t)?.[1] ?? null;

/** Build all families from a universe. `extraByStationDay` carries other venues' interval quotes. */
export function buildFamilies({ events, series }, { extraByStationDay = new Map() } = {}) {
  const families = [];
  const skipped = { 'no-interval': 0, 'duplicate-strike': 0 };
  const ladders = [];
  const sourcesOf = (st) => series.get(st)?.sources ?? '[]';
  const mark = (fam, list) => { fam.sources = [...new Set(list.map(sourcesOf))]; return fam; };

  for (const e of events) {
    const s = series.get(e.series_ticker);
    for (const [subject, ms] of ladderGroups(e)) {
      const l = buildLadder(e, subject, ms, s);
      if (l.skipped) { skipped[l.skipped] += 1; continue; }
      l.station = stationOf(ms[0]); l.extreme = extremeOf(ms[0]);
      ladders.push(l);
    }
  }
  const paired = new Set();
  const byStation = new Map();
  for (const l of ladders) {
    const d = dateOfEvent(l.event);
    if (!l.station || !l.extreme || !d) continue;
    const key = `${l.station}|${d}`;
    if (!byStation.has(key)) byStation.set(key, {});
    byStation.get(key)[l.extreme] = l;
  }
  for (const [key, pair] of byStation) {
    const extras = extraByStationDay.get(key) ?? {};
    if (pair.high && pair.low) {
      const f = stationDayFamily(pair.high, pair.low, extras.high ?? [], extras.low ?? []);
      f.venues = extras.high?.length ? ['kalshi', 'polymarket'] : ['kalshi'];
      families.push(mark(f, [pair.high.series, pair.low.series]));
      paired.add(pair.high); paired.add(pair.low);
    } else if (extras.high?.length && pair.high) {
      const f = ladderFamily({ ...pair.high, extraKind: 'cross-venue-ladder' }, extras.high);
      f.venues = ['kalshi', 'polymarket'];
      families.push(mark(f, [pair.high.series]));
      paired.add(pair.high);
    }
  }
  for (const l of ladders) if (!paired.has(l)) families.push(mark(ladderFamily(l), [l.series]));

  for (const e of events) {
    if (!e.mutually_exclusive) continue;
    const f = exclusiveFamily(e, series.get(e.series_ticker));
    if (f) families.push(mark(f, [e.series_ticker]));
  }

  const days = new Map(); const wins = [];
  for (const e of events) {
    if (e.category !== 'Climate and Weather') continue;
    const s = series.get(e.series_ticker);
    for (const m of e.markets) {
      const r = parseRainRule(m.rules_primary);
      if (!r) continue;
      const q = { id: m.ticker, venue: 'kalshi', theta: thetaOf(s), ...quoteOf(m), series: e.series_ticker };
      if (r.kind === 'day') days.set(`${r.station}|${r.date}`, q); else wins.push({ r, q });
    }
  }
  for (const { r, q } of wins) {
    const present = datesBetween(r.from, r.to).map((d) => days.get(`${r.station}|${d}`)).filter(Boolean);
    if (present.length < 1 || present.length > 7) continue;
    const f = windowUnionFamily(q, present, `window:${q.id}`);
    f.venues = ['kalshi'];
    families.push(mark(f, [q.series, ...present.map((x) => x.series)]));
  }
  return { families, skipped };
}

/** Order book depth for one Kalshi market as YES-side price levels. */
export async function fetchDepth(ticker, fetchImpl = fetch) {
  const ob = (await getJson(`${BASE}/markets/${ticker}/orderbook`, fetchImpl)).orderbook_fp ?? {};
  const lv = (arr) => (arr ?? []).map(([p, s]) => ({ price: Number(p), size: Number(s) })).filter((x) => x.size > 0);
  return {
    bids: lv(ob.yes_dollars).sort((a, b) => b.price - a.price),
    asks: lv(ob.no_dollars).map((x) => ({ price: Number((1 - x.price).toFixed(4)), size: x.size })).sort((a, b) => a.price - b.price),
  };
}

/** Re-solve a violated family with full depth (fresh books) for the markets its portfolio uses. */
export async function redoWithDepth(family, assessed, { fetchImpl = fetch, throttleMs = 120 } = {}) {
  const tickers = new Set((assessed.portfolioRaw?.legs ?? []).map((l) => l.ticker));
  const deep = { ...family, markets: family.markets.map((m) => ({ ...m })) };
  for (const m of deep.markets) {
    if (!tickers.has(m.id)) continue;
    try {
      const d = m.venue === 'kalshi' ? await fetchDepth(m.id, fetchImpl) : await polymarketDepth(m.id);
      m.bids = d.bids; m.asks = d.asks; m.deep = true;
    } catch { if (m.venue !== 'kalshi') { m.bids = []; m.asks = []; } }
    await pause(m.venue === 'kalshi' ? throttleMs : 3200);
  }
  return { family: deep, assessed: assessFamily(deep) };
}

export const signatureOf = (portfolio) => createHash('sha1').update(JSON.stringify(portfolio.legs.map((l) => [l.ticker, l.side, l.price]))).digest('hex').slice(0, 12);

/** Settlement-rule risk flags for a family. */
export function riskFlags(family) {
  const flags = [];
  if ((family.sources?.length ?? 0) > 1) flags.push('mixed-settlement-sources');
  if (family.kind === 'exclusive-exhaustive-assumed') flags.push('void-or-tie-risk');
  if (family.kind === 'exclusive-set') flags.push('exclusivity-from-event-flag');
  if (family.venues?.includes('polymarket')) flags.push('cross-venue-settlement-source');
  if (family.kind === 'window-union') flags.push('rule-text-parsed');
  return flags;
}
