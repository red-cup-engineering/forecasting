/**
 * A hypothesis's verdict as a FOUR reading, read only through four.mjs (point names are never spelled here).
 *
 *   supported side told   the pre-registered criterion passes: clusters >= minClusters, mean net > 0, t > k,
 *                         and the comparison arm (if any) clears its own k.
 *   refuted side told     the criterion fails decisively: mean net < 0 with t < -refuteK once half the
 *                         clusters are in, or the cluster budget (maxClusters, else minClusters) is spent
 *                         without a pass.
 *   neither told          too few clusters (or judgeAfter not reached).
 *   both told             the holdout arm and the rest disagree in the sign of the mean.
 *
 * Status follows from the reading: only-supported -> passed, only-refuted -> killed, otherwise unchanged.
 * `admitted` is the desk owner's act and is never set here.
 */
import { readingOfSides, sidesOfReading } from '@red-cup-engineering/computer-data-engineering-services-section/four';
import { armDifference, clusterStats } from './stats.mjs';

const monthOf = (date) => String(date).slice(0, 7);

/** Split items into holdout and rest per the criterion's holdout spec; null when there is none. */
export function splitHoldout(items, spec) {
  if (!spec || !items.length) return null;
  if (spec.from) {
    const from = Date.parse(spec.from);
    return { holdout: items.filter((i) => Date.parse(i.date) >= from), rest: items.filter((i) => Date.parse(i.date) < from) };
  }
  const months = [...new Set(items.map((i) => monthOf(i.date)))].sort();
  let hold = months.slice(-1);
  if (hold.length && items.filter((i) => monthOf(i.date) === hold[0]).length < 10 && months.length > 1) hold = months.slice(-2);
  return { holdout: items.filter((i) => hold.includes(monthOf(i.date))), rest: items.filter((i) => !hold.includes(monthOf(i.date))) };
}

/**
 * @param {object} h validated hypothesis
 * @param {{items?: {g: string, x: number, date: string, arm?: string}[], stats?: object, comparison?: object}} data
 *   items (jackknifed here) or precomputed stats {n, groups, mean, se, t} (and a comparison difference)
 * @param {{now?: number}} [options]
 */
export function readVerdict(h, data, { now = Date.now() } = {}) {
  const c = h.verdict, refuteK = c.refuteK ?? c.k, reasons = [];
  const items = data.items ?? null;
  const stats = data.stats ?? clusterStats(items ?? []);
  const arms = {};
  let comparison = data.comparison ?? null;
  if (items && c.comparison) {
    const a = clusterStats(items.filter((i) => i.arm === c.comparison.arm)), b = clusterStats(items.filter((i) => i.arm === c.comparison.against));
    arms[c.comparison.arm] = a; arms[c.comparison.against] = b;
    comparison = a.groups >= 2 && b.groups >= 2 ? armDifference(a, b) : null;
  }
  const n = stats.groups;
  const passes = n >= c.minClusters && stats.mean > 0 && stats.t > c.k
    && (!c.comparison || (comparison !== null && comparison.mean > 0 && comparison.t > c.comparison.k));
  const budget = c.maxClusters ?? c.minClusters;
  const decisive = n >= Math.ceil(c.minClusters / 2) && stats.mean < 0 && stats.t < -refuteK;
  const exhausted = n >= budget && !passes;
  let supported = passes, refuted = decisive || exhausted;
  if (decisive) reasons.push(`mean net ${stats.mean.toFixed(4)} with t ${stats.t.toFixed(2)} < -${refuteK} at ${n} clusters`);
  if (exhausted && !decisive) reasons.push(`${n} clusters (budget ${budget}) without a pass`);
  if (passes) reasons.push(`${n} clusters, mean net ${stats.mean.toFixed(4)}, t ${stats.t.toFixed(2)} > ${c.k}`);
  if (n < c.minClusters && !refuted) reasons.push(`${n}/${c.minClusters} clusters`);
  let holdout = null;
  const split = items ? splitHoldout(items, c.holdout) : null;
  if (split) {
    const hs = clusterStats(split.holdout), rs = clusterStats(split.rest);
    holdout = { holdout: hs, rest: rs };
    if (hs.groups >= 2 && rs.groups >= 2 && Math.sign(hs.mean) !== Math.sign(rs.mean)) { supported = true; refuted = true; reasons.push('holdout and forward arms disagree in sign'); }
  }
  if (h.judgeAfter && now < Date.parse(h.judgeAfter)) { supported = false; refuted = false; reasons.length = 0; reasons.push(`not judged before ${h.judgeAfter}`); }
  const reading = readingOfSides('told', supported, refuted);
  const [told, against] = sidesOfReading(reading);
  const status = told && !against ? 'passed' : against && !told ? 'killed' : null;
  return { reading, sides: { supported: told, refuted: against }, status, clusters: n, observations: stats.n, mean: stats.mean, se: stats.se, t: stats.t, comparison, arms, holdout, reasons };
}

/** Next status from the current one and a verdict: transitions follow the reading, `admitted` is never taken. */
export function nextStatus(current, verdict) {
  if (current === 'killed' || current === 'admitted') return current;
  if (verdict.status) return verdict.status;
  return current === 'passed' ? 'forward' : current;
}
