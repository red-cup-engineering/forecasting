/**
 * The observation store: raw facts (settled markets, series fees, quotes, ESPN-derived live entries) as SEAVT
 * rows in the house journal layout (the Kalshi section's src/seavt-log.mjs), one feed, one plain file a day. Only what
 * cannot be derived is stored. Entries, ledgers and verdicts are derived from these
 * observations and the hypothesis specs, and live as discardable indexes (see run.mjs).
 *
 *   e  entity   a market ticker, a series ticker, a game id
 *   a  attribute  'market' | 'series' | 'quote:<anchor>:<offsetMinutes>' | 'sync' | 'dt-entry'
 *   v  value    a JSON value (mark)
 *   t  observation instant (ISO); the day it is logged under
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { appendLogRows, feedRows, mark, unmark } from '@red-cup-engineering/kalshi-services-section/seavt-log';

export const FEED = 'hypotheses-observation';
export const stateRoot = (env = process.env) => env.HYPOTHESES_STATE_DIR ?? join(env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'hypotheses');
export const cacheDir = (root) => join(root, 'cache');

/** Open the store: the feed is replayed once into an index (attribute -> entity -> latest value). */
export function openStore(dir) {
  const index = new Map();
  for (const row of feedRows(dir, FEED)) {
    const a = unmark(row.a), e = unmark(row.e);
    if (!index.has(a)) index.set(a, new Map());
    index.get(a).set(e, unmark(row.v));
  }
  return {
    dir,
    has: (e, a) => index.get(a)?.has(e) ?? false,
    get: (e, a) => index.get(a)?.get(e),
    /** Entities holding attribute `a` as [entity, value]. */
    all: (a) => [...(index.get(a)?.entries() ?? [])],
    /** Append an observation unless it repeats the stored value; returns whether a row was written. */
    put(e, a, v, t) {
      if (index.get(a)?.has(e) && isDeepStrictEqual(index.get(a).get(e), v)) return false;
      appendLogRows(dir, FEED, [{ e: mark(e), a: mark(a), v: mark(v), t: typeof t === 'number' ? new Date(t).toISOString() : t }], (row) => row.t.slice(0, 10));
      if (!index.has(a)) index.set(a, new Map());
      index.get(a).set(e, v);
      return true;
    },
    pack: (today) => packClosedLogs(dir, FEED, today),
  };
}
