#!/usr/bin/env node
/**
 * Fetch Kalshi's per-minute city index with every member station's reading (detailed=true), one UTC day per
 * request, into data/index/<city>/<date>.json, and each city's published calibrations (the offsets and reference
 * of every configuration version) into data/calibrations/<city>.json. Public endpoints; paced well under the read
 * budget.
 *   node scripts/fetch-index-history.mjs --from 2026-09-01 --to 2026-10-16 [--cities nyc,miami,chicago,la-coastal]
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, cities: { type: 'string', default: 'nyc,miami,chicago,la-coastal' } } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'index');
const base = 'https://api.elections.kalshi.com/trade-api/v2/live_data/weather';
const day = 86_400_000;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
for (const city of values.cities.split(',')) {
  await mkdir(join(root, city), { recursive: true });
  const calibrations = await fetch(`${base}/${city}/calibrations`, { headers: { accept: 'application/json' } });
  if (!calibrations.ok) throw new Error(`${city} calibrations: ${calibrations.status}`);
  await mkdir(join(root, '..', 'calibrations'), { recursive: true });
  await writeFile(join(root, '..', 'calibrations', `${city}.json`), await calibrations.text());
  for (let t = Date.parse(`${values.from}T00:00:00Z`); t <= Date.parse(`${values.to}T00:00:00Z`); t += day) {
    const date = new Date(t).toISOString().slice(0, 10), file = join(root, city, `${date}.json`);
    if (await access(file).then(() => true, () => false)) continue;
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${base}/${city}?from=${t}&to=${t + day - 1}&detailed=true`, { headers: { accept: 'application/json' } });
      if (response.ok) { await writeFile(file, await response.text()); break; }
      if (attempt >= 5) throw new Error(`${city} ${date}: ${response.status}`);
      await pause(1000 * 2 ** attempt);
    }
    process.stdout.write(`${city} ${date}\n`);
    await pause(250);
  }
}
