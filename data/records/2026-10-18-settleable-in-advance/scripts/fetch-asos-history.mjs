#!/usr/bin/env node
/**
 * The settlement source's history against the observations that precede it: for each station, the NWS Daily Climate Report values the
 * Weather Company settles on (high, low, precipitation of every climate day, from the Iowa Environmental Mesonet's parsed CLI
 * archive) and the station's one-minute ASOS temperature and precipitation by month, so the discrepancy between the report and
 * what the observations showed can be measured over hundreds of station-days instead of the few weeks the markets have existed.
 *   node scripts/fetch-asos-history.mjs --stations KLAX,KMIA --from 2026-01-01 --to 2026-10-01
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { stations: { type: 'string' }, from: { type: 'string', default: '2026-01-01' }, to: { type: 'string', default: '2026-10-01' } } });
const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (path) => access(path).then(() => true, () => false);
async function get(url, json) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url).catch(() => null);
    if (response?.ok) return json ? response.json() : response.text();
    if (attempt >= 6) throw new Error(`${url}: ${response?.status ?? 'network'}`);
    await pause(3000 * 2 ** attempt);
  }
}
await mkdir(join(root, 'cli'), { recursive: true });
await mkdir(join(root, 'asos-history'), { recursive: true });
const from = new Date(`${values.from}T00:00:00Z`), to = new Date(`${values.to}T00:00:00Z`);
for (const station of (values.stations ?? '').split(',').filter(Boolean)) {
  const cli = join(root, 'cli', `${station}.json`);
  if (!(await exists(cli))) {
    const years = [...new Set([from.getUTCFullYear(), to.getUTCFullYear()])], results = [];
    for (let y = years[0]; y <= years.at(-1); y += 1) results.push(...((await get(`https://mesonet.agron.iastate.edu/json/cli.py?station=${station}&year=${y}`, true)).results ?? []));
    await writeFile(cli, JSON.stringify(results.map((r) => ({ valid: r.valid, high: r.high, low: r.low, precip: r.precip, product: r.product }))));
    await pause(1000);
  }
  const iata = station.startsWith('K') ? station.slice(1) : station;
  for (let m = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); m < to; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    const file = join(root, 'asos-history', `${station}-${m.toISOString().slice(0, 7)}.csv`);
    if (await exists(file)) continue;
    const end = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
    const text = await get(`https://mesonet.agron.iastate.edu/cgi-bin/request/asos1min.py?station=${iata}&vars=tmpf&vars=precip&sts=${m.toISOString().slice(0, 16)}Z&ets=${end.toISOString().slice(0, 16)}Z&sample=1min&what=download&tz=UTC`, false);
    await writeFile(file, text);
    await pause(1500);
  }
  process.stdout.write(`${station} done\n`);
}
