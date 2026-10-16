/**
 * The probability distribution of Kalshi's city temperature index at a settlement minute, from its member stations'
 * readings, on the lattice the index actually lives on.
 *
 * The index law (Kalshi Weather Index Methodology, with the city's published calibration; `reproduceIndex` in
 * weather-index.mjs reproduces every published minute from it): over the members S whose reading is accepted that
 * minute, index = 32 + 1.8 x (reference + sum_S w_i (C_i - offset_i) / sum_S w_i) F, rounded to 0.01 F. The base
 * weights are equal, so the index is a function of one integer: the sum of the accepted readings in tenths of a
 * degree C, given which members are accepted. A member reads a whole degree C (one-minute ASOS) or, when that feed
 * is missing, its METAR value in tenths. With every member accepted the offsets cancel against the reference.
 *
 * Each station is a latent temperature X behind a rounded, noisy reading C = round(X + e) at its resolution,
 * e ~ N(0, tau^2) per minute. Over h minutes the latent temperatures move by an expected change (the drift
 * regression below) plus a shared shock of variance sigmaCommon^2 h + sigmaDrift^2 h^2 (sigmaDrift is the error of
 * the expected change itself, compounding with the horizon) and their own sigmaStation^2 h. A grid filter tracks
 * each station's latent position from its readings as they arrive; the prediction integrates the shared shock by
 * Gauss-Hermite quadrature and, given it, convolves the stations into the exact distribution of the sum.
 *
 * The expected change of station i over h minutes is a regression, fitted by least squares on the stations' own
 * history (fit-lattice.mjs), on three predictors: the stations' recent trend x h, the diurnal climatology integrated
 * over the horizon (an exponentially weighted mean one-minute change per local hour, which follows the season), and
 * the change NOAA's LAMP station guidance forecasts for that station over the horizon.
 *
 * Pure and cheap: a station update and a full ladder of strike probabilities each take about a millisecond, so the
 * market maker recomputes them on every reading.
 */

