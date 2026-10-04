/**
 * Ensemble pooling and last-step calibration for LLM forecasts. Pure.
 *
 * Order of operations in the bot is fixed: members -> pool (median / trimmed logit-mean) -> calibrate (this module,
 * applied LAST, after every other step) -> clamp into the API range. The winning Metaculus bot recipes (Metaculus
 * Substack and the LessWrong synthesis cited in the 2026-10-04 scout record) combine a frontier-model ensemble, several
 * samples, Platt-style recalibration and capped extremes; the parameters here are DATA (content/config/metaculus-bot.json),
 * to be refit from backtests, not constants of nature. Scoring reuses ./forecasting.mjs (brierScore, logScore,
 * calibrationBuckets); ensemble evidence conflict reuses ./evidence-fusion.mjs.
 */

import { brierScore, logScore, calibrationBuckets } from "./forecasting.mjs";

const EPS = 1e-6;
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const logit = (p) => Math.log(clamp(p, EPS, 1 - EPS) / (1 - clamp(p, EPS, 1 - EPS)));
export const expit = (z) => 1 / (1 + Math.exp(-z));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Pools member probabilities. `trimmed-logit-mean` drops the single highest and lowest member when there are >= 5,
 * then averages in log-odds space; `median` takes the median; `mean` is the linear mean.
 */
export function poolProbabilities(probabilities, { method = "trimmed-logit-mean", weights = null } = {}) {
  const ps = probabilities.filter((p) => Number.isFinite(p));
  if (ps.length === 0) throw new RangeError("probability-calibration: nothing to pool");
  if (method === "median") return median(ps);
  if (method === "mean") return ps.reduce((a, b) => a + b, 0) / ps.length;
  let zs = ps.map((p, i) => ({ z: logit(p), w: weights?.[i] ?? 1 })).sort((a, b) => a.z - b.z);
  if (zs.length >= 5) zs = zs.slice(1, -1);
  const w = zs.reduce((s, x) => s + x.w, 0);
  return expit(zs.reduce((s, x) => s + x.z * x.w, 0) / w);
}

/** Log-odds extremizing by factor a (a = 1 leaves p alone, a > 1 pushes away from 0.5). */
export const extremize = (p, a) => expit(a * logit(p));

/**
 * The calibration map applied last. `platt` ({a, b}: expit(a*logit(p)+b)) when fitted; else `extremize`; then cap.
 * `floor`/`cap` bound the final probability (capping extremes is part of the winning recipes: a confident miss costs
 * more than a confident hit earns under peer scoring).
 */
export function calibrateProbability(p, { extremize: a = 1, platt = null, floor = 0.03, cap = 0.97 } = {}) {
  let z = logit(p);
  z = platt ? platt.a * z + platt.b : a * z;
  return clamp(expit(z), floor, cap);
}

/**
 * Ridge-regularised logistic regression of outcomes on logit(p): returns {a, b} for expit(a*logit(p)+b).
 * The prior pulls toward (1, 0) (identity) with strength `l2` so few observations cannot overfit; refuses n < minN.
 */
export function fitPlatt(observations, { l2 = 2, minN = 30, iterations = 50 } = {}) {
  if (observations.length < minN) return null;
  let a = 1, b = 0;
  for (let it = 0; it < iterations; it += 1) {
    let ga = l2 * (a - 1), gb = 0, haa = l2, hab = 0, hbb = 1e-6;
    for (const { probability, outcome } of observations) {
      const x = logit(probability);
      const q = expit(a * x + b);
      const r = q - outcome, w = q * (1 - q);
      ga += r * x; gb += r; haa += w * x * x; hab += w * x; hbb += w;
    }
    const det = haa * hbb - hab * hab;
    if (!(Math.abs(det) > 1e-12)) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b, n: observations.length, l2 };
}

/** Mean Brier and log score plus the decile calibration curve for [{probability, outcome}]. Probabilities are clamped off 0/1 for log. */
export function scoreObservations(observations) {
  const n = observations.length;
  if (n === 0) return { n: 0, brier: null, log: null, buckets: [] };
  const safe = observations.map((o) => ({ probability: clamp(o.probability, EPS, 1 - EPS), outcome: o.outcome }));
  return {
    n,
    brier: safe.reduce((s, o) => s + brierScore(o.probability, o.outcome), 0) / n,
    log: safe.reduce((s, o) => s + logScore(o.probability, o.outcome), 0) / n,
    buckets: calibrationBuckets(safe),
  };
}

/** Paired bootstrap (percentile) interval for the mean of per-question score differences (negative = A better on loss scores). */
export function bootstrapMeanDiff(diffs, { resamples = 2000, seed = 17 } = {}) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
  const n = diffs.length;
  const means = [];
  for (let r = 0; r < resamples; r += 1) {
    let t = 0;
    for (let i = 0; i < n; i += 1) t += diffs[Math.floor(rnd() * n)];
    means.push(t / n);
  }
  means.sort((x, y) => x - y);
  return { mean: diffs.reduce((a, b) => a + b, 0) / n, lo: means[Math.floor(0.025 * resamples)], hi: means[Math.floor(0.975 * resamples)] };
}

/**
 * Multiple choice: average members' option vectors (linear mean), shrink toward uniform by `shrink`, floor each option,
 * renormalise to sum exactly 1. Options never get probability 0: an unseen option that wins would score -inf.
 */
export function calibrateOptionVector(vectors, options, { floor = 0.01, shrink = 0.05 } = {}) {
  const rows = vectors.map((v) => options.map((o) => Number(v?.[o]))).filter((r) => r.every((x) => Number.isFinite(x) && x >= 0) && r.some((x) => x > 0));
  if (rows.length === 0) throw new RangeError("probability-calibration: no usable option vectors");
  const normed = rows.map((r) => { const t = r.reduce((a, b) => a + b, 0); return r.map((x) => x / t); });
  const mean = options.map((_, j) => normed.reduce((s, r) => s + r[j], 0) / normed.length);
  const k = options.length;
  let p = mean.map((x) => (1 - shrink) * x + shrink / k);
  p = p.map((x) => Math.max(floor, x));
  const t = p.reduce((a, b) => a + b, 0);
  p = p.map((x) => x / t);
  return fixSum(Object.fromEntries(options.map((o, j) => [o, p[j]])), options);
}

function fixSum(map, options) {
  const out = {};
  let acc = 0;
  options.forEach((o, j) => {
    if (j === options.length - 1) out[o] = Math.round((1 - acc) * 1e6) / 1e6;
    else { out[o] = Math.round(map[o] * 1e6) / 1e6; acc += out[o]; }
  });
  return out;
}
