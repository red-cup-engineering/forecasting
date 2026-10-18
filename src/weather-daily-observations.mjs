/**
 * A station's observations as the daily climate contracts see them, and the tables that bound what the day's report can differ from them.
 *
 *   loadStation        the one-minute ASOS temperature (whole F) from the Iowa Environmental Mesonet's archive, and the routine METARs'
 *                      precipitation group, as typed columns
 *   dayStreams         a climate day's five-minute temperatures, its confirmed high and low, and the gauge's running total
 *   buildDailyModels   the discrepancy of the report's high and low against the confirmed observations, and the cross-tabulation of the
 *                      gauge's total against a report of no rain, over a window of station-days (weather-extreme-discrepancy.mjs)
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { discrepancyTable } from './weather-extreme-discrepancy.mjs';
import { climateDayStart } from './station-observations.mjs';
import { parameter } from './weather-determination-parameters.mjs';

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

export const PARAMETERS = Object.freeze({
  observationCadenceMinutes: parameter(5, 'measured', 'api.weather.gov listed each station\'s observations at five-minute multiples (KLAX 17:40, 17:45, 17:55, 18:00, 18:10, ...); 54 observations of ten stations polled once a minute, 2026-10-18', { dataset: 'evidence/nws-polls.jsonl', derivation: 'scripts/poll-nws.mjs' }),
  confirmationReadings: parameter(2, 'measured', 'a value counts once this many consecutive readings reached it. Over 2,810 station-days (2026-01-01..09-30, 24 stations) the observed high exceeded the report by two degrees or more on 10 days with one reading and on none with two; the observed low fell short by two or more on 9 days and then 5', { dataset: 'asos-history + cli', derivation: 'scripts/an9 (recorded in the settleable-in-advance record)' }),
  gaugeResolutionInches: parameter(0.01, 'contract', 'the precipitation gauge and the climate report resolve to a hundredth of an inch; "strictly greater than 0" means at least 0.01 (market rules_primary, KXRAIN)'),
  traceInches: parameter(0.0001, 'contract', 'IEM encodes a METAR trace of precipitation as 0.0001 (asos.py trace= parameter); the report counts trace as 0 (market rules_secondary)'),
  coveredHours: parameter(24, 'contract', 'a climate day has twenty-four hours; a station-day is used only when every hour has an observation'),
});

/**
 * A station's one-minute rows (IEM CSV) from every file that holds them, ascending and de-duplicated, as typed columns:
 * `t` (ms) and `tmp` (whole F, NaN where missing); and the routine METARs' precipitation group `metar` [{t, p}] (inches in the last
 * hour, null where the report has none).
 */
export function loadStation(dataDir, station) {
  const files = [join(dataDir, 'asos', `${station}.csv`)];
  const history = join(dataDir, 'asos-history');
  if (existsSync(history)) for (const name of readdirSync(history).filter((n) => n.startsWith(`${station}-`)).sort()) files.push(join(history, name));
  const t = [], tmp = [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    for (let i = 1; i < lines.length; i += 1) {
      const [, , stamp, temperature] = lines[i].split(',');
      const time = Date.parse(`${(stamp ?? '').replace(' ', 'T')}:00Z`);
      if (!Number.isFinite(time)) continue;
      t.push(time); tmp.push(temperature === 'M' || temperature === '' ? NaN : Number(temperature));
    }
  }
  const order = Uint32Array.from({ length: t.length }, (_, i) => i).sort((x, y) => t[x] - t[y]);
  const T = new Float64Array(t.length), TMP = new Float32Array(t.length);
  let n = 0;
  for (const i of order) { if (n && T[n - 1] === t[i]) continue; T[n] = t[i]; TMP[n] = tmp[i]; n += 1; }
  const metar = [], mf = join(dataDir, 'metar', `${station}.csv`);
  if (existsSync(mf)) for (const line of readFileSync(mf, 'utf8').split('\n').slice(1)) {
    const [, stamp, , hourly] = line.split(',');
    const time = Date.parse(`${(stamp ?? '').replace(' ', 'T')}:00Z`), amount = hourly === 'M' ? null : Number(hourly);
    if (Number.isFinite(time)) metar.push({ t: time, p: Number.isFinite(amount) ? amount : null });
  }
  metar.sort((a, b) => a.t - b.t);
  return { t: T.subarray(0, n), tmp: TMP.subarray(0, n), metar };
}

