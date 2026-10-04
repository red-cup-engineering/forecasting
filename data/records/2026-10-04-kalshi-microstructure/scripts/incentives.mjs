// All active liquidity-incentive programs (public GET /incentive_programs), paged. Writes data/incentives-<ts>.json.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient, sleep, dataDir } from './lib.mjs';
const c = makeClient();
const all = [];
let cursor;
for (let i = 0; i < 60; i += 1) {
  const p = await c.call('GET', '/incentive_programs', { query: { status: 'active', limit: 200, cursor }, signed: false });
  all.push(...(p.incentive_programs ?? []));
  cursor = p.next_cursor;
  if (!cursor || !(p.incentive_programs ?? []).length) break;
  await sleep(150);
}
const stamp = new Date().toISOString().slice(0, 13).replace(/[-:T]/g, '');
writeFileSync(join(dataDir, `incentives-${stamp}.json`), JSON.stringify(all));
const by = {};
for (const p of all) { const s = p.market_ticker.split('-')[0]; by[s] = (by[s] ?? 0) + 1; }
console.log(all.length, 'programs;', Object.keys(by).length, 'series');
console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([s, n]) => `${s}:${n}`).join(' '));
