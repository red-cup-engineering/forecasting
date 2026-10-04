/**
 * Numeric / date / discrete forecasts in Metaculus's CDF format.
 *
 * A model states a handful of (percentile, value) pairs in real units; this turns them into the cdf_size-point
 * (default 201) continuous_cdf the forecast endpoint takes. The location mapping (linear or log via zero_point) and
 * the standardization (no mass outside closed bounds, minimum mass in open bounds, per-step rise >= 5e-5, per-step
 * mass cap 0.2 * 200/(cdf_size-1)) are a port of Metaculus's forecasting-tools numeric_report.py
 * (_nominal_location_to_cdf_location, _get_cdf_at, _standardize_cdf), which in turn follows the "CDF generation
 * details" section of the Metaculus API docs.
 *
 * Ensemble aggregation of numeric answers is Vincentization: average the members' values at each percentile
 * (in cdf-location space so log-scaled questions average geometrically), then build one CDF.
 */

export const STANDARD_PERCENTILES = Object.freeze([0.1, 0.2, 0.4, 0.6, 0.8, 0.9]);

/** Real value -> position in [0,1] of the question's range (may fall outside). */
export function valueToLocation(value, { rangeMin, rangeMax, zeroPoint }) {
  if (zeroPoint !== null && zeroPoint !== undefined) {
    const deriv = (rangeMax - zeroPoint) / (rangeMin - zeroPoint);
    const v = value === zeroPoint ? value + 1e-10 : value;
    const arg = (v - rangeMin) * (deriv - 1) + (rangeMax - rangeMin);
    if (!(arg > 0)) return -Infinity;
    return (Math.log(arg) - Math.log(rangeMax - rangeMin)) / Math.log(deriv);
  }
  return (value - rangeMin) / (rangeMax - rangeMin);
}

/** Inverse of valueToLocation. */
export function locationToValue(location, { rangeMin, rangeMax, zeroPoint }) {
  if (zeroPoint !== null && zeroPoint !== undefined) {
    const deriv = (rangeMax - zeroPoint) / (rangeMin - zeroPoint);
    return rangeMin + ((rangeMax - rangeMin) * (deriv ** location - 1)) / (deriv - 1);
  }
  return rangeMin + location * (rangeMax - rangeMin);
}

function maxPmf(cdfSize) {
  return 0.2 * (200 / (cdfSize - 1)) * 0.95;
}

/** Port of _standardize_cdf. `cdf` is raw heights over equally spaced locations; returns a valid forecast CDF. */
export function standardizeCdf(rawCdf, { openLower, openUpper }) {
  const cdf = [...rawCdf];
  const n = cdf.length;
  const scaleLowerTo = openLower ? 0 : cdf[0];
  const scaleUpperTo = openUpper ? 1 : cdf[n - 1];
  const inbound = scaleUpperTo - scaleLowerTo;
  if (!(inbound > 0)) throw new RangeError("metaculus-cdf: degenerate CDF with no inbound mass");
  const applyMinimum = (F, loc) => {
    const r = (F - scaleLowerTo) / inbound;
    if (openLower && openUpper) return 0.988 * r + 0.01 * loc + 0.001;
    if (openLower) return 0.989 * r + 0.01 * loc + 0.001;
    if (openUpper) return 0.989 * r + 0.01 * loc;
    return 0.99 * r + 0.01 * loc;
  };
  for (let i = 0; i < n; i += 1) cdf[i] = applyMinimum(cdf[i], i / (n - 1));

  // PMF space: diff with prepend 0 and append 1 (length n+1).
  let pmf = new Array(n + 1);
  pmf[0] = cdf[0];
  for (let i = 1; i < n; i += 1) pmf[i] = cdf[i] - cdf[i - 1];
  pmf[n] = 1 - cdf[n - 1];
  const cap = maxPmf(n);
  const capped = (scale) => pmf.map((v, i) => (i === 0 || i === n ? v : Math.min(cap, scale * v)));
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  let lo = 1, hi = 1, scale = 1;
  while (sum(capped(hi)) < 1 && hi < 1e6) hi *= 1.2;
  for (let k = 0; k < 100; k += 1) {
    scale = 0.5 * (lo + hi);
    const s = sum(capped(scale));
    if (s < 1) lo = scale; else hi = scale;
    if (s === 1 || hi - lo < 2e-5) break;
  }
  pmf = capped(scale);
  const inner = sum(pmf.slice(1, n));
  const factor = (cdf[n - 1] - cdf[0]) / inner;
  for (let i = 1; i < n; i += 1) pmf[i] *= factor;
  const out = [];
  let acc = 0;
  for (let i = 0; i < n; i += 1) { acc += pmf[i]; out.push(Math.round(acc * 1e10) / 1e10); }
  return out;
}