const STEP = 0.05;          // latent grid, degrees C
const HALF_SPAN = 4;        // grid covers center +/- 4 C
const POINTS = Math.round((2 * HALF_SPAN) / STEP);
const MINUTE = 60_000;

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Gauss-Hermite nodes and weights for E[f(Z)], Z ~ N(0,1) (probabilists' form, 12 points). */
export const GAUSS_HERMITE = Object.freeze((() => {
  const x = [0.3142403762543591, 0.9477883912401637, 1.5976826351526048, 2.2795070805010598, 3.0206370251208896, 3.889724897869782];
  const w = [0.5701352362624795, 0.2605084915026380, 0.05160798561588394, 0.003905390584629061, 8.573687043587859e-5, 2.658551684356302e-7];
  const nodes = [];
  for (let i = 0; i < x.length; i += 1) for (const s of [-1, 1]) nodes.push({ z: s * x[i] * Math.SQRT2, w: w[i] / Math.sqrt(Math.PI) });
  return nodes;
})());

/** Three-point Gauss-Hermite for E[f(Z)], Z ~ N(0,1): the volatility regimes. */
const REGIMES = Object.freeze([{ z: -Math.sqrt(3), w: 1 / 6 }, { z: 0, w: 2 / 3 }, { z: Math.sqrt(3), w: 1 / 6 }]);

/** A reading's resolution in degrees C: one-minute ASOS reports whole degrees, the METAR fallback tenths. */
export const resolutionOf = (source) => (source === 'metar' ? 0.1 : 1);
/** A published station value (temp_f) as degrees C on its resolution. */
export const celsiusOf = (temperatureF, source) => { const r = resolutionOf(source); return Math.round((temperatureF - 32) / 1.8 / r) * r; };

const gridX = (center, k) => center - HALF_SPAN + (k + 0.5) * STEP;
function normalize(state) { let s = 0; for (const v of state.p) s += v; if (!(s > 0)) throw new RangeError('station posterior vanished'); for (let k = 0; k < state.p.length; k += 1) state.p[k] /= s; return state; }

/** A station's latent-temperature posterior, uniform over the bin of its first reading. */
export function stationFilter(reading, resolution = 1) {
  const center = Math.round(reading), p = new Float64Array(POINTS);
  for (let k = 0; k < POINTS; k += 1) { const x = gridX(center, k); if (x >= reading - resolution / 2 && x < reading + resolution / 2) p[k] = 1; }
  if (!p.some((v) => v > 0)) p[Math.min(POINTS - 1, Math.max(0, Math.floor((reading - center + HALF_SPAN) / STEP)))] = 1;
  return normalize({ center, p });
}

/** Re-center the grid on an integer so the posterior keeps its mass inside the span. */
function recenter(state, center) {
  const shift = Math.round((center - state.center) / STEP);
  if (!shift) return state;
  const p = new Float64Array(POINTS);
  for (let k = 0; k < POINTS; k += 1) { const j = k + shift; if (j >= 0 && j < POINTS) p[k] = state.p[j]; }
  return { center, p };
}

/** Latent motion over an interval: expected change `drift` (C) and a Gaussian step of sd (C). */
export function advance(state, { drift = 0, sd }) {
  if (!(sd > 0)) return state;
  const width = Math.ceil((5 * sd + Math.abs(drift)) / STEP) + 1, kernel = new Float64Array(2 * width + 1);
  for (let d = -width; d <= width; d += 1) kernel[d + width] = normalCdf((d * STEP + STEP / 2 - drift) / sd) - normalCdf((d * STEP - STEP / 2 - drift) / sd);
  const p = new Float64Array(POINTS);
  for (let k = 0; k < POINTS; k += 1) {
    const v = state.p[k];
    if (v < 1e-300) continue;
    for (let d = -width; d <= width; d += 1) { const j = k + d; if (j >= 0 && j < POINTS) p[j] += v * kernel[d + width]; }
  }
  let s = 0; for (const v of p) s += v;
  return s > 1e-300 ? normalize({ center: state.center, p }) : state;
}

/** Condition on a reading at its resolution: P(reading | X) = P(round(X + e) = reading), e ~ N(0, tau^2). */
export function observe(state, reading, tau, resolution = 1) {
  const next = recenter(state, Math.round(reading)), p = new Float64Array(POINTS), half = resolution / 2;
  for (let k = 0; k < POINTS; k += 1) {
    if (!next.p[k]) continue;
    const x = gridX(next.center, k);
    p[k] = next.p[k] * (normalCdf((reading + half - x) / tau) - normalCdf((reading - half - x) / tau));
  }
  let s = 0; for (const v of p) s += v;
  // A reading the posterior thought impossible restarts the station inside its bin rather than failing.
  return s > 1e-300 ? normalize({ center: next.center, p }) : stationFilter(reading, resolution);
}

/** The posterior mean latent temperature of a station. */
export const latentMean = (state) => { let m = 0; for (let k = 0; k < POINTS; k += 1) m += state.p[k] * gridX(state.center, k); return m; };

/**
 * The distribution of the sum, in tenths of a degree C, of the given stations' readings at a common target.
 * Each station: its latent posterior `state`, the `horizon` (minutes) from its own last reading, its expected latent
 * change `shift` (C) over that horizon and the `resolution` it will read at. `commonHorizon` is the horizon over
 * which every station still shares the regional shock (from the latest reading of any of them); a station whose
 * reading is older carries the rest of that shock as its own.
 *
 * The weather's own volatility scales the latent motion: `scale` is its expected level over the horizon (diurnal and
 * recent), and the regime around that level is lognormal with spread `regimeSpread`, integrated by three-point
 * Gauss-Hermite. The mixture gives the sum the heavy tails the stations show (a two-degree move in ten minutes is
 * about one in a hundred, not the Gaussian's never).
 * @returns {{min: number, pmf: Float64Array}} pmf[s - min] = P(sum of tenths = s)
 */
export function sumDistribution(stations, { commonHorizon, sigmaCommon, sigmaStation, sigmaDrift = 0, tau, tauMetar = tau, scale = 1, regimeSpread = 0 }) {
  const hc = Math.max(0, commonHorizon);
  // Sums are kept in units of `base` tenths: whole degrees when every station reads whole degrees.
  const base = stations.every(({ resolution }) => resolution >= 1) ? 10 : 1;
  let total = null, totalMin = 0;
  const regimes = regimeSpread > 0 ? REGIMES : [{ z: 0, w: 1 }];
  for (const regime of regimes) {
  const level = scale * Math.exp(regimeSpread * regime.z), sc = sigmaCommon * level, ss = sigmaStation * level;
  const common = Math.sqrt(sc * sc * hc + sigmaDrift * sigmaDrift * hc * hc);
  const owns = stations.map(({ horizon, resolution }) => {
    const h = Math.max(0, horizon), noise = resolution < 1 ? tauMetar : tau;
    return Math.sqrt(ss * ss * h + sc * sc * Math.max(0, h - hc) + noise * noise);
  });
  for (const { z, w: shockWeight } of GAUSS_HERMITE) {
    const w = shockWeight * regime.w;
    let pmf = Float64Array.of(1), min = 0;
    for (let i = 0; i < stations.length; i += 1) {
      const { state, shift = 0, resolution } = stations[i], sd = owns[i], unit = Math.round(resolution * 10) / base;
      // The station's reading distribution, in tenths, on its own resolution.
      const lo = Math.floor((state.center - HALF_SPAN - 6 + shift) / resolution) * unit;
      const hi = Math.ceil((state.center + HALF_SPAN + 6 + shift) / resolution) * unit;
      const own = new Float64Array((hi - lo) / unit + 1);
      for (let k = 0; k < POINTS; k += 1) {
        const v = state.p[k];
        if (v < 1e-12) continue;
        const mean = gridX(state.center, k) + shift + common * z;
        const c0 = Math.max(lo / unit, Math.floor((mean - 6 * sd) / resolution)), c1 = Math.min(hi / unit, Math.ceil((mean + 6 * sd) / resolution));
        let below = normalCdf(((c0 - 0.5) * resolution - mean) / sd);
        for (let c = c0; c <= c1; c += 1) { const above = normalCdf(((c + 0.5) * resolution - mean) / sd); own[c - lo / unit] += v * (above - below); below = above; }
      }
      let first = 0, last = own.length - 1;
      while (first < last && own[first] < 1e-14) first += 1;
      while (last > first && own[last] < 1e-14) last -= 1;
      const next = new Float64Array(pmf.length + (last - first) * unit);
      for (let a = 0; a < pmf.length; a += 1) { const pa = pmf[a]; if (pa < 1e-15) continue; for (let b = first; b <= last; b += 1) next[a + (b - first) * unit] += pa * own[b]; }
      pmf = next; min += lo + first * unit;
    }
    if (!total) { total = new Float64Array(pmf.length + 2000 / base); totalMin = min - 1000 / base; }
    for (let s = 0; s < pmf.length; s += 1) { const at = s + min - totalMin; if (pmf[s] && at >= 0 && at < total.length) total[at] += w * pmf[s]; }
  }
  }
  let first = 0, last = total.length - 1;
  while (first < last && total[first] < 1e-13) first += 1;
  while (last > first && total[last] < 1e-13) last -= 1;
  const pmf = new Float64Array((last - first) * base + 1);
  let s = 0; for (let k = first; k <= last; k += 1) s += total[k];
  for (let k = first; k <= last; k += 1) pmf[(k - first) * base] = total[k] / s;
  return { min: (totalMin + first) * base, pmf };
}

/**
 * The index law of one calibration ({city_reference_c, stations: [{station_id, weight, offset_c}]}): the index value
 * of a sum of accepted readings (tenths of C) over a set of accepted members. Refuses unequal weights, which the
 * methodology does not use and the lattice cannot represent as one sum.
 */
export function indexLaw(calibration) {
  const offsets = new Map(calibration.stations.map((s) => [s.station_id, s.offset_c]));
  const weight = calibration.stations[0]?.weight;
  if (!calibration.stations.length || calibration.stations.some((s) => Math.abs(s.weight - weight) > 1e-12)) throw new RangeError('the index lattice requires equal member weights');
  const reference = calibration.city_reference_c;
  return Object.freeze({
    version: calibration.config_version,
    members: Object.freeze([...offsets.keys()]),
    /** The published index (F, 0.01) of an accepted set, as a function of the sum of its readings in tenths of C. */
    valueOf(accepted) {
      let offset = 0; for (const id of accepted) { const o = offsets.get(id); if (o === undefined) throw new RangeError(`${id} is not a member`); offset += o; }
      // The same arithmetic as reproduceIndex: the weighted mean of (C - offset + reference), then F.
      return (sumTenths) => Math.round((((sumTenths / 10 - offset + accepted.length * reference) / accepted.length) * 9 / 5 + 32) * 100) / 100;
    },
  });
}

/** The calibration in force at an instant: the latest whose effective time is not after it. */
export function calibrationAt(calibrations, t) {
  let best = null;
  for (const c of calibrations) if (c.effective_at_ms <= t && (!best || c.effective_at_ms > best.effective_at_ms)) best = c;
  return best;
}

/** P(index > strike) for each strike, from an index distribution [{value, p}]. */
export function strikeProbabilities(distribution, strikes) {
  return strikes.map((strike) => {
    let p = 0;
    for (const { value, p: q } of distribution) if (value > strike) p += q;
    return { strike, p: Math.min(1, Math.max(0, p)) };
  });
}

/**
 * The drift predictors of one city, fed every reading as it arrives: each station's recent readings, the diurnal
 * climatology (updated from the one-minute changes it sees) and the guidance. Shared by the tracker and by the fit
 * that estimates the regression on them, so both see the same predictors.
 * @param {number[]} climate diurnal drift prior, C per minute, by local hour (0-23)
 * @param {(t: number) => number} localHour the city's local hour at an instant
 * @param {(station: string, from: number, to: number) => number|null} [guidance] forecast change (C) of a station's
 *   temperature between two instants, from the latest guidance published by `from`
 */
export function createDriftPredictors({ climate, climateVariance = null, localHour, trendMinutes, climateHalfLifeDays = 7, volatilityMinutes = 60, guidance = null }) {
  const diurnal = Float64Array.from({ length: 24 }, (_, h) => climate[h] ?? 0);
  // The mean squared one-minute change of a station's reading by local hour (C^2), kept like the drift climatology,
  // and the city's squared changes over the last volatilityMinutes.
  const variance = Float64Array.from({ length: 24 }, (_, h) => climateVariance?.[h] ?? 0);
  const recent = [];
  // Each local hour is seen 60 minutes a day: the per-minute weight that halves its memory in the half-life.
  const keep = climateHalfLifeDays > 0 ? Math.pow(0.5, 1 / (60 * climateHalfLifeDays)) : 1;
  const histories = new Map();
  let common = new Map();
  const commonFeatures = (t, h) => {
    const key = `${t}:${h}`;
    if (common.has(key)) return common.get(key);
    let rate = 0, n = 0;
    for (const history of histories.values()) {
      const now = history.at(-1); if (!now || now.t < t - 10 * MINUTE || now.t > t) continue;
      const then = history.find((r) => r.t >= now.t - trendMinutes * MINUTE);
      if (!then || now.t - then.t < (trendMinutes / 2) * MINUTE) continue;
      rate += (now.c - then.c) / ((now.t - then.t) / MINUTE); n += 1;
    }
    // The climatology over (t, t + h], an hour segment at a time (every index city keeps whole-hour UTC offsets).
    let clim = 0;
    for (let m = t, end = t + h * MINUTE; m < end;) { const next = Math.min(end, (Math.floor(m / 3_600_000) + 1) * 3_600_000); clim += ((next - m) / MINUTE) * diurnal[localHour(m + 1)]; m = next; }
    const value = [n ? (rate / n) * h : 0, clim];
    common.set(key, value);
    return value;
  };
  return Object.freeze({
    /** Feed one accepted reading (C) of a station at minute t, per station in time order; `members` is how many share a minute. */
    reading(station, t, celsius, members) {
      let history = histories.get(station);
      if (!history) histories.set(station, (history = []));
      const previous = history.at(-1);
      if (previous && t <= previous.t) return;
      if (previous && t - previous.t === MINUTE) {
        // One station's one-minute change is 1/members of the city's: the weight that keeps the hour's memory.
        const hour = localHour(t), k = Math.pow(keep, 1 / Math.max(1, members)), change = celsius - previous.c;
        diurnal[hour] = k * diurnal[hour] + (1 - k) * change;
        variance[hour] = variance[hour] > 0 ? k * variance[hour] + (1 - k) * change * change : change * change;
        recent.push({ t, d2: change * change });
        while (recent.length && recent[0].t <= t - volatilityMinutes * MINUTE) recent.shift();
      }
      history.push({ t, c: celsius });
      while (history.length > 1 && history[0].t < t - (trendMinutes + 30) * MINUTE) history.shift();
      if (common.size) common = new Map();
    },
    /** The predictors at instant t for station over h minutes: [trend x h, climatology over h, guidance change]. */
    features(station, t, h) {
      const [trend, clim] = commonFeatures(t, h), forecast = guidance ? guidance(station, t, t + h * MINUTE) : null;
      return [trend, clim, Number.isFinite(forecast) ? forecast : 0];
    },
    /**
     * The weather's volatility at instant t over h minutes, as ratios: `diurnal`, the root of the hour climatology's
     * variance over the horizon to its daily mean, and `recent`, the root of the last volatilityMinutes' variance to
     * the climatology of this hour (1 when either is not yet known).
     */
    volatility(t, h) {
      let mean = 0; for (const v of variance) mean += v / 24;
      if (!(mean > 0)) return { diurnal: 1, recent: 1 };
      let over = 0, minutes = 0;
      for (let m = t, end = t + Math.max(1, h) * MINUTE; m < end;) { const next = Math.min(end, (Math.floor(m / 3_600_000) + 1) * 3_600_000); over += ((next - m) / MINUTE) * variance[localHour(m + 1)]; minutes += (next - m) / MINUTE; m = next; }
      const now = variance[localHour(t)];
      let r = 0, n = 0; for (const x of recent) if (x.t <= t && x.t > t - volatilityMinutes * MINUTE) { r += x.d2; n += 1; }
      return { diurnal: Math.sqrt(over / minutes / mean), recent: n >= volatilityMinutes / 2 && now > 0 ? Math.sqrt(r / n / now) : 1 };
    },
    diurnal: () => Float64Array.from(diurnal),
    variance: () => Float64Array.from(variance),
  });
}

/** The fitted coefficients of the expected change at horizon h, linear between the fitted horizons. */
export function driftCoefficients(drift, h) {
  const { horizons, coefficients } = drift;
  if (h <= horizons[0]) return coefficients[0];
  for (let i = 1; i < horizons.length; i += 1) {
    if (h <= horizons[i]) { const a = (h - horizons[i - 1]) / (horizons[i] - horizons[i - 1]); return coefficients[i].map((c, j) => (1 - a) * coefficients[i - 1][j] + a * c); }
  }
  return coefficients.at(-1);
}

/**
 * One city's index, tracked reading by reading: the station filters, the drift predictors, and the distribution of
 * the index at any later minute. The same tracker serves research replays and the live market maker.
 * @param {{sigmaCommon: number, sigmaStation: number, sigmaDrift: number, tau: number, tauMetar?: number,
 *   trendMinutes: number, climateHalfLifeDays: number, drift: {horizons: number[], coefficients: number[][]},
 *   volatilityPersistence?: number, regimeSpread?: number}} params
 * @param {number[]} [climateVariance] prior mean squared one-minute change of a station by local hour (C^2)
 * @param {object[]} calibrations the city's published calibrations (live_data/weather/{city}/calibrations)
 */
export function createIndexTracker({ params, climate, climateVariance = null, localHour, calibrations, guidance = null }) {
  const { sigmaCommon, sigmaStation, sigmaDrift = 0, tau, tauMetar = tau, trendMinutes, climateHalfLifeDays, drift, volatilityPersistence = 0, regimeSpread = 0 } = params;
  const predictors = createDriftPredictors({ climate, climateVariance, localHour, trendMinutes, climateHalfLifeDays, guidance });
  // The latent motion's scale over h minutes from t: the hour's level, times recent over usual to a fitted power.
  const scaleOf = (t, h) => { const v = predictors.volatility(t, h); return v.diurnal * Math.pow(Math.min(3, Math.max(1 / 3, v.recent)), volatilityPersistence); };
  const step = Math.sqrt(sigmaCommon ** 2 + sigmaStation ** 2);
  const stations = new Map();
  let latest = null;
  const shiftOf = (id, t, h) => { const f = predictors.features(id.slice(0, 4), t, h), b = driftCoefficients(drift, h); return b[0] * f[0] + b[1] * f[1] + b[2] * f[2]; };
  const law = (t) => { const c = calibrationAt(calibrations, t); return c ? indexLaw(c) : null; };
  const tracker = {
    /**
     * Feed one station's record for minute t as it arrives: {code, celsius, source} (celsius on its resolution when
     * code is 'ok'). Records of a station must come in minute order; a repeated or older minute is ignored.
     */
    observe(id, t, { code, celsius = null, source = null }) {
      const station = stations.get(id) ?? { filter: null, last: null, code: null, source: null };
      if (station.last !== null && t <= station.last) return;
      const accepted = code === 'ok' && Number.isFinite(celsius);
      if (station.filter && station.last !== null) {
        const gap = (t - station.last) / MINUTE;
        station.filter = advance(station.filter, { drift: shiftOf(id, station.last, gap), sd: step * Math.sqrt(gap) * scaleOf(station.last, gap) });
      }
      if (accepted) {
        const resolution = resolutionOf(source);
        station.filter = station.filter ? observe(station.filter, celsius, resolution < 1 ? tauMetar : tau, resolution) : stationFilter(celsius, resolution);
        predictors.reading(id.slice(0, 4), t, celsius, Math.max(1, stations.size));
      }
      Object.assign(station, { last: t, code: accepted ? 'ok' : code, source: accepted ? source : station.source });
      stations.set(id, station);
      if (latest === null || t > latest) latest = t;
    },
    /** The latest minute any station has been observed at, or null. */
    lastMinute: () => latest,
    /** The members accepted at their latest minute: those the index is expected to be computed over. */
    accepted: () => [...stations].filter(([, s]) => s.code === 'ok' && s.filter).map(([id]) => id).sort(),
    /** The distribution of the published index at minute `target` (ms): [{value, p}] by value, or null. */
    distribution(target) {
      const indexLawAt = law(target);
      if (latest === null || !indexLawAt) return null;
      const accepted = tracker.accepted().filter((id) => indexLawAt.members.includes(id));
      if (!accepted.length) return null;
      const inputs = accepted.map((id) => {
        const s = stations.get(id), horizon = Math.max(0, (target - s.last) / MINUTE);
        return { state: s.filter, horizon, shift: shiftOf(id, s.last, horizon), resolution: resolutionOf(s.source) };
      });
      const commonHorizon = Math.max(0, (target - latest) / MINUTE);
      const sum = sumDistribution(inputs, { commonHorizon, sigmaCommon, sigmaStation, sigmaDrift, tau, tauMetar, scale: scaleOf(latest, Math.max(1, commonHorizon)), regimeSpread });
      const value = indexLawAt.valueOf(accepted), out = [];
      for (let k = 0; k < sum.pmf.length; k += 1) if (sum.pmf[k] > 0) out.push({ value: value(sum.min + k), p: sum.pmf[k] });
      return out;
    },
    /** P(index > strike) at minute `target` for each strike, or null. */
    strikes(target, strikes) {
      const distribution = tracker.distribution(target);
      return distribution === null ? null : strikeProbabilities(distribution, strikes);
    },
    predictors,
  };
  return Object.freeze(tracker);
}
