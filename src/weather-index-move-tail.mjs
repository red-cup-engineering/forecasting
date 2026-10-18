/**
 * How far Kalshi's city temperature index can move before an hourly contract's target minute, as a probability.
 *
 * weather-index-rate-envelope.mjs records the largest move ever seen and multiplies it by a margin (SAFETY = 1.5). That is a
 * bound with no probability behind it: it does not say how likely a larger move is, so it cannot say whether an outcome priced
 * at 97 cents is worth buying. This module estimates the probability itself.
 *
 * Model. For a city, a direction (fall or rise), a horizon h (minutes from the latest known minute to the target) and a volatility
 * regime (the index's total variation over the preceding h minutes, the same span as the move to be predicted, cut into regimes where
 * the training data say), the move M = v(t0 + h) - v(t0) is sampled over every known minute t0 of the history. The survival
 * function P(M >= d) is the empirical one below a threshold u (the k-th largest move) and, above it, a generalized Pareto tail fitted
 * by probability-weighted moments (Hosking and Wallis 1987), so a move larger than any seen still has a probability (extreme value
 * theory: exceedances over a high threshold are generalized Pareto, Pickands 1975, Balkema and de Haan 1974).
 *
 * Uncertainty. The sample is weeks of minutes, strongly autocorrelated, so the tail is not known to the precision the sample size
 * suggests. A moving-block bootstrap refits the tail B times; the table records, for each tail probability on a grid, the distance d
 * such that with confidence 1 - alpha the true P(M >= d) is at most that probability (the (1 - alpha) quantile of the refits' inverse
 * survival). A decision uses that upper bound, never the point estimate.
 *
 * Parameters. Every number here is a unit, a fact of the contract, a convention with its source, or derived from the data being fitted
 * (PARAMETERS records which, with its provenance; test/determination-parameters.test.mjs fails on a numeric literal that is not one
 * of these). The block length is the integrated autocorrelation time of the exceedances (Sokal 1997), the horizons are every minute
 * the contract allows, the tail probabilities halve from one half, and the number of volatility regimes is the one that predicts best
 * on the later part of the training window.
 */

import { rng } from './prng.mjs';
import { parameter, SHARED } from './weather-determination-parameters.mjs';

const SECOND = 1000, MINUTE = 60 * SECOND;

export const PARAMETERS = Object.freeze({
  receiptDeadlineMinutes: parameter(5, 'contract', 'Kalshi Weather Index Methodology (certified, MIAWINDEX.pdf and its siblings): S + D, D = 300 seconds. Measured 2026-10-18: 148 polled minutes had no published value before 277 s and all had one by 358 s'),
  marketSpanMinutes: parameter(60, 'contract', 'open_time to close_time of all 15,770 settled hourly index markets, 2026-10-01..10-17 (services/forecasting-service/data/records/2026-10-16-hourly-index-station-lattice, data/events)'),
  confidence: SHARED.confidence,
  resamples: SHARED.resamples,
  tailRoot: parameter(0.5, 'convention', 'the number of tail exceedances k = n^0.5 (the square-root rule; Hall 1990; Drees and Kaufmann 1998 choose k from the data and land near it for light tails)'),
  tailFloor: parameter(5, 'convention', 'fewest exceedances a generalized Pareto fit is attempted on (Hosking and Wallis 1987)'),
  tailIndexBound: parameter(0.5, 'convention', 'the shape is kept in [-0.5, 0.5], where probability-weighted moments are regular and the tail has a finite mean (Hosking and Wallis 1987)'),
  regimeCandidates: parameter([1, 2, 3, 4, 5], 'convention', 'counts of volatility regimes tried; the one with the lowest hold-out pinball loss is used'),
  regimeQuantiles: parameter([0.9, 0.99], 'convention', 'move quantiles the regime count is scored on (the part of the distribution a decision uses)'),
  holdOutFraction: parameter(0.25, 'convention', 'the latest quarter of the training window scores the regime count'),
  minimumAnchors: parameter(50, 'convention', 'fewest anchors a stratum is fitted on'),
  tailKeepFactor: parameter(4, 'convention', 'the bootstrap keeps the largest 4 k moves of a stratum: a refit uses k, and the threshold moves with the resample'),
  autocorrelationWindow: parameter(5, 'convention', 'Sokal (1997) automatic windowing: the window is the smallest M with M >= 5 tau(M)'),
  tablePrecisionExponent: parameter(20, 'derived', 'the table runs to 2^-20, about 1e-6: below the order of one wrong decision per year (4 cities x 24 hours x 365 days = 35,040 decisions, 2^-15) with a factor of 32 beyond'),
});

