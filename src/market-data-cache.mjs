/**
 * Venue market data, fetched once and kept once.
 *
 * Every combo backfill run wrote its own `cache/` of the tape windows and 1-minute candles it fetched: 560-620 MB for a
 * weekend, plain JSON, the same markets' candles stored again by each window that overlapped them and again by each run
 * that touched the same day. This is the shared cache they all use: one content tree store (computer-file-engineering's
 * content-tree-store: prolly-tree chunks, content-addressed ni names, BGZF packs) under one directory.
 *
 *   tape      one value per sampled window, ref `tape/<minTs>-<maxTs>`: the window's combo prints
 *   candles   one value per (series, UTC day), ref `candles/<series>/<day>`: for each market the minutes fetched
 *             (`covered`, merged [from, to] second ranges) and its candle rows `[ts, bid, ask]`. A window asks for the
 *             markets and range it needs and the cache fetches only what no earlier window or run covered.
 *
 * Retention is explicit: market-data-cache.json (content/config) gives `keepDays` and `maxBytes`; `evict` removes the
 * refs older than the first and, while the store is over the second, the oldest of the rest, then gc's.
 */
import { createContentTreeStore } from '@red-cup-engineering/computer-file-engineering-services-section/content-tree-store';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import policy from '../content/config/market-data-cache.json' with { type: 'json' };

export const cachePolicy = () => policy;
export const marketDataCacheDir = (env = process.env) =>
  env.MARKET_DATA_CACHE_DIR ?? join(env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'market-data-cache');

const DAY = 86400;
const dayOf = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);
const seriesOf = (ticker) => ticker.split('-')[0].toLowerCase();
const merge = (ranges) => {
  const sorted = ranges.map((r) => [...r]).sort((a, b) => a[0] - b[0]), out = [];
  for (const r of sorted) { const last = out.at(-1); if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]); else out.push(r); }
  return out;
};
const covers = (ranges, from, to) => ranges.some((r) => r[0] <= from && r[1] >= to);

export function createMarketDataCache({ dir = marketDataCacheDir(), store = createContentTreeStore({ root: join(dir, 'content-tree') }) } = {}) {
  const held = new Map(), dirty = new Set();
  const refOf = (series, day) => `candles/${series}/${day}`;
  async function load(series, day) {
    const ref = refOf(series, day);
    if (!held.has(ref)) { const address = await store.getRef(ref); held.set(ref, address ? await store.get(address) : { markets: {} }); }
    return held.get(ref);
  }
  /** The (series, day) pieces of a range of seconds. */
  const pieces = (from, to) => { const out = []; for (let d = Math.floor(from / DAY); d <= Math.floor(to / DAY); d += 1) out.push({ day: dayOf(d * DAY), from: Math.max(from, d * DAY), to: Math.min(to, (d + 1) * DAY - 1) }); return out; };

  return Object.freeze({
    store,
    tape: Object.freeze({
      async get(minTs, maxTs) { const address = await store.getRef(`tape/${minTs}-${maxTs}`); return address ? store.get(address) : null; },
      async put(minTs, maxTs, record) { const address = await store.put(record); await store.setRef(`tape/${minTs}-${maxTs}`, address); return address; },
    }),
    candles: Object.freeze({
      /** The markets (of `tickers`) with candles not yet fetched over [from, to] (epoch seconds). */
      async missing(tickers, from, to) {
        const out = [];
        for (const ticker of tickers) {
          let whole = true;
          for (const p of pieces(from, to)) { const m = (await load(seriesOf(ticker), p.day)).markets[ticker]; if (!m || !covers(m.covered, p.from, p.to)) { whole = false; break; } }
          if (!whole) out.push(ticker);
        }
        return out;
      },
      /** Record the rows fetched for `tickers` over [from, to] ({ticker, ts, bid, ask}); a ticker with no rows is covered all the same. */
      async add(tickers, from, to, rows) {
        const byTicker = new Map(tickers.map((t) => [t, []]));
        for (const r of rows) byTicker.get(r.ticker)?.push(r);
        for (const [ticker, list] of byTicker) {
          for (const p of pieces(from, to)) {
            const value = await load(seriesOf(ticker), p.day), m = (value.markets[ticker] ??= { covered: [], rows: [] });
            const have = new Set(m.rows.map((r) => r[0]));
            for (const r of list) if (r.ts >= p.from && r.ts <= p.to && !have.has(r.ts)) m.rows.push([r.ts, r.bid, r.ask]);
            m.rows.sort((a, b) => a[0] - b[0]);
            m.covered = merge([...m.covered, [p.from, p.to]]);
            dirty.add(refOf(seriesOf(ticker), p.day));
          }
        }
      },
      /** The rows of `tickers` over [from, to]: {ticker, ts, bid, ask}. */
      async rows(tickers, from, to) {
        const out = [];
        for (const ticker of tickers) for (const p of pieces(from, to)) {
          const m = (await load(seriesOf(ticker), p.day)).markets[ticker];
          for (const [ts, bid, ask] of m?.rows ?? []) if (ts >= p.from && ts <= p.to) out.push({ ticker, ts, bid, ask });
        }
        return out;
      },
    }),
    /** Make what was added durable: each changed (series, day) is put and its ref moved. */
    async flush() {
      for (const ref of dirty) { const address = await store.put(held.get(ref)); await store.setRef(ref, address); }
      dirty.clear();
      await store.flush();
    },
    /** Drop what the policy does not keep. Resolves {removedRefs, bytes}. */
    async evict({ now = Date.now(), keepDays = policy.keepDays, maxBytes = policy.maxBytes } = {}) {
      const root = join(dir, 'content-tree');
      const refs = [];
      for await (const name of store.refs()) { const path = join(root, 'refs', ...name.split('/')); refs.push({ name, mtime: statSync(path).mtimeMs }); }
      refs.sort((a, b) => a.mtime - b.mtime);
      const bytes = () => { try { return readdirSync(join(root, 'packs')).reduce((n, f) => n + statSync(join(root, 'packs', f)).size, 0); } catch { return 0; } };
      const removed = [];
      for (const r of refs) if (now - r.mtime > keepDays * 86400_000) { await store.deleteRef(r.name); removed.push(r.name); }
      await store.gc({ graceMs: 0, major: true });
      for (const r of refs) { if (bytes() <= maxBytes) break; if (!removed.includes(r.name)) { await store.deleteRef(r.name); removed.push(r.name); await store.gc({ graceMs: 0, major: true }); } }
      return { removedRefs: removed.length, bytes: bytes() };
    },
  });
}
