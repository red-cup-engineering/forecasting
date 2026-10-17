#!/usr/bin/env node
/**
 * Where the fitted lattice is wrong out of sample: its bias and its dispersion, by horizon and local hour, on every
 * minute (not only the minutes someone traded, which selects for disagreement).
 *
 * For each forecast of the published index h minutes ahead: the error of its mean (mean − realized, °F), its
 * standard deviation against the realized absolute error (dispersion: rms error / predictive sd, 1 when calibrated,
 * above 1 when overconfident), and the randomized probability integral transform of the realized value (uniform when
 * calibrated; piled at the ends when overconfident, leaning when biased).
 *
 *   node scripts/diagnose-lattice.mjs --city nyc --test 2026-10-01:2026-10-16
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createIndexTracker } from '../../../../src/weather-index-lattice.mjs';
import { loadMinutes, loadGuidance, loadCalibrations, localHourOf } from './history.mjs';

const { values } = parseArgs({ options: { city: { type: 'string' }, test: { type: 'string' }, every: { type: 'string', default: '10' }, horizons: { type: 'string', default: '5,10,20,30,45,60' } } });
const here = dirname(fileURLToPath(import.meta.url)), MIN = 60_000, horizons = values.horizons.split(',').map(Number), every = Number(values.every);
const localHour = localHourOf(values.city);
const [from, to] = values.test.split(':').map((d, i) => Date.parse(`${d}T00:00:00Z`) + (i ? 86_400_000 : 0));
const fitted = JSON.parse(await readFile(join(here, '..', 'results', `lattice-${values.city}.json`), 'utf8'));
const minutes = await loadMinutes(values.city), guidance = await loadGuidance(), calibrations = await loadCalibrations(values.city);
const tracker = createIndexTracker({ params: fitted.params, climate: fitted.climateDriftCPerMinuteByLocalHour, climateVariance: fitted.climateVarianceC2PerMinuteByLocalHour, localHour, calibrations, guidance });

let seed = 1; const uniform = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const cell = () => ({ n: 0, error: 0, squared: 0, variance: 0, pit: new Array(10).fill(0) });
const byHorizon = Object.fromEntries(horizons.map((h) => [h, cell()])), byHour = Object.fromEntries(horizons.map((h) => [h, Array.from({ length: 24 }, cell)]));
const pending = new Map();
const first = Math.max(0, minutes.findIndex((m) => m.t >= from - 86_400_000)), last = to + Math.max(...horizons) * MIN;
for (let i = first; i < minutes.length && minutes[i].t <= last; i += 1) {
  const m = minutes[i];
  for (const r of m.records) tracker.observe(r.id, m.t, r);
  const due = pending.get(m.t);
  if (due && m.v !== null) {
    pending.delete(m.t);
    for (const { h, hour, distribution } of due) {
      let mean = 0, second = 0, below = 0, at = 0;
      for (const d of distribution) { mean += d.p * d.value; second += d.p * d.value * d.value; if (d.value < m.v - 0.005) below += d.p; else if (Math.abs(d.value - m.v) < 0.005) at += d.p; }
      const pit = Math.min(0.999999, below + uniform() * at), error = mean - m.v, variance = Math.max(0, second - mean * mean);
      for (const c of [byHorizon[h], byHour[h][hour]]) { c.n += 1; c.error += error; c.squared += error * error; c.variance += variance; c.pit[Math.floor(pit * 10)] += 1; }
    }
  }
  if (m.t >= from && m.t < to && (m.t / MIN) % every === 0) for (const h of horizons) {
    const distribution = tracker.distribution(m.t + h * MIN);
    if (!distribution) continue;
    const target = m.t + h * MIN; if (!pending.has(target)) pending.set(target, []);
    pending.get(target).push({ h, hour: localHour(target), distribution });
  }
}
const summary = (c) => (c.n ? { n: c.n, biasF: c.error / c.n, rmsErrorF: Math.sqrt(c.squared / c.n), predictiveSdF: Math.sqrt(c.variance / c.n), dispersion: Math.sqrt(c.squared / Math.max(1e-12, c.variance)), pit: c.pit.map((x) => +(x / c.n).toFixed(3)) } : { n: 0 });
const report = { city: values.city, test: values.test, every, byHorizon: Object.fromEntries(horizons.map((h) => [h, summary(byHorizon[h])])),
  byLocalHour: Object.fromEntries(horizons.map((h) => [h, byHour[h].map((c, hour) => ({ hour, ...summary(c) })).filter((r) => r.n)])) };
await writeFile(join(here, '..', 'results', `diagnose-${values.city}.json`), JSON.stringify(report, null, 1) + '\n');
for (const h of horizons) { const s = report.byHorizon[h]; process.stdout.write(`${values.city} h=${h}: n ${s.n} bias ${s.biasF?.toFixed(3)} F rms ${s.rmsErrorF?.toFixed(3)} sd ${s.predictiveSdF?.toFixed(3)} dispersion ${s.dispersion?.toFixed(2)} pit ${s.pit?.join(' ')}\n`); }
