// Pathwise identities for Kalshi sports markets.
//
// A pathwise identity is a basket of contracts whose total payoff lies in a known
// interval [lo, hi] in EVERY world the rules of the sport allow -- a statement about
// the rulebook (14 playoff slots, one division winner, 17-game schedule), not about a
// model. When lo == hi the basket is a constant: any price away from it (net of fees)
// is arbitrage. When lo < hi (ties, voids, unlisted participants) only the one-sided
// edges against lo (buy) and hi (sell) are riskless; the "point" payoff is the
// no-exception constant and is reported separately.
//
// This module is pure: no I/O, no clock, no network.

const EPS = 1e-12;
const clip01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------- identity

/**
 * @param {{id:string, kind:string, markets:{ticker:string,weight?:number}[],
 *          payoff:{lo:number,hi:number,point?:number}, ladders?:string[][],
 *          rule?:string, note?:string}} spec
 *   `ladders`: groups of tickers ordered by ascending rung k, whose probabilities
 *   must be non-increasing (P(W>=k+1) <= P(W>=k)).
 */
import { THETA, feePerContract, orderFee } from './fees.mjs';
export function identity(spec) {
  const { id, kind, markets, payoff } = spec;
  if (!id || typeof id !== 'string') throw new Error('identity: id required');
  if (!Array.isArray(markets) || markets.length === 0) throw new Error(`identity ${id}: markets required`);
  const seen = new Set();
  const ms = markets.map((m) => {
    const weight = m.weight === undefined ? 1 : m.weight;
    if (!m.ticker || !Number.isFinite(weight)) throw new Error(`identity ${id}: bad market ${JSON.stringify(m)}`);
    if (seen.has(m.ticker)) throw new Error(`identity ${id}: duplicate ticker ${m.ticker}`);
    seen.add(m.ticker);
    return { ticker: m.ticker, weight };
  });
  if (!payoff || !Number.isFinite(payoff.lo) || !Number.isFinite(payoff.hi) || payoff.lo > payoff.hi + EPS) {
    throw new Error(`identity ${id}: payoff needs finite lo <= hi`);
  }
  const point = payoff.point === undefined ? payoff.hi : payoff.point;
  if (point < payoff.lo - EPS || point > payoff.hi + EPS) throw new Error(`identity ${id}: point outside [lo,hi]`);
  const ladders = (spec.ladders || []).map((g) => g.slice());
  for (const g of ladders) for (const t of g) if (!seen.has(t)) throw new Error(`identity ${id}: ladder ticker ${t} not in markets`);
  return {
    id, kind, markets: ms,
    payoff: { lo: payoff.lo, hi: payoff.hi, point },
    ladders, rule: spec.rule || '', note: spec.note || '',
  };
}

/** Exactly-one family. exhaustive: the listed outcomes cover every world => [1,1], else [0,1]. */
export function exclusiveIdentity({ id, kind = 'exclusive', tickers, exhaustive, rule, note, settledYes = 0 }) {
  const c = 1 - settledYes;
  return identity({
    id, kind, markets: tickers.map((ticker) => ({ ticker })),
    payoff: exhaustive ? { lo: c, hi: c } : { lo: 0, hi: c, point: c }, rule, note,
  });
}

/** "k of the listed teams qualify" family. complete: every team that can qualify is listed. */
export function countIdentity({ id, kind = 'count', tickers, slots, complete, rule, note }) {
  return identity({
    id, kind, markets: tickers.map((ticker) => ({ ticker })),
    payoff: complete ? { lo: slots, hi: slots } : { lo: 0, hi: slots, point: slots }, rule, note,
  });
}

/**
 * Win conservation over a league whose teams each carry an "at least k wins" ladder.
 * team: { team, wins, remaining, rungs:[{ticker,k}] } where wins = decided wins so far and
 * remaining = games the team has still to play. For a team, the rungs k = wins+1..wins+remaining
 * sum (pathwise) to its FUTURE wins. Summing over the league, future wins = (decided-free games)
 * = sum(remaining)/2 minus the number of future tied games (a tie gives neither team a win).
 *
 * Tie bound: hard rule bound is maxTieGames = games remaining (every game could tie); callers may
 * pass a smaller stated assumption. payoff = [G - maxTieGames - missingRungs, G], point = G.
 * A rung that is in range but not listed can only lower the basket payoff by at most 1 each.
 * Returns { identity, problems } -- problems lists coverage defects (missing/extra rungs).
 */
