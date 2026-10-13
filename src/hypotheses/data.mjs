/**
 * Fetch-and-cache for the hypothesis engine, incremental over the observation store. Every step spends the
 * caller's request budget and stops cleanly (reporting `partial`) when it is gone; a re-run picks up where
 * the last stopped because only absent facts are fetched.
 *
 *   syncSeries     series fee multiplier                                    GET /series/{t}
 *   syncSettled    settled markets closing at or after the cursor           GET /markets?series_ticker&status=settled&min_close_ts
 *   syncQuotes     the quote at a snapshot instant, one batch per window    GET /markets/candlesticks?market_tickers=
 */
import { BudgetExhausted } from './fetcher.mjs';
import { snapshotKey, snapshotTarget } from './entry.mjs';

const CURSOR_OVERLAP_MS = 3 * 86400000; // a market can settle after a later-closing one; re-reading the overlap is idempotent
const dollars = (x) => (x === undefined || x === null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);

/** The compact market fact stored once settled. */
export const marketFact = (m) => ({ ev: m.event_ticker, close: m.close_time, occ: m.occurrence_datetime ?? null, result: m.result, strike: m.floor_strike ?? m.cap_strike ?? null, strikeType: m.strike_type ?? null });

const guard = async (report, fn) => {
  try { await fn(); } catch (error) { if (error instanceof BudgetExhausted) report.partial = true; else throw error; }
};

export async function syncSeries({ store, fetcher, series, now, report }) {
  await guard(report, async () => {
    for (const s of series) {
      if (store.has(s, 'series')) continue;
      const p = await fetcher.kalshi(`/series/${s}`);
      store.put(s, 'series', { multiplier: Number(p.series?.fee_multiplier ?? 1), feeType: p.series?.fee_type ?? null }, now);
    }
  });
}

/** Witness an open contract during its registered window. A historical candle
 * fetched after settlement cannot replace a missed prospective observation. */
export async function syncForwardQuotes({ store, fetcher, hypotheses, report, receiptClock = () => Date.now() }) {
  await guard(report, async () => {
    for (const series of new Set(hypotheses.flatMap((h) => h.universe.series))) {
      let cursor = '';
      do {
        const page = await fetcher.kalshi('/markets', { series_ticker: series, status: 'open', limit: 1000, cursor });
        // Source time is the instant the response was received, NOT the earlier
        // cycle-selection time. A delayed public GET must not create a false
        // pre-registered window witness after that window has expired.
        const receivedAt = receiptClock();
        if (!Number.isSafeInteger(receivedAt) || receivedAt < 0)
          throw new RangeError('a finite post-fetch receipt clock in epoch milliseconds is required');
        const stamp = new Date(receivedAt).toISOString();
        for (const m of page.markets ?? []) {
          for (const h of hypotheses.filter((x) => x.universe.series.includes(series))) {
            const key = snapshotKey(h.entry.snapshot), target = snapshotTarget({ close: m.close_time, occ: m.occurrence_datetime }, h.entry.snapshot);
            if (store.get(m.ticker, key)?.kind === 'forward-window') continue;
            if (!(receivedAt >= Date.parse(h.registeredAt)) || !Number.isFinite(target)
              || Math.abs(receivedAt - target) > h.entry.snapshot.toleranceMinutes * 60000) continue;
            const bid = dollars(m.yes_bid_dollars), ask = dollars(m.yes_ask_dollars);
            if (!(bid > 0 && ask < 1 && ask >= bid)) continue;
            if (store.put(m.ticker, key, { ts: stamp, bid, ask, kind: 'forward-window', observedAt: stamp }, stamp))
              report.newQuotes = (report.newQuotes ?? 0) + 1;
          }
        }
        cursor = page.cursor ?? '';
      } while (cursor);
    }
  });
}