const P = (name) => PARAMETERS[name].value;
export const MAX_HORIZON_MINUTES = P('marketSpanMinutes') + P('receiptDeadlineMinutes');
/** Every minute the contract allows. */
export const HORIZONS = Object.freeze(Array.from({ length: MAX_HORIZON_MINUTES }, (_, i) => i + 1));
/** Tail probabilities halving from one half. */
export const EPSILONS = Object.freeze(Array.from({ length: P('tablePrecisionExponent') }, (_, i) => 2 ** -(i + 1)));
export { MINUTE, rng };

/** Element of a sorted array at quantile q by the nearest-rank rule on (0, 1]. */
const rank = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];

/**
 * Generalized Pareto parameters of the excesses over a threshold by probability-weighted moments:
 * with a0 = mean and a1 = mean of (1 - F) x, k = a0 / (a0 - 2 a1) - 2, sigma = 2 a0 a1 / (a0 - 2 a1), xi = -k.
 * @param {number[]} excesses ascending, positive
 */
export function fitGpd(excesses) {
  const n = excesses.length;
  if (n < P('tailFloor')) return { xi: 0, sigma: n ? excesses.reduce((a, b) => a + b, 0) / n : 0 };
  let a0 = 0, a1 = 0;
  for (let i = 0; i < n; i += 1) { a0 += excesses[i]; a1 += excesses[i] * (n - 1 - i) / (n - 1); }
  a0 /= n; a1 /= n;
  const denominator = a0 - 2 * a1;
  if (!(denominator > 0)) return { xi: 0, sigma: a0 };
  const xi = Math.min(P('tailIndexBound'), Math.max(-P('tailIndexBound'), -(a0 / denominator - 2)));
  return { xi, sigma: Math.max(Number.MIN_VALUE, (2 * a0 * a1) / denominator) };
}

/** Inverse survival: the distance d with P(M >= d) = epsilon under the empirical-plus-GPD model of one stratum. */
export function inverseSurvival(model, epsilon) {
  const { n, tail, u, xi, sigma } = model;
  const pu = tail.length / n;
  if (epsilon >= pu) {
    const i = Math.min(model.sortedDesc.length - 1, Math.max(0, Math.ceil(epsilon * n) - 1));
    return model.sortedDesc[i] ?? 0;
  }
  const ratio = epsilon / pu;
  return u + (xi === 0 ? -sigma * Math.log(ratio) : (sigma / xi) * (Math.pow(ratio, -xi) - 1));
}

/** The model of one stratum from its moves (non-negative, in the stratum's direction), `n` anchors in all. */
export function stratumModel(movesDesc, n) {
  const k = Math.min(movesDesc.length, Math.max(P('tailFloor'), Math.ceil(n ** P('tailRoot'))));
  const u = movesDesc[k] ?? movesDesc[k - 1] ?? 0, tail = movesDesc.slice(0, k).map((m) => m - u).reverse();
  const { xi, sigma } = fitGpd(tail);
  return { n, u, xi, sigma, tail, sortedDesc: movesDesc };
}

/**
 * The integrated autocorrelation time of a series in samples (Sokal 1997, the automatic window). The effective number of independent
 * samples is n / tau.
 */
