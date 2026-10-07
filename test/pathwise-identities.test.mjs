import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identity, exclusiveIdentity, countIdentity, winConservationIdentity,
  priceIdentity, projectOntoIdentity, pav, repairLadder, ladderExpectation, fee, midOf,
} from '../src/pathwise-identities.mjs';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const book = (bid, ask) => ({ bid, ask });

test('exactly-one family of 3 teams: pricing, fees, edges', () => {
  const idn = exclusiveIdentity({ id: 'x3', tickers: ['A', 'B', 'C'], exhaustive: true });
  assert.deepEqual(idn.payoff, { lo: 1, hi: 1, point: 1 });
  const books = { A: book(0.3, 0.32), B: book(0.3, 0.32), C: book(0.3, 0.32) };
  const r = priceIdentity(idn, books, { theta: 0.07 });
  near(r.sumBids, 0.9); near(r.sumAsks, 0.96); near(r.sumMids, 0.93);
  near(r.feeBuy, 3 * 0.07 * 0.32 * 0.68);
  near(r.cost, 0.96 + 3 * 0.07 * 0.32 * 0.68);
  near(r.buyEdge, 1 - r.cost);
  assert.ok(r.buyEdge < 0 && r.buyEdge > -0.01);            // 0.04 gross edge is eaten by ~0.0457 of fees
  const nofee = priceIdentity(idn, books, { theta: 0 });
  near(nofee.buyEdge, 0.04);
  near(r.midsResidual, -0.07);
  // selling at bids brings 0.9 minus fees: no edge
  assert.ok(r.sellEdge < 0);
  // overpriced family -> sell edge
  const hot = priceIdentity(idn, { A: book(0.4, 0.42), B: book(0.4, 0.42), C: book(0.4, 0.42) });
  assert.ok(hot.sellEdge > 0.1);
  assert.ok(hot.buyEdge < 0);
});

test('non-exhaustive exclusive family only bounds above', () => {
  const idn = exclusiveIdentity({ id: 'x2', tickers: ['A', 'B'], exhaustive: false });
  assert.deepEqual(idn.payoff, { lo: 0, hi: 1, point: 1 });
  const r = priceIdentity(idn, { A: book(0.3, 0.4), B: book(0.3, 0.4) });
  assert.ok(r.buyEdge < 0);                // cannot lock in a payoff of 1 by buying a partial family
  assert.ok(r.sellEdge < 0);               // 0.6 bids < 1
});

test('fees: per-contract formula and per-order cent rounding', () => {
  near(fee(0.5), 0.0175);
  near(fee(0.5, 1, { round: 'cent' }), 0.02);
  near(fee(0.5, 100, { round: 'cent' }), 1.75);
  near(fee(0), 0); near(fee(1), 0);
  assert.equal(midOf({ bid: 0, ask: 1, last: 0.4 }), 0.4);
  assert.equal(midOf({ bid: 0.2, ask: 0.3 }), 0.25);
});

test('negative weights use NO contracts', () => {
  // Y_A - Y_B with A,B exclusive-and-exhaustive-ish: payoff in [-1,1]; here test the NO-leg bookkeeping
  const idn = identity({ id: 'neg', kind: 't', markets: [{ ticker: 'A', weight: 1 }, { ticker: 'B', weight: -1 }], payoff: { lo: 0, hi: 0 } });
  const r = priceIdentity(idn, { A: book(0.5, 0.6), B: book(0.5, 0.6) }, { theta: 0 });
  // buy YES A at 0.6, buy NO B at 1-0.5=0.5 -> cost 1.1, payoff = 0 + shift 1 = 1.0 => edge -0.1
  near(r.cost, 1.1); near(r.buyEdge, -0.1);
  // sell YES A at 0.5, sell NO B at 1-0.6=0.4 -> 0.9 vs 0+1 => -0.1
  near(r.proceeds, 0.9); near(r.sellEdge, -0.1);
});

