// Last 12h of public tape for the collector's universe (gives each book snapshot a trailing-6h taker-volume covariate).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient, sleep, tradesFor, slimTrade, dataDir } from './lib.mjs';
const c = makeClient();
const st = JSON.parse(readFileSync(join(dataDir, 'collect-state.json'), 'utf8'));
const minTs = Math.floor(Date.now() / 1000) - 12 * 3600;
const rows = [];
for (const u of st.universe) { rows.push(...(await tradesFor(c, u.tk, { minTs, maxPages: 5 })).map(slimTrade)); await sleep(120); }
writeFileSync(join(dataDir, 'tape-universe.ndjson'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(st.universe.length, 'tickers', rows.length, 'trades');