export function integratedAutocorrelationTime(series) {
  const n = series.length;
  if (n < 2) return 1;
  const mean = series.reduce((a, b) => a + b, 0) / n;
  let variance = 0;
  for (const x of series) variance += (x - mean) ** 2;
  if (!(variance > 0)) return 1;
  let tau = 1;
  for (let lag = 1; lag < n / 2; lag += 1) {
    let c = 0;
    for (let i = 0; i + lag < n; i += 1) c += (series[i] - mean) * (series[i + lag] - mean);
    tau += (2 * c) / variance;
    if (lag >= P('autocorrelationWindow') * tau) return Math.max(1, tau);
  }
  return Math.max(1, tau);
}

/** Prefix sums of absolute one-minute changes and of how many were present, so the variation over any span is constant time. */
function variationIndex(times, minutes) {
  const index = new Map(), sum = [0], present = [0];
  times.forEach((t, i) => {
    index.set(t, i);
    const prev = minutes.get(t - MINUTE), step = prev === undefined ? 0 : Math.abs(minutes.get(t) - prev);
    sum.push(sum[i] + step); present.push(present[i] + (prev === undefined ? 0 : 1));
  });
  return { index, sum, present };
}

/** Total variation of the minute series over the `span` minutes ending at t (null when fewer than half of those minutes are present). */
function variationOver(vi, t, span) {
  const i = vi.index.get(t), j = vi.index.get(t - span * MINUTE);
  if (i === undefined || j === undefined) return null;
  const have = vi.present[i + 1] - vi.present[j + 1];
  return have * 2 >= span ? vi.sum[i + 1] - vi.sum[j + 1] : null;
}

/** The regime of a trailing variation among `cuts`: the first it does not exceed; the most volatile when unknown. */
export function regimeIndex(cuts, variation) {
  if (variation === null || variation === undefined) return cuts.length;
  const i = cuts.findIndex((c) => variation <= c);
  return i === -1 ? cuts.length : i;
}

const cutsOf = (variations, regimes) => {
  const sorted = variations.filter((v) => v !== null).sort((a, b) => a - b);
  return Array.from({ length: regimes - 1 }, (_, i) => rank(sorted, (i + 1) / regimes));
};

/** Pinball (quantile) loss of predicting quantile q by `prediction` for observations `values`. */
const pinball = (values, prediction, q) => values.reduce((s, y) => s + (y >= prediction ? q * (y - prediction) : (1 - q) * (prediction - y)), 0) / values.length;

/**
 * The number of volatility regimes that predicts best: for each candidate, the regime cuts and the move quantiles are taken from the
 * earlier part of the window and scored (pinball loss at `regimeQuantiles`, summed over the horizons) on the later part.
 * @param {{t: number, move: number, variation: number}[][]} anchorsByHorizon anchors per horizon, ascending in time
 */
export function chooseRegimes(anchorsByHorizon, { holdOutFraction = P('holdOutFraction') } = {}) {
  const scores = {};
  for (const regimes of P('regimeCandidates')) {
    let total = 0;
    for (const anchors of anchorsByHorizon) {
      const cut = Math.floor(anchors.length * (1 - holdOutFraction)), train = anchors.slice(0, cut), test = anchors.slice(cut);
      if (train.length < P('minimumAnchors') * regimes || test.length < P('minimumAnchors')) continue;
      const cuts = cutsOf(train.map((a) => a.variation), regimes);
      for (let r = 0; r < regimes; r += 1) {
        const inTrain = train.filter((a) => regimeIndex(cuts, a.variation) === r).map((a) => Math.abs(a.move)).sort((x, y) => x - y);
        const inTest = test.filter((a) => regimeIndex(cuts, a.variation) === r).map((a) => Math.abs(a.move));
        if (inTrain.length < P('minimumAnchors') || !inTest.length) continue;
        for (const q of P('regimeQuantiles')) total += (inTest.length / test.length) * pinball(inTest, rank(inTrain, q), q);
      }
    }
    scores[regimes] = total;
  }
  const best = Object.entries(scores).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
  return { regimes: Number(best[0]), scores };
}

