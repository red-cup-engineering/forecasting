// The desk's own resting history, read-only: every order and fill the account has (signed GETs).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient, dataDir } from './lib.mjs';
const c = makeClient();
const orders = await c.getOrders({});
const fills = await c.getFills({});
writeFileSync(join(dataDir, 'desk-orders.json'), JSON.stringify(orders));
writeFileSync(join(dataDir, 'desk-fills.json'), JSON.stringify(fills));
console.log('orders', orders.length, 'fills', fills.length);
