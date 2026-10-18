#!/usr/bin/env node
/** Derive, for each Kalshi city temperature index, how likely it is to move a given distance over a given horizon.
 *
 * Usage: node hourly-index-move-tail.mjs <indexDir> <firstDay YYYY-MM-DD> <lastDay YYYY-MM-DD> [out.json] [--resamples N]
 *
 * Source: Kalshi's published minute index per city and UTC day, as fetched by the lattice record's fetch-index-history.mjs
 * (`<indexDir>/<city>/<date>.json`, `live_data/weather/<city>?detailed=true`). Every minute with a published value is used,
 * whatever its status (a degraded minute is published and settles contracts like any other).
 *
 * The method is weather-index-move-tail.mjs's (empirical survival below a square-root-rule threshold, generalized Pareto above,
 * moving-block bootstrap for the upper confidence bound), per city, direction, horizon and volatility regime; every parameter and its
 * provenance is recorded in the output (`method.parameters`), and the block length, regime count and cuts are derived from the minutes read. The table replaces
 * weather-index-rate-envelope.json's "largest move ever seen times 1.5" with a probability that can be priced.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { INDEX_CITIES } from '../src/weather-index.mjs';
import { fitMoveTable, PARAMETERS } from '../src/weather-index-move-tail.mjs';

const DAY = 86_400_000;

/** One city's published minutes in [start, end) as a Map of epoch ms to value, and the files they came from. */
export function cityMinutes(indexDir, city, start, end) {
  const minutes = new Map(), sources = [];
  for (const name of readdirSync(join(indexDir, city)).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/u.test(n)).sort()) {
    const day = Date.parse(`${name.slice(0, 10)}T00:00:00Z`);
    if (day < start || day >= end) continue;
    const bytes = readFileSync(join(indexDir, city, name)), body = JSON.parse(bytes);
    if (body.city !== city || !Array.isArray(body.timeseries)) throw new TypeError(`original Kalshi city index response required: ${name}`);
    sources.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, configVersion: body.config_version });
    for (const row of body.timeseries) if (Number.isSafeInteger(row.t) && row.t % 60_000 === 0 && Number.isFinite(row.v) && row.t >= day && row.t < day + DAY) minutes.set(row.t, row.v);
  }
  return { minutes, sources };
}

if (import.meta.main) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const resamples = Number(process.argv.includes('--resamples') ? process.argv[process.argv.indexOf('--resamples') + 1] : 200);
  const [indexDir, firstDay, lastDay, out] = args;
  if (!indexDir || !firstDay || !lastDay) throw new Error('usage: hourly-index-move-tail.mjs <indexDir> <firstDay> <lastDay> [out.json] [--resamples N]');
  const start = Date.parse(`${firstDay}T00:00:00Z`), end = Date.parse(`${lastDay}T00:00:00Z`) + DAY;
  const cities = {};
  for (const city of Object.keys(INDEX_CITIES)) {
    const { minutes, sources } = cityMinutes(indexDir, city, start, end);
    cities[city] = { minutes: minutes.size, sources, ...fitMoveTable(minutes, { resamples, seed: 1 }) };
    console.error(`${city}: ${minutes.size} minutes`);
  }
  const config = { kind: 'index-move-tail', version: 1, window: { firstDay, lastDay }, derivedAt: new Date().toISOString(), method: { parameters: PARAMETERS, resamples }, cities };
  const text = `${JSON.stringify(config)}\n`;
  if (out) writeFileSync(out, text); else process.stdout.write(text);
}
