import test from 'node:test';
import assert from 'node:assert/strict';
import { normMarket, buildConstraints, checkConstraints, projectMids, projectQP } from '../src/prop-identities.mjs';
import { pav } from '../src/pathwise-identities.mjs';

let seq = 0;
const mk = (ticker, bid, ask, extra = {}) => normMarket({
  ticker, yes_bid_dollars: String(bid), yes_ask_dollars: String(ask), yes_bid_size_fp: '10', yes_ask_size_fp: '10',
  strike_type: extra.rung != null ? 'greater' : 'structured', floor_strike: extra.rung != null ? extra.rung - 0.5 : undefined, yes_sub_title: extra.sub ?? '',
}, { feeMultiplier: extra.fm ?? 1 });
const ladder = (series, key, game, prices) => prices.map(([b, a], i) => mk(`${series}-${game}-${key}-${i + 1}`, b, a, { rung: i + 1 }));
const byT = (ms) => new Map(ms.map((m) => [m.ticker, m]));

test('normMarket parses rung, key, role', () => {
  const m = mk('KXNFLTD-26OCT08TBDAL-DALCLAMB88-2', 0.1, 0.2, { rung: 2 });
  assert.equal(m.rung, 2); assert.equal(m.key, 'DALCLAMB88'); assert.equal(m.role, 'rung'); assert.equal(m.game, '26OCT08TBDAL'); assert.ok(Math.abs(m.mid - 0.15) < 1e-12);
  assert.equal(mk('KXNFLFIRSTTD-26OCT08TBDAL-TBNO-TD', 0, 0.01, { sub: 'No Touchdown' }).role, 'notd');
  assert.equal(mk('KXNFLFIRSTTD-26OCT08TBDAL-DALCLAMB88', 0.1, 0.2).role, 'first');
});

test('ladder constraints: adjacent rungs only, violation priced net of fee', () => {
  const ms = ladder('KXNFLRECYDS', 'DALCLAMB88', 'G', [[0.5, 0.52], [0.3, 0.32], [0.6, 0.62]]); // rung3 bid 0.60 > rung2 ask 0.32
  const cs = buildConstraints(ms);
  assert.equal(cs.filter((c) => c.kind === 'ladder').length, 2);
  const r = checkConstraints(cs, byT(ms));
  const bad = r.find((x) => x.id.endsWith(':3<=2'));
  const fees = 0.07 * 0.6 * 0.4 + 0.07 * 0.32 * 0.68;
  assert.ok(Math.abs(bad.edge - (0.6 - 0.32 - fees)) < 1e-12);
  assert.ok(bad.edge > 0 && bad.executable && bad.depth === 10);
  assert.ok(r.find((x) => x.id.endsWith(':2<=1')).edge < 0);
});

test('fee multiplier scales theta (MLB 0.5)', () => {
  const ms = ladder('KXMLBHIT', 'CWSMV20', 'G', [[0.3, 0.32], [0.6, 0.62]]).map((m) => ({ ...m, theta: 0.035 }));
  const r = checkConstraints(buildConstraints(ms), byT(ms))[0];
  assert.ok(Math.abs(r.edge - (0.6 - 0.32 - 0.035 * 0.6 * 0.4 - 0.035 * 0.32 * 0.68)) < 1e-12);
});

test('MLB implications HR=>HIT, TB>=4, HRR>=3; TB=>HIT ceil(k/4)', () => {
  const g = 'G', k = 'P1';
  const ms = [...ladder('KXMLBHR', k, g, [[0.1, 0.12], [0.01, 0.02]]), ...ladder('KXMLBHIT', k, g, [[0.5, 0.52], [0.2, 0.22]]),
    ...ladder('KXMLBTB', k, g, [[0.5, 0.52], [0.3, 0.32], [0.2, 0.22], [0.14, 0.16], [0.1, 0.12]]), ...ladder('KXMLBHRR', k, g, [[0.7, 0.72], [0.6, 0.62], [0.5, 0.52]])];
  const ids = buildConstraints(ms).filter((c) => c.kind === 'implication').map((c) => c.id);
  assert.ok(ids.includes('impl:KXMLBHR1=>KXMLBHIT1:P1'));
  assert.ok(ids.includes('impl:KXMLBHR1=>KXMLBTB4:P1'));
  assert.ok(ids.includes('impl:KXMLBHR1=>KXMLBHRR3:P1'));
  assert.ok(ids.includes('impl:KXMLBHR2=>KXMLBHIT2:P1'));
  assert.ok(ids.includes('impl:KXMLBHR2=>KXMLBTB5:P1')); // 8 bases -> tightest listed rung 5
  assert.ok(ids.includes('impl:KXMLBTB5=>KXMLBHIT2:P1')); // ceil(5/4)=2
  assert.ok(ids.includes('impl:KXMLBTB4=>KXMLBHIT1:P1'));
});

test('NHL goal/assist => points, and Frechet sum', () => {
  const g = 'G', k = 'P';
  const ms = [...ladder('KXNHLGOAL', k, g, [[0.3, 0.32], [0.05, 0.06]]), ...ladder('KXNHLAST', k, g, [[0.4, 0.42], [0.1, 0.12]]), ...ladder('KXNHLPTS', k, g, [[0.5, 0.52], [0.2, 0.22], [0.02, 0.03]])];
  const cs = buildConstraints(ms);
  assert.ok(cs.some((c) => c.id === 'impl:KXNHLGOAL1=>KXNHLPTS1:P'));
  const sum = cs.filter((c) => c.kind === 'sum');
  assert.equal(sum.length, 3); // (1,1)->2 (1,2)->3 (2,1)->3 ; (2,2)->4 not listed
});