/**
 * Fit one city's table from its known minutes (Map of epoch ms to value, F).
 * @param {Map<number, number>} minutes
 * @param {{horizons?: number[], epsilons?: number[], resamples?: number, alpha?: number, seed?: number, regimes?: number|null}} options
 * @returns the table: `{cuts, regimes, blockMinutes, anchors, strata: {"<dir>|<h>|<regime>": {n, u, xi, sigma, point: number[], upper: number[]}}}`
 *   point[i] and upper[i] are the distances (F) at epsilons[i]: the estimate and its (1 - alpha) upper confidence bound.
 */
export function fitMoveTable(minutes, { horizons = HORIZONS, epsilons = EPSILONS, resamples = P('resamples'), alpha = P('confidence'), seed = 1, regimes: forcedRegimes = null } = {}) {
  const times = [...minutes.keys()].sort((a, b) => a - b);
  const vi = variationIndex(times, minutes);
  const anchorsByHorizon = horizons.map((h) => {
    const anchors = [];
    for (const t of times) {
      const later = minutes.get(t + h * MINUTE);
      if (later === undefined) continue;
      const variation = variationOver(vi, t, h);
      if (variation === null) continue;
      anchors.push({ t, move: later - minutes.get(t), variation });
    }
    return anchors;
  });
  const chosen = forcedRegimes === null ? chooseRegimes(anchorsByHorizon) : { regimes: forcedRegimes, scores: null };
  // block length: the autocorrelation time of the exceedances of the (1 - alpha) quantile of the middle horizon's falls, and at least the longest horizon
  const reference = anchorsByHorizon[Math.floor(horizons.length / 2)] ?? [];
  const falls = reference.map((a) => Math.max(0, -a.move)), threshold = falls.length ? rank([...falls].sort((x, y) => x - y), 1 - alpha) : 0;
  const tau = integratedAutocorrelationTime(falls.map((x) => (x > threshold ? 1 : 0)));
  const blockMinutes = Math.max(Math.ceil(tau), MAX_HORIZON_MINUTES);
  const random = rng(seed), strata = {}, cuts = {};
  const blockOf = (t) => Math.floor(t / (blockMinutes * MINUTE));
  horizons.forEach((h, hi) => {
    const anchors = anchorsByHorizon[hi];
    const horizonCuts = cutsOf(anchors.map((a) => a.variation), chosen.regimes);
    cuts[h] = horizonCuts;
    for (let regime = 0; regime < chosen.regimes; regime += 1) {
      const inRegime = anchors.filter((a) => regimeIndex(horizonCuts, a.variation) === regime);
      if (inRegime.length < P('minimumAnchors')) continue;
      for (const direction of ['rise', 'fall']) {
        const moves = inRegime.map((a) => ({ block: blockOf(a.t), x: direction === 'rise' ? Math.max(0, a.move) : Math.max(0, -a.move) }));
        const movesDesc = moves.map((m) => m.x).sort((a, b) => b - a);
        const model = stratumModel(movesDesc, inRegime.length);
        const point = epsilons.map((e) => inverseSurvival(model, e));
        // moving-block bootstrap: resample the blocks with replacement, refit, invert. Only the largest moves reach the tail.
        const keep = Math.min(movesDesc.length, P('tailKeepFactor') * Math.ceil(inRegime.length ** P('tailRoot'))), floor = movesDesc[keep - 1] ?? 0;
        const sizes = new Map(), tops = new Map();
        for (const m of moves) {
          sizes.set(m.block, (sizes.get(m.block) ?? 0) + 1);
          if (m.x >= floor) { if (!tops.has(m.block)) tops.set(m.block, []); tops.get(m.block).push(m.x); }
        }
        const ids = [...sizes.keys()], draws = [];
        for (let b = 0; b < resamples; b += 1) {
          let n = 0; const sample = [];
          for (let i = 0; i < ids.length; i += 1) { const id = ids[Math.floor(random() * ids.length)]; n += sizes.get(id); const list = tops.get(id); if (list) for (const x of list) sample.push(x); }
          sample.sort((x, y) => y - x);
          draws.push(epsilons.map((e) => inverseSurvival(stratumModel(sample, n), e)));
        }
        // a percentile bootstrap can fall below the estimate in the far tail; the bound is never below it, and never shrinks as the probability does
        const upper = [];
        epsilons.forEach((_, i) => upper.push(Math.max(point[i], upper.at(-1) ?? 0, rank(draws.map((d) => d[i]).sort((x, y) => x - y), 1 - alpha))));
        strata[`${direction}|${h}|${regime}`] = { n: inRegime.length, u: model.u, xi: model.xi, sigma: model.sigma, point, upper };
      }
    }
  });
  return { cuts, regimes: chosen.regimes, regimeScores: chosen.scores, blockMinutes, autocorrelationTime: tau, epsilons: [...epsilons], horizons: [...horizons], alpha, resamples, anchors: times.length, strata };
}

