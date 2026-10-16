#!/usr/bin/env node
/**
 * Fetch NOAA's archived LAMP station guidance (model LAV: hourly runs, hourly temperature in whole F out to 25 h)
 * for every member station of the index cities, from the Iowa Environmental Mesonet MOS archive, into
 * data/lamp/<ICAO>.csv. The members are read from the index history already fetched (data/index/<city>/*.json).
 *   node scripts/fetch-lamp-history.mjs --from 2026-08-31 --to 2026-10-17
 */
import { mkdir, writeFile, readdir, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { from: { type: 'string' }, to: { type: 'string' }, cities: { type: 'string', default: 'nyc,miami,chicago,la-coastal' } } });
const data = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stations = new Set();
for (const city of values.cities.split(',')) {
  const [first] = (await readdir(join(data, 'index', city))).filter((n) => n.endsWith('.json')).sort().slice(-1);
  for (const point of JSON.parse(await readFile(join(data, 'index', city, first), 'utf8')).timeseries) for (const s of point.stations ?? []) stations.add(s.station_id.slice(0, 4));
}
await mkdir(join(data, 'lamp'), { recursive: true });
for (const station of [...stations].sort()) {
  const file = join(data, 'lamp', `${station}.csv`);
  if (await access(file).then(() => true, () => false)) continue;
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/mos.py?station=${station}&model=LAV&sts=${values.from}T00:00Z&ets=${values.to}T00:00Z&format=csv`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url);
    const text = response.ok ? await response.text() : '';
    if (text.startsWith('runtime,')) { await writeFile(file, text); process.stdout.write(`${station} ${text.split('\n').length - 2} rows\n`); break; }
    if (attempt >= 5) throw new Error(`${station}: ${response.status} ${text.slice(0, 120)}`);
    await pause(5000 * 2 ** attempt);
  }
  await pause(2000);
}
