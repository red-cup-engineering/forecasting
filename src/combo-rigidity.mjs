/**
 * Combo rigidity: which parts of a parlay its leg markets PIN, and which they leave free to FLEX.
 *
 * A game's final score x = (away, home) lives on the integer quadrant. Every Kalshi game-line
 * contract is an indicator of a region cut out by lines of four directions: the winner (x_t > x_o),
 * the spread (x_t - x_o >= N), the team total (x_t >= N), the game total (x_0 + x_1 >= N), and BTTS.
 * Kalshi spells each as a team code plus an integer N meaning ">= N" (strike N - 0.5, "greater").
 * One approximation: an NFL game tie settles each winner market at $0.50, which no indicator carries;
 * the lattice prices the tie cell as NO for both (ties are a fraction of a percent of NFL games).
 * The cells of that line arrangement are the atoms; a belief is a measure q on the cells; a leg's
 * live book [bid, ask] is a local section, the interval its measure must fall in.
 *
 * The flex interval of a parlay B is [min q(B), max q(B)] over every q every leg book admits. LP
 * duality makes each end a price: the max is the cost of the cheapest leg portfolio whose payoff
 * dominates 1_B in every cell (a super-hedge), the min the proceeds of the richest portfolio
 * dominated by it (a sub-hedge). The hedge is a certificate any verifier can check cell by cell
 * without trusting the solver (`verifyHedge`): the prover hands it over, the verifier checks it.
 * A parlay printing above the super-hedge is overpriced against its own legs whatever the dependence
 * between them; one printing below the sub-hedge is underpriced. Inside the interval the legs are
 * silent and only a model (the copula in combo-pricer.mjs) or evidence speaks.
 *
 * Rigidity. The interval collapses to a point exactly when 1_B lies in the span of the quoted
 * indicators. Counting quotes against cells is not enough to decide that, which is the double banana
 * of rigidity theory: two games each pinned by their own winner markets satisfy the count (a full
 * matching of quotes to cells, `pebbleCount`) yet the pair flexes about the hinge of their dependence,
 * because the two games' normalisations are one relation counted twice. `rigidity` reports the count
 * and the true rank side by side; only the rank (or the LP) decides.
 *
 * Verdict. The claim "this parlay is worth at most P" reads on two told sides: supported when a
 * super-hedge costs <= P, refuted when a sub-hedge sells for > P. Neither side is told inside the
 * flex; both are told when the legs themselves admit no measure (a Dutch book among the legs). The
 * point is read through four.mjs; more quoted legs only shrink the interval, so verdicts only climb
 * the knowledge order as evidence arrives, in any order.
 */
import { readingOfSides } from '@red-cup-engineering/computer-data-services-section/four';
import { legMeta, teamSide } from './combo-pricer.mjs';
import { solveLP } from './simplex.mjs';

/** Sports whose final score cannot be level (overtime, extra innings, shootouts settle a winner). */
const NO_DRAW = new Set(['NBA', 'WNBA', 'NCAAB', 'MLB', 'NHL']);
const EPS = 1e-9;

/**
 * The region of the score quadrant a leg's YES side names, or null when the leg is not a function of
 * the final score (player props, period totals): such a leg is priced by Fréchet bounds only.
 * @returns {{test: (x: number[]) => boolean, bound: number, key: string}|null}
 */
/** The market kinds that are functions of the final score; a period or exact-score kind only shares a role suffix. */
const FINAL_KINDS = { W: new Set(['GAME', 'MATCH', 'FIGHT']), S: new Set(['SPREAD']), T: new Set(['TOTAL']), TT: new Set(['TEAMTOTAL']), B: new Set(['BTTS']) };