/** The smallest tabulated horizon at or above `minutes`, or null beyond the longest. */
export const horizonFor = (table, minutes) => table.horizons.find((h) => h >= Math.max(1, minutes)) ?? null;

/**
 * The distance (F) the index moves in `direction` with probability at most epsilon, with the table's confidence, from the latest
 * known minute `horizonMinutes` before the target, in the volatility regime of `variation` (the total variation over the same span
 * before the anchor). Null when the table cannot say (no stratum, or beyond the longest horizon).
 */
export function distanceAt(table, { direction, horizonMinutes, variation, epsilon }) {
  const h = horizonFor(table, horizonMinutes);
  if (h === null) return null;
  const stratum = table.strata[`${direction}|${h}|${regimeIndex(table.cuts[h] ?? [], variation)}`];
  if (!stratum) return null;
  const grid = table.epsilons, upper = stratum.upper;
  if (epsilon >= grid[0]) return upper[0];
  if (epsilon <= grid.at(-1)) return upper.at(-1) + (Math.log(grid.at(-1)) - Math.log(epsilon)) * (upper.at(-1) - upper.at(-2)) / (Math.log(grid.at(-2)) - Math.log(grid.at(-1)));
  const i = grid.findIndex((e) => e <= epsilon);
  const f = (Math.log(grid[i - 1]) - Math.log(epsilon)) / (Math.log(grid[i - 1]) - Math.log(grid[i]));
  return upper[i - 1] + f * (upper[i] - upper[i - 1]);
}

/**
 * The upper-bound probability that the index moves at least `distance` F in `direction` over the horizon: the epsilon at which
 * `distanceAt` equals the distance (1 within the distance of the largest tabulated probability, where the table cannot bound it;
 * decaying past the distance of the smallest). Null when the table cannot say.
 */
export function exceedanceUpper(table, { direction, horizonMinutes, variation, distance }) {
  const grid = table.epsilons, at = (i) => distanceAt(table, { direction, horizonMinutes, variation, epsilon: grid[i] });
  const first = at(0);
  if (first === null) return null;
  if (distance <= first) return 1;
  let lo = 0, hi = grid.length - 1;
  if (distance >= at(hi)) return grid[hi] * Math.exp(-(distance - at(hi)) / Math.max(Number.MIN_VALUE, (at(hi) - at(hi - 1)) / Math.log(grid[hi - 1] / grid[hi])));
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (at(mid) <= distance) lo = mid; else hi = mid; }
  const f = (distance - at(lo)) / (at(hi) - at(lo));
  return Math.exp(Math.log(grid[lo]) + f * (Math.log(grid[hi]) - Math.log(grid[lo])));
}

/**
 * The total variation of the minutes in a Map over the `span` minutes ending at t (null when fewer than half of those minutes are
 * present). The caller passes the minutes known at its decision instant.
 */
export function trailingVariation(minutes, t, span) {
  let sum = 0, steps = 0;
  for (let i = 0; i < span; i += 1) {
    const a = minutes.get(t - i * MINUTE), b = minutes.get(t - (i + 1) * MINUTE);
    if (a === undefined || b === undefined) continue;
    sum += Math.abs(a - b); steps += 1;
  }
  return steps * 2 >= span ? sum : null;
}
