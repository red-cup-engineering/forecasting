#!/usr/bin/env node
/**
 * Fit and score the station-lattice index model (src/weather-index-lattice.mjs) on Kalshi's own per-station history.
 *
 * 1. Drift. For each choice of the predictors' own settings (trend window, climatology half-life), the expected
 *    change of a station's reading over each horizon is regressed by least squares on [trend x h, climatology over h,
 *    LAMP forecast change] over the fit window; the settings with the least unexplained variance, summed over the
 *    horizons as a fraction of each horizon's variance, are kept with their coefficients.
 * 2. Noise. With that drift, the variances (common, station, drift error, reading noise for whole-degree and METAR
 *    readings) are chosen by coordinate descent on the mean log likelihood of the published index at each horizon.
 * 3. Out of sample. The tracker runs on through the test window, adapting its climatology as it would live, and
 *    reports the log likelihood of the published index and the Brier score of the strikes Kalshi lists around it.
 *
 *   node scripts/fit-lattice.mjs --city nyc --fit 2026-09-01:2026-09-30 --test 2026-10-01:2026-10-16
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createIndexTracker, createDriftPredictors } from '../../../../src/weather-index-lattice.mjs';
import { loadMinutes, loadGuidance, loadCalibrations, localHourOf } from './history.mjs';

const { values } = parseArgs({ options: {
  city: { type: 'string' }, fit: { type: 'string' }, test: { type: 'string' }, every: { type: 'string', default: '30' },
  horizons: { type: 'string', default: '2,5,10,20,30,45,60' }, passes: { type: 'string', default: '2' },
} });
const here = dirname(fileURLToPath(import.meta.url));
const MIN = 60_000, horizons = values.horizons.split(',').map(Number), every = Number(values.every);
const localHour = localHourOf(values.city);
const window = (spec) => spec.split(':').map((d, i) => Date.parse(`${d}T00:00:00Z`) + (i ? 86_400_000 : 0));

/** Mean one-minute change of a station's whole-degree reading by local hour over a window: the climatology prior. */
function climatology(minutes, [from, to]) {
  const sum = new Array(24).fill(0), n = new Array(24).fill(0), last = new Map();
  for (const m of minutes) {
    for (const r of m.records) {
      const prev = last.get(r.id);
      if (r.code === 'ok' && r.source !== 'metar' && prev && prev.t === m.t - MIN && m.t >= from && m.t < to) { sum[localHour(m.t)] += r.celsius - prev.c; n[localHour(m.t)] += 1; }
      last.set(r.id, r.code === 'ok' && r.source !== 'metar' ? { t: m.t, c: r.celsius } : null);
    }
  }
  return sum.map((s, h) => (n[h] ? s / n[h] : 0));
}

/** Least squares of reading change on the drift predictors, per horizon. */
function regressDrift(minutes, settings, [from, to], climate, guidance) {
  const predictors = createDriftPredictors({ climate, localHour, guidance, ...settings });
  const byT = new Map(minutes.map((m) => [m.t, m]));
  const normal = horizons.map(() => ({ xx: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], xy: [0, 0, 0], yy: 0, y: 0, n: 0 }));
  for (const m of minutes) {
    if (m.t > to) break;
    const members = m.records.length;
    for (const r of m.records) if (r.code === 'ok') predictors.reading(r.id.slice(0, 4), m.t, r.celsius, members);
    if (m.t < from || (m.t / MIN) % every !== 0) continue;
    horizons.forEach((h, k) => {
      const later = byT.get(m.t + h * MIN); if (!later) return;
      for (const r of m.records) {
        const after = later.records.find((x) => x.id === r.id);
        if (r.code !== 'ok' || after?.code !== 'ok' || r.source !== after.source) continue;
        const x = predictors.features(r.id.slice(0, 4), m.t, h), y = after.celsius - r.celsius, e = normal[k];
        for (let i = 0; i < 3; i += 1) { e.xy[i] += x[i] * y; for (let j = 0; j < 3; j += 1) e.xx[i][j] += x[i] * x[j]; }
        e.yy += y * y; e.y += y; e.n += 1;
      }
    });
  }
  const coefficients = normal.map(solve3), unexplained = normal.map((e, k) => {
    const b = coefficients[k], sse = e.yy - 2 * dot(b, e.xy) + dot(b, e.xx.map((row) => dot(row, b)));
    return sse / Math.max(1e-12, e.yy - (e.y * e.y) / e.n);
  });
  return { horizons, coefficients, unexplained, n: normal.map((e) => e.n) };
}
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
/** Solve the 3x3 normal equations (ridge 1e-9 on a singular predictor such as absent guidance). */
function solve3({ xx, xy }) {
  const a = xx.map((row, i) => [...row.map((v, j) => v + (i === j ? 1e-9 * (1 + xx[i][i]) : 0)), xy[i]]);
  for (let c = 0; c < 3; c += 1) {
    let p = c; for (let r = c + 1; r < 3; r += 1) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    for (let r = 0; r < 3; r += 1) if (r !== c) { const f = a[r][c] / a[c][c]; for (let k = c; k < 4; k += 1) a[r][k] -= f * a[c][k]; }
  }
  return a.map((row, i) => row[3] / row[i]);
}

