/**
 * How far a climate report's daily extreme can sit from the extreme the station's observations showed, as a probability.
 *
 * The daily high and low contracts settle on the NWS Daily Climate Report value (the Weather Company's reading of it), a whole
 * degree F. The running extreme of the day's observations only moves one way: a high already observed is a floor under the day's
 * high, a low already observed a ceiling over the day's low. So an outcome that follows from the extreme already seen is known
 * as soon as it is seen, up to one thing: the report's number need not equal the observations' number. Over the recorded
 * history the report's high is the one-minute observations' maximum or one degree below it, never above; the report's low is the
 * minimum or one above. This module measures that difference, delta = report - observed extreme (signed so that a report less
 * extreme than the observations has delta < 0 for a high), and bounds how often it exceeds k degrees:
 *
 *   P(report high <= observed high - k) <= upper confidence bound of P(delta <= -k)
 *
 * by the Clopper-Pearson bound on the count of station-days with delta <= -k out of the n measured, so the bound shrinks only with
 * evidence (zero such days in n gives 1 - alpha^(1/n), about 3/n), and every use of it is a probability to be priced.
 */

/** A station-day: the report's extreme and the observations' extreme (whole degrees F), and which extreme it is. */
import { SHARED } from './weather-determination-parameters.mjs';

const lessExtreme = (kind, report, observed) => (kind === 'high' ? observed - report : report - observed);

/**
 * The table of how many station-days the report was k degrees less extreme than the observations, for each k.
 * @param {{kind: 'high'|'low', report: number, observed: number}[]} days
 * @returns {{n: number, byKind: Record<string, {n: number, lessExtreme: Record<string, number>, moreExtreme: Record<string, number>}>}}
 */
export function discrepancyTable(days) {
  const byKind = { high: { n: 0, lessExtreme: {}, moreExtreme: {} }, low: { n: 0, lessExtreme: {}, moreExtreme: {} } };
  for (const day of days) {
    const bucket = byKind[day.kind];
    if (!bucket || !Number.isFinite(day.report) || !Number.isFinite(day.observed)) continue;
    const gap = lessExtreme(day.kind, day.report, day.observed);
    bucket.n += 1;
    const into = gap >= 0 ? bucket.lessExtreme : bucket.moreExtreme;
    const k = Math.abs(gap);
    for (let j = 1; j <= k; j += 1) into[j] = (into[j] ?? 0) + 1;
  }
  return { n: days.length, byKind };
}

const logChoose = (n, k) => { let s = 0; for (let i = 1; i <= k; i += 1) s += Math.log((n - k + i) / i); return s; };
/** P(X <= k) for X ~ Binomial(n, p). */
function binomialCdf(k, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let sum = 0;
  for (let i = 0; i <= k; i += 1) sum += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, sum);
}

/** The Clopper-Pearson one-sided upper bound at confidence 1 - alpha for `successes` of `n`. */
export function clopperPearsonUpper(successes, n, alpha = SHARED.confidence.value) {
  if (!(n > 0)) return 1;
  if (successes >= n) return 1;
  let lo = successes / n, hi = 1;
  // bisection to machine precision: the interval halves each step
  for (let i = 0; i < Math.ceil(-Math.log2(Number.EPSILON)); i += 1) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(successes, n, mid) > alpha) lo = mid; else hi = mid;
  }
  return hi;
}

/**
 * The upper bound on the probability that the report is at least `k` degrees less extreme than the observations, for `kind`.
 * k <= 0 is no cushion: probability 1 that the report is no more extreme than the observations is not a claim, so the bound is 1.
 */
export function lessExtremeUpper(table, kind, k, alpha = SHARED.confidence.value) {
  const bucket = table.byKind[kind];
  if (!bucket || !(bucket.n > 0)) return 1;
  if (k <= 0) return 1;
  return clopperPearsonUpper(bucket.lessExtreme[k] ?? 0, bucket.n, alpha);
}

/** The same bound for the report being at least `k` degrees MORE extreme than the observations (the other side of the monotone claim). */
export function moreExtremeUpper(table, kind, k, alpha = SHARED.confidence.value) {
  const bucket = table.byKind[kind];
  if (!bucket || !(bucket.n > 0)) return 1;
  if (k <= 0) return 1;
  return clopperPearsonUpper(bucket.moreExtreme[k] ?? 0, bucket.n, alpha);
}