test('2-team win conservation with a tie bound', () => {
  // T1: 1 win, 2 games left -> rungs 2,3. T2: 0 wins, 2 games left -> rungs 1,2. They play each other twice.
  const teams = [
    { team: 'T1', wins: 1, remaining: 2, rungs: [{ ticker: 'T1-2', k: 2 }, { ticker: 'T1-3', k: 3 }, { ticker: 'T1-4', k: 4 }] },
    { team: 'T2', wins: 0, remaining: 2, rungs: [{ ticker: 'T2-1', k: 1 }, { ticker: 'T2-2', k: 2 }] },
  ];
  const { identity: idn, problems, games, tieCap } = winConservationIdentity({ id: 'wc', teams, maxTieGames: 1 });
  assert.deepEqual(problems, []);
  assert.equal(games, 2); assert.equal(tieCap, 1);
  assert.deepEqual(idn.payoff, { lo: 1, hi: 2, point: 2 }); // 2 games: 2 wins, or 1 if one ties
  assert.equal(idn.markets.length, 4);                       // T1-4 is unreachable and excluded
  assert.equal(idn.ladders.length, 2);
  // Enumerate every world and check the basket payoff is within [lo, hi]; and = 2 when no ties.
  for (const g1 of ['T1', 'T2', 'tie']) for (const g2 of ['T1', 'T2', 'tie']) {
    const w1 = 1 + [g1, g2].filter((x) => x === 'T1').length;
    const w2 = [g1, g2].filter((x) => x === 'T2').length;
    const pay = ['T1-2', 'T1-3'].filter((t) => w1 >= Number(t.split('-')[1])).length
      + ['T2-1', 'T2-2'].filter((t) => w2 >= Number(t.split('-')[1])).length;
    const ties = [g1, g2].filter((x) => x === 'tie').length;
    assert.equal(pay, 2 - ties);
    if (ties <= 1) assert.ok(pay >= idn.payoff.lo && pay <= idn.payoff.hi);
    else assert.ok(pay < idn.payoff.lo); // two ties exceed the stated bound of 1: the bound is the assumption
  }
  // hard bound defaults to every remaining game tying
  const hard = winConservationIdentity({ id: 'wc2', teams }).identity;
  assert.deepEqual(hard.payoff, { lo: 0, hi: 2, point: 2 });
  // pricing: asks sum under the lower bound => buy edge; sum over hi => sell edge
  const cheap = priceIdentity(idn, { 'T1-2': book(0.1, 0.2), 'T1-3': book(0.1, 0.2), 'T2-1': book(0.1, 0.2), 'T2-2': book(0.1, 0.2) }, { theta: 0 });
  near(cheap.buyEdge, 1 - 0.8); near(cheap.buyEdgePoint, 2 - 0.8);
  // missing rung widens the interval and is reported
  const gap = winConservationIdentity({ id: 'g', teams: [teams[0], { ...teams[1], rungs: [{ ticker: 'T2-2', k: 2 }] }], maxTieGames: 0 });
  assert.equal(gap.problems.length, 1);
  assert.deepEqual(gap.identity.payoff, { lo: 1, hi: 2, point: 2 });
});

test('projection satisfies the constraint and stays in the box', () => {
  const idn = exclusiveIdentity({ id: 'p', tickers: ['A', 'B', 'C'], exhaustive: true });
  const r = projectOntoIdentity({ A: 0.5, B: 0.3, C: 0.4 }, idn);
  near(r.residual, 0, 1e-9);
  near(Object.values(r.p).reduce((s, x) => s + x, 0), 1, 1e-9);
  // unweighted simplex shift: subtract (1.2-1)/3 from each
  near(r.p.A, 0.5 - 0.2 / 3); near(r.p.C, 0.4 - 0.2 / 3);
  assert.ok(r.feasible);
  near(r.maxMove, 0.2 / 3);
  // clipping engages: tiny mid stays at 0, the others absorb the shift
  const c = projectOntoIdentity({ A: 0.95, B: 0.95, C: 0.02 }, idn);
  near(c.residual, 0, 1e-9);
  assert.ok(c.p.C >= 0 && c.p.C < 0.02);
  for (const v of Object.values(c.p)) assert.ok(v >= -1e-12 && v <= 1 + 1e-12);
});

