#!/usr/bin/env node
/**
 * The stations' routine hourly METARs with their precipitation group (p01i, inches in the last hour; 0.0001 is a trace) and present
 * weather, from the Iowa Environmental Mesonet's archive, into data/metar/<ICAO>.csv. The one-minute archive's precipitation column
 * is empty on most rain days (KLAX 2026-10-11, 0.12 in the report, all zero), so the day's gauge total is built from these.
 *   node scripts/fetch-metar-history.mjs --stations KLAX,KNYC --from 2026-01-01 --to 2026-10-19
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { stations: { type: 'string' }, from: { type: 'string', default: '2026-01-01' }, to: { type: 'string', default: '2026-10-19' } } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'metar');
await mkdir(root, { recursive: true });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const [y1, m1, d1] = values.from.split('-').map(Number), [y2, m2, d2] = values.to.split('-').map(Number);
for (const station of (values.stations ?? '').split(',').filter(Boolean)) {
  const file = join(root, `${station}.csv`);
  if (await access(file).then(() => true, () => false)) continue;
  const iata = station.startsWith('K') ? station.slice(1) : station;
  const url = `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${iata}&data=tmpf&data=p01i&data=wxcodes&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}&tz=UTC&format=onlycomma&latlon=no&elev=no&missing=M&trace=0.0001&direct=no&report_type=3&report_type=4`;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) { await writeFile(file, await response.text()); break; }
    if (attempt >= 5) throw new Error(`${station}: ${response?.status ?? 'network'}`);
    await pause(3000 * 2 ** attempt);
  }
  process.stdout.write(`${station}\n`);
  await pause(1500);
}