const lowerBound = (array, x) => { let lo = 0, hi = array.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (array[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
const hoursCovered = (times, start) => new Set(times.map((t) => Math.floor((t - start) / HOUR))).size;

/**
 * The day's streams from a station's columns: temperatures at the observation cadence; the confirmed high and low (a value counts only once
 * `confirmationReadings` consecutive readings reached it, at the last reading's time: a lone spike in the one-minute archive is a sensor,
 * not the weather the report records); and the gauge's running total at each routine METAR (its precipitation group, inches in the last
 * hour). `complete` says whether every hour of the day has a temperature and a routine report.
 */
export function dayStreams(station, start, end) {
  const cadence = PARAMETERS.observationCadenceMinutes.value * MINUTE, need = PARAMETERS.confirmationReadings.value;
  const temps = [], gauge = [], high = [], low = [];
  if (!station) return { temps, gauge, high, low, complete: false };
  for (let i = lowerBound(station.t, start); i < station.t.length && station.t[i] < end; i += 1) {
    const time = station.t[i];
    if (Number.isNaN(station.tmp[i]) || time % cadence !== 0) continue;
    temps.push({ t: time, v: station.tmp[i] });
    const run = temps.slice(-need);
    if (run.length === need && time - run[0].t === (need - 1) * cadence) {
      high.push({ t: time, v: Math.min(...run.map((x) => x.v)) });
      low.push({ t: time, v: Math.max(...run.map((x) => x.v)) });
    }
  }
  let total = 0;
  for (const r of station.metar) {
    if (r.t <= start || r.t > end) continue;
    if (r.p !== null) total += r.p;
    gauge.push({ t: r.t, v: Math.round(total / PARAMETERS.traceInches.value) * PARAMETERS.traceInches.value });
  }
  const full = PARAMETERS.coveredHours.value;
  return { temps, gauge, high, low, complete: hoursCovered(temps.map((x) => x.t), start) === full && hoursCovered(gauge.map((x) => x.t - 1), start) === full };
}

/**
 * The tables from the history: the discrepancy of the report's high and low against the confirmed observed extreme, and for each running
 * gauge total (every hundredth of an inch up to the largest seen) the station-days whose day total reached it and the number among them
 * for which the report showed no rain.
 */
export function buildDailyModels({ stations, cli, rows, from, to }) {
  const days = [], finals = [];
  for (const [station, { tz }] of Object.entries(stations)) {
    const byDate = new Map((cli[station] ?? []).map((r) => [r.valid, r]));
    for (let t = Date.parse(`${from}T00:00:00Z`); t < Date.parse(`${to}T00:00:00Z`); t += DAY) {
      const date = new Date(t).toISOString().split('T')[0], report = byDate.get(date);
      if (!report) continue;
      const start = climateDayStart(date, tz).getTime(), { gauge, high, low, complete } = dayStreams(rows[station], start, start + DAY);
      if (!complete) continue;
      if (Number.isFinite(report.high) && Number.isFinite(report.low) && high.length && low.length) {
        days.push({ kind: 'high', report: report.high, observed: Math.max(...high.map((x) => x.v)) });
        days.push({ kind: 'low', report: report.low, observed: Math.min(...low.map((x) => x.v)) });
      }
      const precip = report.precip === 'T' ? 0 : Number(report.precip);
      if (gauge.length && Number.isFinite(precip)) finals.push({ final: gauge.at(-1).v, dry: precip === 0 });
    }
  }
  const resolution = PARAMETERS.gaugeResolutionInches.value, top = finals.reduce((m, f) => Math.max(m, f.final), 0);
  const byTotal = {};
  for (let i = 1; i <= Math.round(top / resolution); i += 1) {
    const reached = finals.filter((f) => f.final >= i * resolution - resolution / 2);
    byTotal[(i * resolution).toFixed(2)] = { days: reached.length, dry: reached.filter((f) => f.dry).length };
  }
  return { dayExtremum: discrepancyTable(days), dayPrecip: { byTotal }, stationDays: days.length / 2, gaugeDays: finals.length };
}