test('NBA PRA Frechet: P>=a, R>=b, A>=c => PRA>=a+b+c', () => {
  const g = 'G', k = 'P';
  const ms = [...ladder('KXNBAPTS', k, g, [[0.9, 0.92]]), ...ladder('KXNBAREB', k, g, [[0.8, 0.82]]), ...ladder('KXNBAAST', k, g, [[0.7, 0.72]]), ...ladder('KXNBAPRA', k, g, [[0.1, 0.12], [0.1, 0.12], [0.1, 0.12]])];
  const c = buildConstraints(ms).find((x) => x.kind === 'sum' && x.id.startsWith('sum:KXNBAPRA3'));
  assert.ok(c); assert.equal(c.rhs, 2);
  const r = checkConstraints([c], byT(ms))[0];
  // sell P,R,A at bids (0.9+0.8+0.7), buy PRA3 at ask 0.12; payout <= 2 + ... edge before fees = 2.4 - 0.12 - 2 - 1*0 ... = 0.28
  const fees = 0.07 * (0.9 * 0.1 + 0.8 * 0.2 + 0.7 * 0.3 + 0.12 * 0.88);
  assert.ok(Math.abs(r.edge - (0.9 + 0.8 + 0.7 - 0.12 - 2 - fees)) < 1e-12);
});

test('first TD: exclusive family, No TD, first<=anytime', () => {
  const g = '26OCT08TBDAL';
  const ms = [mk(`KXNFLFIRSTTD-${g}-A1`, 0.5, 0.52), mk(`KXNFLFIRSTTD-${g}-B2`, 0.4, 0.42), mk(`KXNFLFIRSTTD-${g}-TBNO-TD`, 0.05, 0.06, { sub: 'No Touchdown' }),
    mk(`KXNFLTD-${g}-A1-1`, 0.3, 0.32, { rung: 1 }), mk(`KXNFLTD-${g}-B2-1`, 0.9, 0.92, { rung: 1 })];
  const cs = buildConstraints(ms);
  const ex = cs.find((c) => c.kind === 'exclusive');
  assert.equal(ex.terms.length, 3);
  const r = checkConstraints(cs, byT(ms));
  assert.ok(r.find((x) => x.id.startsWith('excl')).edge < 0); // bids sum to 0.95 <= 1: no book
  ms[0].bid = 0.6; // bids now 1.05 > 1: sell all three
  const r2 = checkConstraints(cs, byT(ms)).find((x) => x.id.startsWith('excl'));
  const f = (p) => 0.07 * p * (1 - p);
  assert.ok(Math.abs(r2.edge - (1.05 - 1 - f(0.6) - f(0.4) - f(0.05))) < 1e-12);
  assert.ok(checkConstraints(cs, byT(ms)).some((x) => x.id.startsWith('first<=any') && x.edge < 0));
  const w = checkConstraints(cs, byT(ms)).find((x) => x.id.startsWith('notd'));
  assert.ok(w.edge < 0);
});

test('projectQP equals PAV on a ladder (exact)', () => {
  const y = [0.3, 0.5, 0.4, 0.45, 0.1, 0.2];
  const rows = y.slice(1).map((_, i) => ({ idx: [i + 1, i], w: [1, -1], b: 0 }));
  const r = projectQP(y, rows);
  const p = pav(y, { decreasing: true });
  assert.ok(r.converged);
  r.x.forEach((v, i) => assert.ok(Math.abs(v - p[i]) < 1e-8, `${i}: ${v} vs ${p[i]}`));
});

test('projectQP exclusive family: sum<=1 simplex-style shift, box respected', () => {
  const m = [0.6, 0.5, 0.3];
  const r = projectQP(m, [{ idx: [0, 1, 2], w: [1, 1, 1], b: 1 }]);
  const shift = (1.4 - 1) / 3;
  r.x.forEach((v, i) => assert.ok(Math.abs(v - (m[i] - shift)) < 1e-8));
  const r2 = projectQP([0.9, 0.9, 0.0], [{ idx: [0, 1, 2], w: [1, 1, 1], b: 1 }]);
  assert.ok(Math.abs(r2.x[0] - 0.5) < 1e-8 && r2.x[2] >= -1e-12 && Math.abs(r2.x.reduce((a, b) => a + b) - 1) < 1e-8);
});

test('projection never increases Euclidean distance to a feasible point (Pythagoras) and satisfies constraints', () => {
  const g = 'G', k = 'P';
  const ms = [...ladder('KXMLBHR', k, g, [[0.4, 0.42], [0.1, 0.12]]), ...ladder('KXMLBHIT', k, g, [[0.2, 0.22], [0.3, 0.32]])];
  const cs = buildConstraints(ms);
  const { proj, converged } = projectMids(ms, cs);
  assert.ok(converged);
  for (const c of cs) assert.ok(c.terms.reduce((s, t) => s + t.w * proj.get(t.ticker), 0) <= c.rhs + 1e-9, c.id);
  const feasible = new Map(ms.map((m) => [m.ticker, 0.1]));
  const d = (a, b) => ms.reduce((s, m) => s + (a.get(m.ticker) - b.get(m.ticker)) ** 2, 0);
  const mid = new Map(ms.map((m) => [m.ticker, m.mid]));
  assert.ok(d(proj, feasible) <= d(mid, feasible) + 1e-12);
});