export function winConservationIdentity({ id, teams, maxTieGames, rule, note }) {
  const problems = [];
  const markets = [];
  const ladders = [];
  let remainingSlots = 0;
  let missing = 0;
  for (const t of teams) {
    remainingSlots += t.remaining;
    const byK = new Map(t.rungs.map((r) => [r.k, r.ticker]));
    const ladder = [];
    for (let k = t.wins + 1; k <= t.wins + t.remaining; k++) {
      const tk = byK.get(k);
      if (tk === undefined) { missing++; problems.push(`${t.team}: rung ${k} not open`); continue; }
      markets.push({ ticker: tk, weight: 1 });
      ladder.push(tk);
    }
    if (ladder.length > 1) ladders.push(ladder);
    for (const r of t.rungs) {
      if (r.k > t.wins + t.remaining) continue; // beyond reach: pays 0 in every world, ignored
      if (r.k <= t.wins) problems.push(`${t.team}: rung ${r.k} <= decided wins ${t.wins} still open`);
    }
  }
  const games = remainingSlots / 2;
  if (!Number.isInteger(games)) problems.push(`remaining team-games ${remainingSlots} is odd`);
  const tieCap = maxTieGames === undefined ? Math.floor(games) : Math.min(maxTieGames, Math.floor(games));
  const spec = {
    id, kind: 'win-conservation', markets, ladders,
    payoff: { lo: Math.max(0, games - tieCap - missing), hi: games, point: games }, rule, note,
  };
  return { identity: identity(spec), problems, games, tieCap };
}

// ---------------------------------------------------------------- pricing

/** Kalshi taker fee for `qty` contracts at price p: theta*qty*p*(1-p); round 'cent' = ceil to the cent per order. */
export function fee(p, qty = 1, { theta = THETA, round = 'none' } = {}) {
  if (round === 'cent' && Number.isInteger(qty)) return orderFee(qty, p, { multiplier: theta / THETA });
  return feePerContract(p, { multiplier: theta / THETA }) * qty;
}

/** Mid of a {bid, ask, last?} book in dollars. A book with both sides empty (0 / 1) falls back to last, else 0.5. */
export function midOf(book) {
  if (!book) return null;
  const bid = book.bid ?? 0;
  const ask = book.ask ?? 1;
  if (bid <= 0 && ask >= 1) return book.last != null && book.last > 0 ? book.last : 0.5;
  return (bid + ask) / 2;
}

/**
 * Price a basket. Positive weight w: long w YES contracts. Negative weight: |w| NO contracts
 * (a NO contract pays 1-Y, costs 1-bid, sells at 1-ask), so the constant payoff is shifted by
 * the sum of |negative weights|.
 *
 * buy:  pay asks (+fee) for the long side, hold to settle, receive >= payoff.lo (+shift).
 * sell: take bids (-fee), owe <= payoff.hi (+shift).
 * buyEdge = payoff.lo - cost ; sellEdge = proceeds - payoff.hi ; the *Point variants use the
 * no-exception constant. Positive edge = riskless profit at top-of-book, one lot per market.
 */
export function priceIdentity(idn, books, { theta = THETA, feeRound = 'none' } = {}) {
  const fo = { theta, round: feeRound };
  let cost = 0, proceeds = 0, feeBuy = 0, feeSell = 0;
  let sumBids = 0, sumMids = 0, sumAsks = 0, shift = 0, missing = 0, spread = 0;
  let minBidSize = Infinity, minAskSize = Infinity; // whole baskets executable at top of book: min over legs of size/|w|
  const mids = {};
  for (const m of idn.markets) {
    const b = books[m.ticker];
    if (!b) missing++;
    const bid = b?.bid ?? 0;
    const ask = b?.ask ?? 1;
    const mid = midOf(b) ?? 0.5;
    mids[m.ticker] = mid;
    const w = m.weight;
    if (w !== 0 && b) {
      // long legs sell into the bid / buy at the ask; NO legs are the mirror image
      const sellSz = w > 0 ? b.bidSize : b.askSize, buySz = w > 0 ? b.askSize : b.bidSize;
      if (sellSz != null) minBidSize = Math.min(minBidSize, sellSz / Math.abs(w));
      if (buySz != null) minAskSize = Math.min(minAskSize, buySz / Math.abs(w));
    }
    sumBids += w * bid; sumAsks += w * ask; sumMids += w * mid; spread += Math.abs(w) * (ask - bid);
    if (w >= 0) {
      cost += w * ask; feeBuy += fee(ask, w, fo);
      proceeds += w * bid; feeSell += fee(bid, w, fo);
    } else {
      const q = -w; shift += q;
      cost += q * (1 - bid); feeBuy += fee(1 - bid, q, fo);
      proceeds += q * (1 - ask); feeSell += fee(1 - ask, q, fo);
    }
  }
  const { lo, hi, point } = idn.payoff;
  const totalCost = cost + feeBuy;
  const netProceeds = proceeds - feeSell;
  return {
    id: idn.id, n: idn.markets.length, missing,
    sumBids, sumMids, sumAsks, mids,
    cost: totalCost, proceeds: netProceeds, feeBuy, feeSell,
    payoff: idn.payoff,
    buyEdge: lo + shift - totalCost,
    sellEdge: netProceeds - (hi + shift),
    buyEdgePoint: point + shift - totalCost,
    sellEdgePoint: netProceeds - (point + shift),
    midsResidual: sumMids - point, // sum of w*mid minus the payoff point
    avgSpread: spread / idn.markets.length,
    minBidSize: Number.isFinite(minBidSize) ? minBidSize : null, // baskets sellable at top of book
    minAskSize: Number.isFinite(minAskSize) ? minAskSize : null, // baskets buyable at top of book
  };
}

