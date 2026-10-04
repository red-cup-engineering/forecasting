// Public tape for every ticker the desk has rested an order on, from the desk's first order on (for the replay in validate.py).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient, sleep, tradesFor, slimTrade, dataDir } from './lib.mjs';
const c = makeClient();
const orders = JSON.parse(readFileSync(join(dataDir, 'desk-orders.json'), 'utf8'));
const minTs = Math.floor(Math.min(...orders.map((o) => Date.parse(o.created_time))) / 1000) - 8 * 3600;
const tickers = [...new Set(orders.map((o) => o.ticker))];
const rows = [];
for (const tk of tickers) { rows.push(...(await tradesFor(c, tk, { minTs })).map(slimTrade)); await sleep(150); }
writeFileSync(join(dataDir, 'tape-desk.ndjson'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(tickers.length, 'tickers', rows.length, 'trades');