export function scoreRegion(meta) {
  const { role, kind, suffix } = meta;
  if (!FINAL_KINDS[role]?.has(kind)) return null;
  if (role === 'W') {
    if (suffix === 'TIE') return { test: (x) => x[0] === x[1], bound: 1, key: 'tie' };
    const t = teamSide(meta);
    return t === null ? null : { test: (x) => x[t] > x[1 - t], bound: 1, key: `win${t}` };
  }
  if (role === 'B') return { test: (x) => x[0] >= 1 && x[1] >= 1, bound: 1, key: 'btts' };
  const m = /^([A-Z]*)(\d+)$/u.exec(suffix ?? '');
  if (!m) return null;
  const n = Number(m[2]);
  if (role === 'T') return { test: (x) => x[0] + x[1] >= n, bound: n, key: `tot${n}` };
  const t = teamSide(meta);
  if (t === null) return null;
  if (role === 'S') return { test: (x) => x[t] - x[1 - t] >= n, bound: n, key: `spr${t}:${n}` };
  if (role === 'TT') return { test: (x) => x[t] >= n, bound: n, key: `tt${t}:${n}` };
  return null;
}

/**
 * The atoms of the arrangement the regions cut: one cell per realisable sign vector, with a witness
 * score. Thresholds are at most B, so every sign vector is realised inside [0, 3B]^2 (shift both scores
 * down while each stays >= B, then clip the margin at 2B: no predicate changes).
 * @returns {{cells: {witness: number[]}[], member: number[][]}} member[i] = cells inside region i
 */
export function scoreCells(regions, { noDraw = false } = {}) {
  const B = Math.max(2, ...regions.map((r) => r.bound));
  const top = 3 * B + 2;
  const index = new Map(); const cells = [];
  for (let a = 0; a <= top; a += 1) for (let h = 0; h <= top; h += 1) {
    if (noDraw && a === h) continue;
    const x = [a, h];
    const sig = regions.map((r) => (r.test(x) ? '1' : '0')).join('');
    if (!index.has(sig)) { index.set(sig, cells.length); cells.push({ witness: x, sig }); }
  }
  const member = regions.map((_, i) => cells.flatMap((c, k) => (c.sig[i] === '1' ? [k] : [])));
  return { cells, member };
}

/** The arrangement depends only on which regions are cut: parlays on one game's books share it. */
const arrangements = new Map();
function cachedCells(regions, noDraw) {
  const key = `${noDraw}|${regions.map((r) => r.key).join(',')}`;
  let hit = arrangements.get(key);
  if (!hit) {
    if (arrangements.size >= 512) arrangements.delete(arrangements.keys().next().value);
    hit = scoreCells(regions, { noDraw }); arrangements.set(key, hit);
  }
  return hit;
}

/** Indicator of a set of cell indices over n cells. */
const indicator = (n, set) => { const v = new Array(n).fill(0); for (const k of set) v[k] = 1; return v; };

/**
 * The flex interval of a target cell set under quoted markets, with both certificates.
 * @param {number} nCells
 * @param {{cells: number[], lo: number, hi: number}[]} markets  lo = best bid (0 when none), hi = best ask (1 when none)
 * @param {number[]} target  cells where the parlay pays
 * @returns {{coherent: boolean, lo?: number, hi?: number, superHedge?: object, subHedge?: object}}
 */
export function flexInterval(nCells, markets, target) {
  const rows = [{ a: new Array(nCells).fill(1), op: '=', b: 1, m: -1 }];
  markets.forEach((mk, i) => {
    const a = indicator(nCells, mk.cells);
    if (mk.lo > EPS) rows.push({ a, op: '>=', b: mk.lo, m: i, price: mk.lo });
    if (mk.hi < 1 - EPS) rows.push({ a, op: '<=', b: mk.hi, m: i, price: mk.hi });
  });
  const c = indicator(nCells, target);
  const up = solveLP({ c, rows });
  if (up.status === 'infeasible') return { coherent: false };
  const down = solveLP({ c: c.map((v) => -v), rows });
  // super-hedge: y itself (cash + signed units per quoted side); sub-hedge: the negated dual of the min
  const hedge = (y, sign) => {
    const positions = [];
    rows.forEach((r, i) => { if (r.m >= 0 && Math.abs(y[i]) > 1e-10) positions.push({ market: r.m, units: sign * y[i], price: r.price }); });
    return { cash: sign * y[0], positions };
  };
  return { coherent: true, lo: -down.objective, hi: up.objective, superHedge: hedge(up.y, 1), subHedge: hedge(down.y, -1) };
}