// ---------------------------------------------------------------- isotonic repair

/**
 * Pool-adjacent-violators. Returns the Euclidean (weighted) projection of `y` onto the cone of
 * non-increasing sequences (decreasing=true, the "at least k" ladder shape) or non-decreasing.
 * This is exact: PAV solves min sum w_i (x_i - y_i)^2 s.t. monotone.
 */
export function pav(y, { decreasing = true, weights } = {}) {
  const n = y.length;
  const v = decreasing ? y.map((x) => -x) : y.slice(); // work non-decreasing
  const w = weights ? weights.slice() : new Array(n).fill(1);
  const val = [], wt = [], cnt = [];
  for (let i = 0; i < n; i++) {
    val.push(v[i]); wt.push(w[i]); cnt.push(1);
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1] + 0) {
      const j = val.length - 1;
      const tw = wt[j - 1] + wt[j];
      val[j - 1] = (val[j - 1] * wt[j - 1] + val[j] * wt[j]) / tw;
      wt[j - 1] = tw; cnt[j - 1] += cnt[j];
      val.pop(); wt.pop(); cnt.pop();
    }
  }
  const out = [];
  for (let b = 0; b < val.length; b++) for (let c = 0; c < cnt[b]; c++) out.push(decreasing ? -val[b] : val[b]);
  return out;
}

/**
 * Exact projection onto { non-increasing } intersect [0,1]^n: clip(PAV(y)). (Bounded isotonic
 * regression: clipping the unconstrained isotonic fit to the box is optimal because the box
 * constraint is a lattice constraint compatible with the order -- see Barlow et al. 1972.)
 */
export function repairLadder(y) {
  return pav(y, { decreasing: true }).map(clip01);
}

// ---------------------------------------------------------------- projection

/**
 * Brier (Euclidean) projection of `mids` onto C = { p in [0,1]^n : sum w_i p_i = c } intersect
 * { ladder groups non-increasing }.
 *
 * Lagrangian: p(lam) = Pi_M( m - lam*w ) where Pi_M is the exact projection onto the monotone box
 * set M (per-ladder clip(PAV); singletons are plain clips). g(lam) = w . p(lam) is continuous and
 * non-increasing in lam (monotonicity of a projection), so the multiplier is found by bisection and
 * the result is the EXACT Euclidean projection onto C, not an approximation. Ladder repair and the
 * weighted shift are therefore solved JOINTLY: doing PAV first and shifting after would not preserve
 * monotonicity once clipping engages; shifting first and PAV after would break the sum constraint.
 *
 * opts.target: 'point' (default; the no-exception constant payoff.point), 'interval' (nearest point of
 * [lo,hi]: no move if the repaired mids already satisfy it), or a number.
 * mids: array aligned to idn.markets or {ticker: mid}.
 */
