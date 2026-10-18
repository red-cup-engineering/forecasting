import test from 'node:test';
import assert from 'node:assert/strict';
import { fitGpd, inverseSurvival, stratumModel, rng, fitMoveTable, distanceAt, exceedanceUpper, trailingVariation, regimeIndex, chooseRegimes, integratedAutocorrelationTime,
  PARAMETERS, HORIZONS, EPSILONS, MAX_HORIZON_MINUTES } from '../src/weather-index-move-tail.mjs';

const MINUTE = 60_000;
const gaussian = (random) => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
/** A minute series: a random walk with Gaussian steps of standard deviation `sd` (F per minute). */
const walk = (minutes, sd, seed) => {
  const random = rng(seed), series = new Map();
  let v = 70;
  for (let i = 0; i < minutes; i += 1) { series.set(i * MINUTE, Math.round(v * 100) / 100); v += sd * gaussian(random); }
  return series;
};

test('the horizons are every minute the contract allows and the probabilities halve from one half', () => {
  assert.equal(MAX_HORIZON_MINUTES, 65);
  assert.deepEqual(HORIZONS.slice(0, 3), [1, 2, 3]); assert.equal(HORIZONS.at(-1), 65);
  assert.equal(EPSILONS[0], 0.5); assert.equal(EPSILONS[1], 0.25); assert.equal(EPSILONS.length, 20);
  for (const [name, p] of Object.entries(PARAMETERS)) assert.ok(['contract', 'convention', 'derived'].includes(p.kind) && p.provenance.length > 20, `${name} has a kind and a provenance`);
});

test('the generalized Pareto fit recovers a known tail index from excesses', () => {
  const random = rng(7), xi = 0.2, sigma = 1;
  const excesses = Array.from({ length: 4000 }, () => (sigma / xi) * (Math.pow(1 - random(), -xi) - 1)).sort((a, b) => a - b);
  const fit = fitGpd(excesses);
  assert.ok(Math.abs(fit.xi - xi) < 0.06, `xi ${fit.xi}`);
  assert.ok(Math.abs(fit.sigma - sigma) < 0.15, `sigma ${fit.sigma}`);
});

test('the model reproduces the empirical survival inside the sample and extrapolates a larger move to a smaller probability', () => {
  const random = rng(3), sample = Array.from({ length: 5000 }, () => Math.abs(gaussian(random))).sort((a, b) => b - a);
  const model = stratumModel(sample, 5000);
  const d1 = inverseSurvival(model, 0.1), d2 = inverseSurvival(model, 0.001), d3 = inverseSurvival(model, 1e-5);
  assert.ok(d1 < d2 && d2 < d3);
  assert.ok(Math.abs(d1 - 1.645) < 0.1, String(d1)); // |N(0,1)|: P(>= 1.645) = 0.1
  assert.ok(Math.abs(d2 - 3.29) < 0.4, String(d2));
  assert.ok(d3 > sample[0] * 0.9, 'a probability smaller than 1/n reaches past the largest move seen');
});

test('the integrated autocorrelation time is one for independent samples and (1 + rho) / (1 - rho) for an autoregression', () => {
  const random = rng(9);
  assert.ok(integratedAutocorrelationTime(Array.from({ length: 4000 }, () => random())) < 1.5);
  let x = 0; const ar = Array.from({ length: 20000 }, () => { x = 0.9 * x + gaussian(random); return x; });
  const tau = integratedAutocorrelationTime(ar);
  assert.ok(tau > 12 && tau < 30, `tau ${tau} (theory 19)`);
});