/**
 * The verifier's check of a hedge, independent of the solver: its payoff in every cell against the
 * parlay's, and its value recomputed from the quoted prices.
 * @param {'super'|'sub'} direction
 * @returns {{valid: boolean, value: number, worstSlack: number}}
 */
export function verifyHedge(nCells, markets, target, hedge, direction) {
  const pays = indicator(nCells, target);
  const payoff = new Array(nCells).fill(hedge.cash);
  for (const p of hedge.positions) for (const k of markets[p.market].cells) payoff[k] += p.units;
  const slack = payoff.map((v, k) => (direction === 'super' ? v - pays[k] : pays[k] - v));
  const worstSlack = Math.min(...slack);
  const value = hedge.cash + hedge.positions.reduce((s, p) => s + p.units * p.price, 0);
  return { valid: worstSlack >= -1e-7, value, worstSlack };
}

/**
 * The FOUR reading of "the parlay is worth at most `price`" against its legs: supported by a
 * super-hedge costing at most the price, refuted by a sub-hedge selling above it.
 */
export function priceReading(interval, price) {
  if (!interval.coherent) return readingOfSides('knowledge', true, true);
  return readingOfSides('knowledge', interval.hi <= price + EPS, interval.lo > price + EPS);
}

// ---------------------------------------------------------------- rigidity: count versus rank

/**
 * The count: a pebble game on the quote-cell incidence. Each cell holds one pebble; each quoted row
 * (and the normalisation row) must take a pebble from a cell it covers, moving pebbles along
 * alternating paths when its cells are taken. The pebbles placed are the rows' generic rank, which
 * equals the true rank only when no relation among the indicators is forced by the sport's geometry.
 */
export function pebbleCount(nCells, rowSets) {
  const owner = new Array(nCells).fill(-1);
  const take = (r, seen) => {
    for (const k of rowSets[r]) {
      if (seen[k]) continue;
      seen[k] = true;
      if (owner[k] < 0 || take(owner[k], seen)) { owner[k] = r; return true; }
    }
    return false;
  };
  let placed = 0;
  for (let r = 0; r < rowSets.length; r += 1) if (take(r, new Array(nCells).fill(false))) placed += 1;
  return placed;
}

/** Rank of a set of 0/1 vectors by Gaussian elimination, and whether `probe` lies in their span. */
export function spanRank(vectors, probe = null) {
  const basis = [];
  const reduce = (v) => {
    const w = v.slice();
    for (const { pivot, row } of basis) if (Math.abs(w[pivot]) > EPS) { const f = w[pivot]; for (let j = 0; j < w.length; j += 1) w[j] -= f * row[j]; }
    return w;
  };
  for (const v of vectors) {
    const w = reduce(v);
    const pivot = w.findIndex((x) => Math.abs(x) > 1e-7);
    if (pivot < 0) continue;
    const f = w[pivot]; const row = w.map((x) => x / f);
    for (const b of basis) if (Math.abs(b.row[pivot]) > EPS) { const g = b.row[pivot]; for (let j = 0; j < row.length; j += 1) b.row[j] -= g * row[j]; }
    basis.push({ pivot, row });
  }
  return { rank: basis.length, inSpan: probe ? reduce(probe).every((x) => Math.abs(x) < 1e-7) : null };
}

/**
 * Count versus rank for a quoted system over n cells. `countRigid` is what counting promises;
 * `rigid` (a unique measure) and `targetPinned` (the parlay's price is a point) are what holds.
 * flexDimension = cells - rank is the number of independent hinges the quotes leave free.
 */