/** Settled markets of `series` that closed at or after `sinceMs` (the hypothesis registration). */
export async function syncSettled({ store, fetcher, series, sinceMs, now, report }) {
  await guard(report, async () => {
    const synced = store.get(series, 'sync');
    const from = Math.max(sinceMs, synced ? Date.parse(synced.closedThrough) - CURSOR_OVERLAP_MS : 0);
    let cursor = '', newest = synced ? Date.parse(synced.closedThrough) : 0;
    do {
      const page = await fetcher.kalshi('/markets', { series_ticker: series, status: 'settled', min_close_ts: Math.floor(from / 1000), limit: 1000, cursor });
      for (const m of page.markets ?? []) {
        if (m.result !== 'yes' && m.result !== 'no') continue;
        if (store.put(m.ticker, 'market', marketFact(m), now)) report.newMarkets = (report.newMarkets ?? 0) + 1;
        newest = Math.max(newest, Date.parse(m.close_time));
      }
      cursor = page.cursor ?? '';
      store.put(series, 'sync', { closedThrough: new Date(newest || from).toISOString() }, now);
    } while (cursor);
  });
}

/** The last two-sided quote at or before `targetMs` within the tolerance, from a candle list. */
export function quoteFromCandles(candles, targetSec, toleranceSec) {
  let best = null;
  for (const c of candles ?? []) {
    const ts = c.end_period_ts;
    if (!(ts <= targetSec && ts >= targetSec - toleranceSec)) continue;
    const bid = dollars(c.yes_bid?.close_dollars), ask = dollars(c.yes_ask?.close_dollars);
    if (bid === null || ask === null || !(bid > 0) || !(ask < 1)) continue;
    if (!best || ts > best.tsSec) best = { tsSec: ts, bid, ask };
  }
  return best ? { ts: new Date(best.tsSec * 1000).toISOString(), bid: best.bid, ask: best.ask } : { none: true };
}

/**
 * Quotes for settled markets lacking the snapshot's fact. Markets sharing a snapshot instant (one event) are
 * one batch window. Snapshots before `notBeforeMs` (registration) are never fetched.
 */
export async function syncQuotes({ store, fetcher, snapshot, universe, notBeforeMs, now, report }) {
  const key = snapshotKey(snapshot), windows = new Map();
  for (const [ticker, fact] of store.all('market')) {
    if (store.has(ticker, key)) continue;
    const series = ticker.split('-')[0];
    if (!universe.includes(series) || Date.parse(fact.close) < notBeforeMs) continue;
    const target = snapshotTarget({ close: fact.close, occ: fact.occ }, snapshot);
    if (!Number.isFinite(target) || target < notBeforeMs || target > now) continue;
    const w = String(target);
    if (!windows.has(w)) windows.set(w, []);
    windows.get(w).push(ticker);
  }
  await guard(report, async () => {
    for (const [w, tickers] of [...windows].sort(([a], [b]) => Number(a) - Number(b))) {
      const targetSec = Math.floor(Number(w) / 1000), tol = Math.round(snapshot.toleranceMinutes * 60);
      for (let i = 0; i < tickers.length; i += 100) {
        const batch = tickers.slice(i, i + 100);
        const p = await fetcher.kalshi('/markets/candlesticks', { market_tickers: batch.join(','), start_ts: targetSec - tol, end_ts: targetSec, period_interval: 1 });
        const byTicker = new Map((p.markets ?? []).map((m) => [m.market_ticker, m.candlesticks]));
        for (const t of batch) { store.put(t, key, quoteFromCandles(byTicker.get(t), targetSec, tol), now); report.newQuotes = (report.newQuotes ?? 0) + 1; }
      }
    }
  });
}

/** Tape rows for a universe: settled markets with their snapshot quote, in ticker order. */
export function tapeFor({ store, universe, snapshot, notBeforeMs, requireForward = false }) {
  const key = snapshotKey(snapshot), rows = [];
  for (const [ticker, fact] of store.all('market')) {
    const series = ticker.split('-')[0];
    if (!universe.includes(series) || Date.parse(fact.close) < notBeforeMs) continue;
    const q = store.get(ticker, key);
    rows.push({ ticker, event: fact.ev, close: fact.close, occ: fact.occ, result: fact.result, multiplier: store.get(series, 'series')?.multiplier ?? 1, quote: q && !q.none && (!requireForward || q.kind === 'forward-window') ? q : null });
  }
  return rows.sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
}