export function projectOntoIdentity(mids, idn, { target = 'point', ladders = true, iters = 200 } = {}) {
  const n = idn.markets.length;
  const m = Array.isArray(mids) ? mids.slice() : idn.markets.map((x) => mids[x.ticker]);
  if (m.some((x) => !Number.isFinite(x))) throw new Error('projectOntoIdentity: non-finite mid');
  const w = idn.markets.map((x) => x.weight);
  const idx = new Map(idn.markets.map((x, i) => [x.ticker, i]));
  const groups = [];
  const inLadder = new Set();
  if (ladders) for (const g of idn.ladders) { const gi = g.map((t) => idx.get(t)); groups.push(gi); gi.forEach((i) => inLadder.add(i)); }

  const proj = (lam) => {
    const z = m.map((x, i) => x - lam * w[i]);
    const p = new Array(n);
    for (let i = 0; i < n; i++) if (!inLadder.has(i)) p[i] = clip01(z[i]);
    for (const g of groups) { const r = repairLadder(g.map((i) => z[i])); g.forEach((i, j) => { p[i] = r[j]; }); }
    return p;
  };
  const dot = (p) => p.reduce((s, x, i) => s + w[i] * x, 0);

  const base = proj(0);
  const baseSum = dot(base);
  const { lo, hi, point } = idn.payoff;
  let c;
  if (typeof target === 'number') c = target;
  else if (target === 'interval') c = baseSum < lo ? lo : baseSum > hi ? hi : baseSum;
  else c = point;

  // Feasible range of the constraint over C: g(+inf) .. g(-inf)
  const big = 2 + n;
  const gMin = dot(proj(big)), gMax = dot(proj(-big));
  let feasible = true;
  if (c < gMin - 1e-9) { c = gMin; feasible = false; }
  if (c > gMax + 1e-9) { c = gMax; feasible = false; }

  let p = base, lam = 0;
  if (Math.abs(baseSum - c) > 1e-13) {
    let a = -big, b = big; // g(a) >= c >= g(b)
    for (let it = 0; it < iters; it++) {
      lam = (a + b) / 2;
      const gv = dot(proj(lam));
      if (gv > c) a = lam; else b = lam;
      if (b - a < 1e-15) break;
    }
    lam = (a + b) / 2;
    p = proj(lam);
  }
  let worst = { ticker: null, move: 0 };
  const moves = {};
  idn.markets.forEach((x, i) => {
    const mv = p[i] - m[i];
    moves[x.ticker] = mv;
    if (Math.abs(mv) > Math.abs(worst.move)) worst = { ticker: x.ticker, move: mv };
  });
  return {
    p: Object.fromEntries(idn.markets.map((x, i) => [x.ticker, p[i]])),
    lambda: lam, target: c, feasible, residual: dot(p) - c,
    maxMove: Math.abs(worst.move), worst, moves,
    distance: Math.sqrt(p.reduce((s, x, i) => s + (x - m[i]) ** 2, 0)),
  };
}

// ---------------------------------------------------------------- ladder expectation

/**
 * E[W] - kMin + 1 ... precisely: sum_{k=kMin}^{kMax} P(W >= k), from a (possibly sparse) "at least k"
 * ladder. rungs: [{k, p}]. Unlisted rungs are bounded by their listed neighbours (P(W>=k) is
 * non-increasing in k): between listed a<k<b, p_b <= P <= p_a; below the first listed, P in [p_first, 1];
 * above the last listed, P in [0, p_last]. `point` linearly interpolates unlisted rungs
 * (tails: 1 below, 0 above). With a complete ladder lo == point == hi == the sum of the prices.
 * Add the wins already decided to turn this into E[W]. kMax defaults to the largest listed k.
 * Listed values are first repaired with PAV so the bounds are consistent.
 */
export function ladderExpectation(rungs, { kMin = 1, kMax } = {}) {
  const r = rungs.filter((x) => x.k >= kMin).sort((a, b) => a.k - b.k);
  if (r.length === 0) {
    const K = kMax === undefined ? kMin - 1 : kMax;
    const n = Math.max(0, K - kMin + 1);
    return { lo: 0, point: n / 2, hi: n, listed: 0, unlisted: n, complete: n === 0 };
  }
  const top = kMax === undefined ? r[r.length - 1].k : Math.max(kMax, r[r.length - 1].k);
  const fixed = pav(r.map((x) => x.p), { decreasing: true }).map(clip01);
  const pk = new Map(r.map((x, i) => [x.k, fixed[i]]));
  let lo = 0, hi = 0, point = 0, unlisted = 0;
  for (let k = kMin; k <= top; k++) {
    if (pk.has(k)) { const v = pk.get(k); lo += v; hi += v; point += v; continue; }
    unlisted++;
    let prev = null, next = null;
    for (const x of r) { if (x.k < k) prev = x; else if (x.k > k && next === null) next = x; }
    const pa = prev ? pk.get(prev.k) : 1; // upper bound from the left neighbour
    const pb = next ? pk.get(next.k) : 0; // lower bound from the right neighbour
    lo += pb; hi += pa;
    const ka = prev ? prev.k : kMin - 1, kb = next ? next.k : top + 1;
    point += pa + ((pb - pa) * (k - ka)) / (kb - ka);
  }
  return { lo, point, hi, listed: r.length, unlisted, complete: unlisted === 0 };
}