export function rigidity(nCells, marketCells, target = null) {
  const rows = [Array.from({ length: nCells }, (_, k) => k), ...marketCells];
  const count = pebbleCount(nCells, rows);
  const { rank, inSpan } = spanRank(rows.map((s) => indicator(nCells, s)), target ? indicator(nCells, target) : null);
  return { cells: nCells, count, rank, countRigid: count === nCells, rigid: rank === nCells, flexDimension: nCells - rank, targetPinned: inSpan };
}

// ---------------------------------------------------------------- one game, then a parlay

/**
 * The flex interval of the legs of one game, given every book quoted on that game.
 * @param {{ticker: string, event?: string, side: 'yes'|'no'}[]} legs  this game's parlay legs
 * @param {{ticker: string, event?: string, bid: number|null, ask: number|null}[]} books  quoted markets of the game
 * @returns {{coherent: boolean, lo: number, hi: number, modelled: number, free: number, nCells: number, rigidity: object}}
 */
export function gameInterval(legs, books) {
  const metaOf = (x) => legMeta(x.ticker, x.event);
  const legMetas = legs.map(metaOf);
  const sport = legMetas[0]?.sport;
  const quoted = books.map((b) => ({ ...b, region: scoreRegion(metaOf(b)) })).filter((b) => b.region);
  const legRegions = legMetas.map(scoreRegion);
  const regions = [...quoted.map((b) => b.region), ...legRegions.filter(Boolean)];
  const { cells, member } = cachedCells(regions, NO_DRAW.has(sport));
  const n = cells.length;
  const markets = quoted.map((b, i) => ({ cells: member[i], lo: b.bid ?? 0, hi: b.ask ?? 1 }));
  // the parlay's score part: cells where every modelled leg's chosen side holds
  let target = new Set(cells.map((_, k) => k)); let j = quoted.length;
  legs.forEach((l, i) => {
    if (!legRegions[i]) return;
    const inside = new Set(member[j]); j += 1;
    target = new Set([...target].filter((k) => (l.side === 'yes') === inside.has(k)));
  });
  const iv = flexInterval(n, markets, [...target]);
  if (!iv.coherent) return { coherent: false, lo: 0, hi: 1, modelled: legRegions.filter(Boolean).length, free: 0, nCells: n };
  // legs not a function of the score: Fréchet bounds against the score part (their dependence is unquoted)
  const free = legs.filter((_, i) => !legRegions[i]).map((l) => {
    const b = books.find((x) => x.ticker === l.ticker);
    const yesLo = b?.bid ?? 0; const yesHi = b?.ask ?? 1;
    return l.side === 'yes' ? [yesLo, yesHi] : [1 - yesHi, 1 - yesLo];
  });
  const k = free.length;
  const lo = Math.max(0, iv.lo + free.reduce((s, [a]) => s + a, 0) - k);
  const hi = Math.min(iv.hi, ...free.map(([, b]) => b));
  return { coherent: true, lo, hi, scoreLo: iv.lo, scoreHi: iv.hi, modelled: legRegions.filter(Boolean).length, free: k, nCells: n, superHedge: iv.superHedge, subHedge: iv.subHedge, rigidity: rigidity(n, markets.map((m) => m.cells), [...target]) };
}

/**
 * A parlay's interval at two hinge settings. `pinned`: games independent (product of the games'
 * intervals), a physical assumption no quote certifies. `free`: dependence between games unquoted
 * (Fréchet over the games' intervals), the only interval a static leg hedge certifies.
 */