/** Score the tracker: log likelihood of the published index and Brier of the K.99 strikes around it, by horizon. */
function run(minutes, params, [from, to], climate, guidance, calibrations) {
  const tracker = createIndexTracker({ params, climate, localHour, calibrations, guidance });
  const pending = new Map(), scores = Object.fromEntries(horizons.map((h) => [h, { n: 0, logLik: 0, brier: 0, brierN: 0 }]));
  const first = Math.max(0, minutes.findIndex((m) => m.t >= from - 86_400_000)), last = to + Math.max(...horizons) * MIN;
  for (let i = first; i < minutes.length && minutes[i].t <= last; i += 1) {
    const m = minutes[i];
    for (const r of m.records) tracker.observe(r.id, m.t, r);
    const due = pending.get(m.t);
    if (due && m.v !== null) {
      pending.delete(m.t);
      for (const { h, distribution } of due) {
        const row = scores[h];
        let p = 0; for (const d of distribution) if (Math.abs(d.value - m.v) < 0.005) p += d.p;
        row.n += 1; row.logLik += Math.log(Math.max(p, 1e-9));
        for (let k = Math.floor(m.v) - 3; k <= Math.floor(m.v) + 3; k += 1) {
          const strike = k + 0.99; let pYes = 0;
          for (const d of distribution) if (d.value > strike) pYes += d.p;
          row.brier += (pYes - (m.v > strike ? 1 : 0)) ** 2; row.brierN += 1;
        }
      }
    }
    if (m.t >= from && m.t < to && (m.t / MIN) % every === 0) {
      for (const h of horizons) {
        const distribution = tracker.distribution(m.t + h * MIN);
        if (!distribution) continue;
        const target = m.t + h * MIN; if (!pending.has(target)) pending.set(target, []); pending.get(target).push({ h, distribution });
      }
    }
  }
  return Object.fromEntries(Object.entries(scores).map(([h, r]) => [h, { n: r.n, meanLogLik: r.logLik / r.n, brier: r.brier / r.brierN }]));
}

const minutes = await loadMinutes(values.city), fit = window(values.fit), test = window(values.test);
const guidance = await loadGuidance();
const calibrations = await loadCalibrations(values.city);
const climate = climatology(minutes, fit);

let drift = null;
for (const trendMinutes of [15, 30, 60, 120]) for (const climateHalfLifeDays of [2, 5, 10, 20]) {
  const fitted = regressDrift(minutes, { trendMinutes, climateHalfLifeDays }, fit, climate, guidance);
  const loss = fitted.unexplained.reduce((s, u) => s + u, 0);
  process.stdout.write(`drift trend ${trendMinutes} half-life ${climateHalfLifeDays}: unexplained ${fitted.unexplained.map((u) => u.toFixed(3)).join(' ')}\n`);
  if (!drift || loss < drift.loss) drift = { trendMinutes, climateHalfLifeDays, fitted, loss };
}
process.stdout.write(`drift chosen: trend ${drift.trendMinutes} half-life ${drift.climateHalfLifeDays}; coefficients [trend, climatology, LAMP] by horizon ${JSON.stringify(Object.fromEntries(horizons.map((h, k) => [h, drift.fitted.coefficients[k].map((c) => +c.toFixed(3))])))}\n`);

const objective = (scores) => horizons.reduce((s, h) => s + scores[h].meanLogLik, 0) / horizons.length;
const fixed = { trendMinutes: drift.trendMinutes, climateHalfLifeDays: drift.climateHalfLifeDays, drift: { horizons, coefficients: drift.fitted.coefficients } };
const space = { sigmaCommon: [0.02, 0.03, 0.05, 0.08], sigmaStation: [0.02, 0.04, 0.06, 0.09], sigmaDrift: [0, 0.002, 0.005, 0.01], tau: [0.03, 0.05, 0.08, 0.15], tauMetar: [0.1, 0.3, 0.6] };
let best = { params: { sigmaCommon: 0.03, sigmaStation: 0.06, sigmaDrift: 0.005, tau: 0.05, tauMetar: 0.3, ...fixed } };
best.value = objective(run(minutes, best.params, fit, climate, guidance, calibrations));
for (let pass = 0; pass < Number(values.passes); pass += 1) {
  let moved = false;
  for (const [name, choices] of Object.entries(space)) {
    for (const choice of choices) {
      if (choice === best.params[name]) continue;
      const params = { ...best.params, [name]: choice }, value = objective(run(minutes, params, fit, climate, guidance, calibrations));
      process.stdout.write(`${name} ${choice} fit ${value.toFixed(4)}\n`);
      if (value > best.value) { best = { params, value }; moved = true; }
    }
  }
  if (!moved) break;
}
const outOfSample = run(minutes, best.params, test, climate, guidance, calibrations);
const report = { city: values.city, fit: values.fit, test: values.test, every, params: best.params, fitObjective: best.value,
  driftUnexplainedFraction: Object.fromEntries(horizons.map((h, k) => [h, drift.fitted.unexplained[k]])), climateDriftCPerMinuteByLocalHour: climate, outOfSample };
await mkdir(join(here, '..', 'results'), { recursive: true });
await writeFile(join(here, '..', 'results', `lattice-${values.city}.json`), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(`${JSON.stringify(report.params)}\n${JSON.stringify(report.outOfSample)}\n`);
