/**
 * Public GETs under a request budget the caller supplies (no hard-coded caps). Kalshi calls go through the
 * section's one client (paced, 429 backoff); other hosts are paced here. When the budget is spent the fetcher
 * throws BudgetExhausted, which the sync steps catch and report as a partial run.
 */
import { createKalshiClient } from '@red-cup-engineering/kalshi-services-section/client';

export class BudgetExhausted extends Error { constructor(limit) { super(`request budget ${limit} exhausted`); this.limit = limit; } }

export function createFetcher({ budget, client = createKalshiClient({ credentials: null }), fetchImpl = fetch, pauseMs = 250, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!Number.isInteger(budget) || budget < 0) throw new TypeError('requestBudget must be a nonnegative integer supplied by the caller');
  let spent = 0;
  const take = () => { if (spent >= budget) throw new BudgetExhausted(budget); spent += 1; };
  return {
    get spent() { return spent; },
    get remaining() { return budget - spent; },
    async kalshi(path, query) { take(); return client.call('GET', path, { query, signed: false }); },
    async url(url) {
      take(); await pause(pauseMs);
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`${res.status} ${url}`);
      return res.json();
    },
  };
}