test('a calmer regime needs a smaller distance than a stormier one for the same probability, and the upper bound is never below the estimate', () => {
  const calm = walk(60 * 24 * 10, 0.05, 11), storm = walk(60 * 24 * 5, 0.35, 12), series = new Map();
  for (const [t, v] of calm) series.set(t, v);
  const base = 60 * 24 * 10 * MINUTE, offset = [...calm.values()].at(-1) - storm.get(0);
  for (const [t, v] of storm) series.set(base + t, v + offset);
  const table = fitMoveTable(series, { horizons: [5, 30], resamples: 30, seed: 5, regimes: 3 });
  assert.equal(table.regimes, 3); assert.ok(table.blockMinutes >= MAX_HORIZON_MINUTES);
  for (const [key, s] of Object.entries(table.strata)) {
    s.point.forEach((p, i) => assert.ok(s.upper[i] >= p - 1e-9, `${key} ${i}`));
    for (let i = 1; i < s.upper.length; i += 1) assert.ok(s.upper[i] >= s.upper[i - 1] - 1e-9, `${key}: a smaller probability needs a longer distance`);
  }
  const quiet = distanceAt(table, { direction: 'fall', horizonMinutes: 30, variation: 0, epsilon: 0.01 });
  const rough = distanceAt(table, { direction: 'fall', horizonMinutes: 30, variation: 1e9, epsilon: 0.01 });
  assert.ok(quiet < rough, `${quiet} < ${rough}`);
});

test('the regime count is the one that predicts best later in the window: one regime for a series with one volatility, more for a series with two', () => {
  const anchorsOf = (series, h = 10) => [...series].filter(([t]) => series.has(t + h * MINUTE)).map(([t, v]) => ({ t, move: series.get(t + h * MINUTE) - v, variation: trailingVariation(series, t, h) })).filter((a) => a.variation !== null);
  const single = chooseRegimes([anchorsOf(walk(60 * 24 * 8, 0.1, 21))]);
  assert.ok(single.regimes <= 2, `a single volatility is predicted by ${single.regimes} regimes`);
  // alternating calm and stormy days make the trailing variation informative
  const mixed = new Map(); let v = 70; const random = rng(22);
  for (let i = 0; i < 60 * 24 * 12; i += 1) { const day = Math.floor(i / (60 * 6)); v += (day % 2 ? 0.4 : 0.05) * gaussian(random); mixed.set(i * MINUTE, v); }
  const two = chooseRegimes([anchorsOf(mixed)]);
  assert.ok(two.regimes >= 2, `two volatilities are predicted by ${two.regimes} regimes`);
});

test('the fitted upper bound holds out of sample at the probability it claims', () => {
  const train = walk(60 * 24 * 12, 0.12, 21), heldOut = walk(60 * 24 * 12, 0.12, 22);
  const table = fitMoveTable(train, { horizons: [10], resamples: 60, seed: 9, regimes: 3 });
  const epsilon = 0.01;
  let exceed = 0, anchors = 0;
  for (const [t, v] of heldOut) {
    const later = heldOut.get(t + 10 * MINUTE), variation = trailingVariation(heldOut, t, 10);
    if (later === undefined || variation === null) continue;
    anchors += 1;
    if (v - later >= distanceAt(table, { direction: 'fall', horizonMinutes: 10, variation, epsilon })) exceed += 1;
  }
  assert.ok(exceed / anchors <= epsilon * 1.5, `${exceed}/${anchors} fell farther than the bound claimed at ${epsilon}`);
});

test('the probability of a distance falls as the distance grows, is one within the bulk, and is not defined beyond the longest horizon', () => {
  const table = fitMoveTable(walk(60 * 24 * 8, 0.1, 31), { horizons: [5, 65], resamples: 30, seed: 2, regimes: 1 });
  const p = (distance) => exceedanceUpper(table, { direction: 'rise', horizonMinutes: 5, variation: 0, distance });
  assert.ok(p(0.05) >= p(0.5) && p(0.5) >= p(1.5) && p(1.5) >= p(5));
  assert.equal(p(0.001), 1);
  assert.ok(p(5) < 1e-4);
  assert.equal(exceedanceUpper(table, { direction: 'rise', horizonMinutes: 66, variation: 0, distance: 1 }), null);
});

test('regimes follow the cuts the data gave, and an unknown variation is the stormiest', () => {
  const cuts = [99, 199];
  assert.equal(regimeIndex(cuts, 50), 0); assert.equal(regimeIndex(cuts, 150), 1); assert.equal(regimeIndex(cuts, 250), 2);
  assert.equal(regimeIndex(cuts, null), 2);
  assert.equal(trailingVariation(new Map([[0, 1], [MINUTE, 2], [2 * MINUTE, 1.5]]), 2 * MINUTE, 2), 1.5);
});