/**
 * Builds a valid CDF from percentile declarations.
 * @param {Array<{percentile:number, value:number}>} declared real-unit values at percentiles in (0,1); need not be sorted
 * @param {{scaling:{rangeMin:number,rangeMax:number,zeroPoint:?number,cdfSize:number}, openLower:boolean, openUpper:boolean}} question
 */
export function cdfFromPercentiles(declared, question) {
  const { scaling, openLower, openUpper } = question;
  const size = scaling.cdfSize ?? 201;
  const pts = declared
    .filter((d) => Number.isFinite(d.value) && d.percentile > 0 && d.percentile < 1)
    .map((d) => ({ loc: valueToLocation(d.value, scaling), p: d.percentile }))
    .filter((d) => Number.isFinite(d.loc))
    .sort((a, b) => a.p - b.p);
  if (pts.length < 2) throw new RangeError("metaculus-cdf: need at least two usable percentiles");
  // Monotone in location: nudge ties and inversions forward by a tiny epsilon.
  for (let i = 1; i < pts.length; i += 1) if (pts[i].loc <= pts[i - 1].loc) pts[i].loc = pts[i - 1].loc + 1e-6;
  const first = pts[0], last = pts[pts.length - 1];
  const anchors = [{ loc: Math.min(0, first.loc) - 0.05, p: 0 }, ...pts, { loc: Math.max(1, last.loc) + 0.05, p: 1 }];
  const at = (x) => {
    for (let i = 1; i < anchors.length; i += 1) {
      const a = anchors[i - 1], b = anchors[i];
      if (x >= a.loc - 1e-12 && x <= b.loc + 1e-12) return a.p + ((b.p - a.p) * (x - a.loc)) / (b.loc - a.loc);
    }
    return x < anchors[0].loc ? 0 : 1;
  };
  const raw = Array.from({ length: size }, (_, i) => at(i / (size - 1)));
  // Raw must be non-decreasing; standardization needs inbound mass.
  for (let i = 1; i < raw.length; i += 1) if (raw[i] < raw[i - 1]) raw[i] = raw[i - 1];
  return standardizeCdf(raw, { openLower, openUpper });
}

/** Vincentized ensemble: average per-percentile locations across members, then one CDF. */
export function aggregatePercentileSets(sets, question, percentiles = STANDARD_PERCENTILES) {
  const usable = sets.filter((s) => Array.isArray(s) && s.length >= 2);
  if (usable.length === 0) throw new RangeError("metaculus-cdf: no usable member percentile sets");
  const declared = percentiles.map((percentile) => {
    const locs = usable.map((s) => s.find((d) => Math.abs(d.percentile - percentile) < 1e-9)).filter(Boolean)
      .map((d) => valueToLocation(d.value, question.scaling)).filter(Number.isFinite);
    if (locs.length === 0) return null;
    return { percentile, value: locationToValue(locs.reduce((a, b) => a + b, 0) / locs.length, question.scaling) };
  }).filter(Boolean);
  return cdfFromPercentiles(declared, question);
}

/** Reads a CDF back as the value at a percentile (for the human-readable comment). */
export function cdfQuantile(cdf, q, scaling) {
  for (let i = 1; i < cdf.length; i += 1) {
    if (cdf[i] >= q) {
      const f = (q - cdf[i - 1]) / (cdf[i] - cdf[i - 1]);
      return locationToValue((i - 1 + f) / (cdf.length - 1), scaling);
    }
  }
  return locationToValue(1, scaling);
}
