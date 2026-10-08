/**
 * The forecast surface: the house's one probability for each Kalshi contract, from every model the house
 * runs on it, anchored on the market. Pure.
 *
 * Why anchored: the market's mid is itself a forecast, and settlement grading shows it beats every house
 * model that has not been admitted (weather, 2026-10-06/07: every model's Brier was worse than the mid).
 * A model therefore moves the surface only once its own settlement grades admit it (weather-learning
 * probabilityBand: date-clustered Brier improvement over the mid with a positive lower bound). More
 * models can then only add information; a model that is merely different adds nothing.
 *
 *   structural  bounds that hold in every world the rules allow: a recorded extreme rules a bracket out.
 *               They need no track record and always clip the surface. Only the kinds in STRUCTURAL_KINDS
 *               count: a model's bounds conditional on its own forecast (weather-temperature-extremes'
 *               Frechet bounds over hourly marginals) are a forecast, and are graded like one.
 *   admitted    models graded better than the mid. The surface is the logit pool of the mid and each
 *               admitted model, equally weighted; its band pools their calibration bands the same way.
 *
 * Without an admitted model or a structural bound the surface is the mid with a zero-width band, which
 * no executable price beats: the desk trades only what the house knows better than the book.
 */
const EPS = 1e-4;
const clamp = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));
const expit = (x) => 1 / (1 + Math.exp(-x));
const pool = (ps) => expit(ps.reduce((s, p) => s + logit(p), 0) / ps.length);

export const STRUCTURAL_KINDS = Object.freeze(['station-observation']);

/** A model's structural bounds when they are of a structural kind, bind, and are valid. */
export function structuralBounds(model) {
  const s = model.details?.structuralProbabilityBounds;
  if (!s || !STRUCTURAL_KINDS.includes(s.kind) || !Number.isFinite(s.low) || !Number.isFinite(s.high) || s.low < 0 || s.high > 1 || s.low > s.high) return null;
  return s.low > 0 || s.high < 1 ? s : null;
}

/**
 * @param {{mid: number|null, models: {id: string, p: number, band?: {admitted: boolean, low: number, high: number}, details?: object}[]}} input
 * @returns {{p: number, low: number, high: number, mid: number|null, admitted: string[], structural: string[]} | null}
 *   null when nothing informs the contract, or when structural bounds contradict each other.
 */
export function fuseForecast({ mid, models }) {
  let low = 0, high = 1;
  const structural = [];
  for (const model of models) {
    const s = structuralBounds(model);
    if (!s) continue;
    low = Math.max(low, s.low); high = Math.min(high, s.high); structural.push(model.id);
  }
  if (low > high) return null;
  const admitted = models.filter((m) => m.band?.admitted && Number.isFinite(m.p) && !structuralBounds(m));
  const market = Number.isFinite(mid) ? [mid] : [];
  if (!market.length && !admitted.length && !structural.length) return null;
  const point = market.length || admitted.length ? pool([...market, ...admitted.map((m) => m.p)]) : (low + high) / 2;
  const p = Math.min(high, Math.max(low, point));
  // The statistical band: each admitted model contributes its calibration band, the market its point.
  const bandLow = admitted.length ? pool([...market, ...admitted.map((m) => m.band.low)]) : p;
  const bandHigh = admitted.length ? pool([...market, ...admitted.map((m) => m.band.high)]) : p;
  return {
    p, low: Math.max(low, Math.min(p, bandLow)), high: Math.min(high, Math.max(p, bandHigh)),
    mid: market[0] ?? null, admitted: admitted.map((m) => m.id), structural,
  };
}

/**
 * The executable edge of a surface against a book, per contract, after the taker fee at `count`.
 * Buying YES at the ask wins with probability at least `low`; selling YES at the bid (holding NO) wins
 * with probability at least 1 - `high`.
 * @param {{low: number, high: number}} surface
 * @param {{bid: number|null, ask: number|null}} book dollars on the YES side
 * @param {(price: number) => number} feePerContract
 */
export function surfaceEdges(surface, { bid, ask }, feePerContract) {
  const out = [];
  if (Number.isFinite(ask) && ask > 0 && ask < 1) out.push({ side: 'yes', bookSide: 'bid', price: ask, winProbability: surface.low, edge: surface.low - ask - feePerContract(ask) });
  if (Number.isFinite(bid) && bid > 0 && bid < 1) out.push({ side: 'no', bookSide: 'ask', price: bid, winProbability: 1 - surface.high, edge: bid - surface.high - feePerContract(1 - bid) });
  return out;
}
