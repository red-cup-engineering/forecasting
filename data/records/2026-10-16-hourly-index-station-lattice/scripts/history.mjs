/**
 * The record's history, as the model and the market saw it: each city's minutes with every member's record and when
 * Kalshi received it, the city's published calibrations, and NOAA's LAMP station guidance from the IEM archive.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { celsiusOf } from '../../../../src/weather-index-lattice.mjs';
import { lampTemperatureChange } from '../../../../src/lamp-station-guidance.mjs';
import { INDEX_CITIES } from '../../../../src/weather-index.mjs';

const data = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const MIN = 60_000;

/** The city's local hour at an instant (every index city keeps whole-hour UTC offsets, so per UTC hour). */
export function localHourOf(city) {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: INDEX_CITIES[city].timeZone, hour: 'numeric', hourCycle: 'h23' }), cache = new Map();
  return (t) => { const key = Math.floor(t / 3_600_000); let h = cache.get(key); if (h === undefined) { h = Number(format.format(new Date(key * 3_600_000))); cache.set(key, h); } return h; };
}

export const loadCalibrations = async (city) => JSON.parse(await readFile(join(data, 'calibrations', `${city}.json`), 'utf8')).calibrations;

/** Every minute: its published value and status, and each member's record (C on its resolution when accepted). */
export async function loadMinutes(city) {
  const dir = join(data, 'index', city), minutes = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith('.json')).sort()) {
    const day = JSON.parse(await readFile(join(dir, name), 'utf8'));
    for (const point of day.timeseries ?? []) {
      const records = (point.stations ?? []).map((s) => ({
        id: s.station_id, code: s.code === 'ok' && Number.isFinite(s.temp_f) ? 'ok' : (s.code ?? 'missing'), source: s.source ?? null,
        celsius: s.code === 'ok' && Number.isFinite(s.temp_f) ? celsiusOf(s.temp_f, s.source) : null,
        // When the record could be known: a one-minute reading when Kalshi received it (never before its minute
        // ended); a METAR fallback only once the minute became official without its one-minute reading (its
        // received_at_ms is the METAR's own receipt, up to an hour earlier); anything else when official.
        received: s.code === 'ok' && s.source !== 'metar' && Number.isFinite(s.received_at_ms) ? Math.max(s.received_at_ms, point.t + MIN) : point.t + 300_000,
      }));
      if (records.length) minutes.push({ t: point.t, v: point.v ?? null, status: point.status, records });
    }
  }
  return minutes.sort((a, b) => a.t - b.t);
}

/** LAMP bulletins from the IEM archive (its runtime label is the bulletin's HH00; NOAA's bulletin is HH30). */
export async function loadGuidance() {
  const bulletins = new Map();
  for (const name of (await readdir(join(data, 'lamp'))).filter((n) => n.endsWith('.csv'))) {
    const [header, ...rows] = (await readFile(join(data, 'lamp', name), 'utf8')).trim().split('\n');
    const col = Object.fromEntries(header.split(',').map((c, i) => [c, i]));
    for (const row of rows) {
      const f = row.split(','), tmp = Number(f[col.tmp]);
      if (!Number.isFinite(tmp) || f[col.tmp] === '') continue;
      const runtime = new Date(Date.parse(f[col.runtime].replace(' ', 'T') + 'Z') + 30 * MIN).toISOString(), station = f[col.station];
      let b = bulletins.get(runtime); if (!b) bulletins.set(runtime, (b = { runtime, stations: {} }));
      (b.stations[station] ??= { rows: [] }).rows.push({ validTime: f[col.ftime].replace(' ', 'T') + 'Z', temperatureF: tmp });
    }
  }
  return lampTemperatureChange([...bulletins.values()]);
}