function brute(m, w, c, step, boxOnly = true) {
  // brute-force nearest point on {sum w p = c} in [0,1]^n by grid; the last coordinate is solved from the constraint
  const n = m.length;
  let best = Infinity, arg = null;
  const rec = (i, p, acc) => {
    if (i === n - 1) {
      const last = (c - acc) / w[n - 1];
      if (last < -1e-12 || last > 1 + 1e-12) return;
      const q = [...p, Math.min(1, Math.max(0, last))];
      const d = q.reduce((s, x, j) => s + (x - m[j]) ** 2, 0);
      if (d < best) { best = d; arg = q; }
      return;
    }
    for (let v = 0; v <= 1 + 1e-12; v += step) rec(i + 1, [...p, v], acc + w[i] * v);
  };
  rec(0, [], 0);
  return { best, arg };
}

test('projection is the nearest point: matches a brute-force grid in 2 and 3 dimensions', () => {
  const cases = [
    { m: [0.7, 0.6], w: [1, 1], c: 1 },
    { m: [0.9, 0.8], w: [1, 1], c: 1 },
    { m: [0.2, 0.1, 0.9], w: [1, 1, 1], c: 1 },
    { m: [0.6, 0.55, 0.5], w: [1, 1, 1], c: 1 },
    { m: [0.05, 0.9, 0.95], w: [1, 1, 1], c: 1 },
    { m: [0.4, 0.8, 0.7], w: [1, 2, 0.5], c: 1.2 },
    { m: [0.1, 0.1, 0.1], w: [1, 1, 1], c: 2 },
  ];
  for (const { m, w, c } of cases) {
    const idn = identity({ id: 'b', kind: 't', markets: m.map((_, i) => ({ ticker: `t${i}`, weight: w[i] })), payoff: { lo: c, hi: c } });
    const r = projectOntoIdentity(m, idn);
    const { best } = brute(m, w, c, 0.005);
    assert.ok(r.feasible);
    near(Object.values(r.p).reduce((s, x, i) => s + w[i] * x, 0), c, 1e-9);
    assert.ok(r.distance ** 2 <= best + 1e-9, `analytic ${r.distance ** 2} should not exceed grid ${best}`);
    assert.ok(best - r.distance ** 2 < 2e-3, `grid ${best} close to analytic ${r.distance ** 2}`);
  }
});

test('projection reports infeasible targets and clamps', () => {
  const idn = identity({ id: 'inf', kind: 't', markets: [{ ticker: 'a' }, { ticker: 'b' }], payoff: { lo: 3, hi: 3 } });
  const r = projectOntoIdentity({ a: 0.5, b: 0.5 }, idn);
  assert.equal(r.feasible, false);
  near(r.p.a, 1); near(r.p.b, 1);
});

test('interval target: no move inside [lo,hi], nearest endpoint outside', () => {
  const idn = identity({ id: 'iv', kind: 't', markets: [{ ticker: 'a' }, { ticker: 'b' }], payoff: { lo: 0.8, hi: 1 } });
  const inside = projectOntoIdentity({ a: 0.45, b: 0.4 }, idn, { target: 'interval' });
  near(inside.maxMove, 0);
  const above = projectOntoIdentity({ a: 0.7, b: 0.6 }, idn, { target: 'interval' });
  near(above.p.a + above.p.b, 1);
  const below = projectOntoIdentity({ a: 0.3, b: 0.3 }, idn, { target: 'interval' });
  near(below.p.a + below.p.b, 0.8);
});

