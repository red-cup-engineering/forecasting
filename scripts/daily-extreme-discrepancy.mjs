#!/usr/bin/env node
/** Derive how far a station's Daily Climate Report can sit from the day's observations.
 *
 * Usage: node daily-extreme-discrepancy.mjs <dataDir> <firstDay YYYY-MM-DD> <lastDay YYYY-MM-DD, exclusive> [out.json]
 *
 * <dataDir> holds, per station of the temperature and rain series, `asos/` and `asos-history/` (the one-minute ASOS archive),
 * `metar/` (routine METARs with the precipitation group) and `cli/` (the report values of every climate day), as fetched by the
 * 2026-10-18 settleable-in-advance record's scripts. Each station-day contributes the report's high and low against the day's
 * confirmed observed extreme (two consecutive five-minute readings), and the report's precipitation against the gauge's total.
 * The output is the table weather-extreme-discrepancy.mjs bounds a claim with.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadStation, buildDailyModels } from '../src/weather-daily-observations.mjs';

const [dataDir, first, last, out] = process.argv.slice(2);
if (!dataDir || !first || !last) throw new Error('usage: daily-extreme-discrepancy.mjs <dataDir> <firstDay> <lastDay> [out.json]');
const here = new URL('..', import.meta.url);
const temperature = JSON.parse(readFileSync(new URL('content/config/temperature-markets.json', here), 'utf8')).series;
const rain = JSON.parse(readFileSync(new URL('content/config/rain-markets.json', here), 'utf8')).cities;
const stations = {};
for (const s of temperature) stations[s.station] = { tz: s.timeZone };
for (const c of Object.values(rain)) stations[c.station] = { tz: c.zone };
const rows = {}, cli = {};
for (const station of Object.keys(stations)) {
  rows[station] = loadStation(dataDir, station);
  const file = join(dataDir, 'cli', `${station}.json`);
  cli[station] = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}
const models = buildDailyModels({ stations, cli, rows, from: first, to: last });
const digest = (path) => (existsSync(path) ? `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}` : null);
const sources = Object.keys(stations).map((station) => ({ station, minuteRows: rows[station].t.length, metarReports: rows[station].metar.length, cliSha256: digest(join(dataDir, 'cli', `${station}.json`)), metarSha256: digest(join(dataDir, 'metar', `${station}.csv`)) }));
const config = { kind: 'daily-extreme-discrepancy', version: 1, window: { firstDay: first, lastDayExclusive: last }, derivedAt: new Date().toISOString(), stations: Object.keys(stations).length, sources, ...models };
const text = `${JSON.stringify(config)}\n`;
if (out) writeFileSync(out, text); else process.stdout.write(text);