export function parlayInterval(legs, booksByGame) {
  const games = new Map();
  for (const l of legs) { const g = legMeta(l.ticker, l.event).game; (games.get(g) ?? games.set(g, []).get(g)).push(l); }
  const parts = [...games].map(([game, gl]) => ({ game, ...gameInterval(gl, booksByGame.get(game) ?? []) }));
  const coherent = parts.every((p) => p.coherent);
  const pinned = [parts.reduce((s, p) => s * p.lo, 1), parts.reduce((s, p) => s * p.hi, 1)];
  const free = [Math.max(0, parts.reduce((s, p) => s + p.lo, 0) - (parts.length - 1)), Math.min(...parts.map((p) => p.hi))];
  return { coherent, games: parts.length, parts, pinned, free };
}

// ---------------------------------------------------------------- coherence projection (Brier)

/**
 * The Brier projection of quoted probabilities onto the coherent set: the measure q on the cells whose
 * induced prices A q are nearest the quotes m in squared distance. For Brier (a Bregman score) this
 * projection strictly dominates an incoherent quote vector in EVERY outcome, not on average (Predd,
 * Seiringer, Lieb, Osherson, Poor and Kulkarni 2009, "Probabilistic coherence and proper scoring
 * rules"): the scored family's Brier sum falls by at least ||m - Aq||^2 whatever happens. Solved by
 * pairwise Frank-Wolfe on the simplex of cells (linear convergence on a polytope); the vertex oracle is
 * the cell of least gradient, so no LP is needed.
 * @param {number} nCells
 * @param {number[][]} marketCells  member cells of each quoted market
 * @param {number[]} m  quoted probabilities (mids)
 * @returns {{q: number[], prices: number[], distance2: number, gap: number}}
 */
export function brierProjection(nCells, marketCells, m, { iterations = 20000, tolerance = 1e-12 } = {}) {
  const K = m.length;
  const cellMarkets = Array.from({ length: nCells }, () => []);
  marketCells.forEach((cells, i) => { for (const c of cells) cellMarkets[c].push(i); });
  // pairwise Frank-Wolfe: move weight from the worst active cell to the best cell, with exact line search
  const q = new Float64Array(nCells);
  let start = 0; let startD = Infinity;
  for (let c = 0; c < nCells; c += 1) {
    const on = new Set(cellMarkets[c]); let d = 0;
    for (let i = 0; i < K; i += 1) d += ((on.has(i) ? 1 : 0) - m[i]) ** 2;
    if (d < startD) { startD = d; start = c; }
  }
  q[start] = 1;
  const Aq = new Float64Array(K); for (const i of cellMarkets[start]) Aq[i] = 1;
  const active = new Set([start]);
  const grad = (c, r) => { let g = 0; for (const i of cellMarkets[c]) g += r[i]; return g; };
  let gap = Infinity;
  for (let t = 0; t < iterations; t += 1) {
    const r = Aq.map((x, i) => x - m[i]);
    let k = 0; let gk = Infinity;
    for (let c = 0; c < nCells; c += 1) { const g = grad(c, r); if (g < gk) { gk = g; k = c; } }
    let a = -1; let ga = -Infinity;
    for (const c of active) { const g = grad(c, r); if (g > ga) { ga = g; a = c; } }
    // Wolfe gap over the active set bounds the distance to the optimum
    gap = r.reduce((s, x, i) => s + x * Aq[i], 0) - gk;
    if (ga - gk <= tolerance || a === k) break;
    // direction e_k - e_a in price space: +1 on markets of k, -1 on markets of a
    const d = new Float64Array(K);
    for (const i of cellMarkets[k]) d[i] += 1;
    for (const i of cellMarkets[a]) d[i] -= 1;
    const dd = d.reduce((s, x) => s + x * x, 0);
    if (dd <= 0) break;
    const step = Math.min(q[a], Math.max(0, (ga - gk) / dd));
    q[k] += step; q[a] -= step;
    if (q[a] <= 1e-15) { q[a] = 0; active.delete(a); }
    active.add(k);
    for (let i = 0; i < K; i += 1) Aq[i] += step * d[i];
  }
  const prices = [...Aq];
  return { q: [...q], prices, distance2: prices.reduce((s, x, i) => s + (x - m[i]) ** 2, 0), gap };
}