test('PAV ladder repair', () => {
  assert.deepEqual(pav([1, 2, 3], { decreasing: false }), [1, 2, 3]);
  const inc = pav([3, 1, 2], { decreasing: false });
  assert.deepEqual(inc, [2, 2, 2]);
  const dec = pav([0.9, 0.5, 0.6, 0.2, 0.3], { decreasing: true });
  near(dec[0], 0.9); near(dec[1], 0.55); near(dec[2], 0.55); near(dec[3], 0.25); near(dec[4], 0.25);
  for (let i = 1; i < dec.length; i++) assert.ok(dec[i] <= dec[i - 1] + 1e-12);
  // exact projection: beats every other monotone candidate on a grid (3 points)
  const y = [0.4, 0.7, 0.5];
  const r = repairLadder(y);
  const d = (a) => a.reduce((s, x, i) => s + (x - y[i]) ** 2, 0);
  let best = Infinity;
  for (let a = 0; a <= 1.0001; a += 0.01) for (let b = 0; b <= a + 1e-9; b += 0.01) for (let c = 0; c <= b + 1e-9; c += 0.01) best = Math.min(best, d([a, b, c]));
  assert.ok(d(r) <= best + 1e-9);
  // box clipping after isotonic fit
  assert.deepEqual(repairLadder([1.3, 1.2, -0.2]), [1, 1, 0]);
});

test('joint ladder + sum projection: monotone, sums to target, and nearest', () => {
  // one team ladder with a violation; weights 1, target 1.5
  const tickers = ['k1', 'k2', 'k3'];
  const idn = identity({ id: 'l', kind: 'win-conservation', markets: tickers.map((t) => ({ ticker: t })), payoff: { lo: 1.5, hi: 1.5 }, ladders: [tickers] });
  const mids = { k1: 0.8, k2: 0.5, k3: 0.6 };
  const r = projectOntoIdentity(mids, idn);
  near(r.residual, 0, 1e-9);
  assert.ok(r.p.k1 >= r.p.k2 - 1e-9 && r.p.k2 >= r.p.k3 - 1e-9);
  near(r.p.k1 + r.p.k2 + r.p.k3, 1.5, 1e-9);
  // brute force over monotone grid points on the constraint plane
  let best = Infinity;
  const m = [0.8, 0.5, 0.6];
  for (let a = 0; a <= 1.0001; a += 0.005) for (let b = 0; b <= a + 1e-9; b += 0.005) {
    const c = 1.5 - a - b;
    if (c < -1e-12 || c > b + 1e-9) continue;
    best = Math.min(best, (a - m[0]) ** 2 + (b - m[1]) ** 2 + (c - m[2]) ** 2);
  }
  assert.ok(r.distance ** 2 <= best + 1e-9);
  assert.ok(best - r.distance ** 2 < 2e-3);
  // without ladder handling the sum is satisfied but monotonicity is not
  const nl = projectOntoIdentity(mids, idn, { ladders: false });
  assert.ok(nl.p.k3 > nl.p.k2);
});

test('ladderExpectation: complete and sparse ladders', () => {
  const full = ladderExpectation([{ k: 1, p: 0.9 }, { k: 2, p: 0.5 }, { k: 3, p: 0.1 }]);
  near(full.lo, 1.5); near(full.hi, 1.5); near(full.point, 1.5); assert.ok(full.complete);
  // sparse: rungs at 2 and 5 listed within 1..6
  const s = ladderExpectation([{ k: 2, p: 0.8 }, { k: 5, p: 0.2 }], { kMin: 1, kMax: 6 });
  // k=1: [0.8,1]; k=3,4: [0.2,0.8]; k=6: [0,0.2]
  near(s.lo, 0.8 + 0.8 + 0.2 + 0.2 + 0.2 + 0);
  near(s.hi, 1 + 0.8 + 0.8 + 0.8 + 0.2 + 0.2);
  assert.ok(s.lo <= s.point && s.point <= s.hi);
  assert.equal(s.unlisted, 4); assert.equal(s.complete, false);
  // non-monotone input is repaired first
  const v = ladderExpectation([{ k: 1, p: 0.4 }, { k: 2, p: 0.6 }]);
  near(v.point, 1.0);
});

test('count identity', () => {
  const idn = countIdentity({ id: 'c', tickers: ['a', 'b', 'c', 'd'], slots: 2, complete: true });
  assert.deepEqual(idn.payoff, { lo: 2, hi: 2, point: 2 });
  assert.throws(() => identity({ id: 'e', kind: 'x', markets: [{ ticker: 'a' }, { ticker: 'a' }], payoff: { lo: 0, hi: 1 } }));
});
