import test from 'node:test';
import assert from 'node:assert/strict';
import { windowOf, spotMarginal, correlationFromReturns, jointFair, barMean } from '../src/crypto-joint.mjs';
import { mulberry32, PhiInv } from '../src/combo-pricer.mjs';

test('windowOf parses EDT close and open', () => {
  const w = windowOf('KXBTC15M-26OCT040045-45');
  assert.equal(w.asset, 'BTC');
  assert.equal(new Date(w.closeMs).toISOString(), '2026-10-04T04:45:00.000Z');
  assert.equal(new Date(w.openMs).toISOString(), '2026-10-04T04:30:00.000Z');
  assert.equal(new Date(windowOf('KXHYPE15M-26OCT031630-30').closeMs).toISOString(), '2026-10-03T20:30:00.000Z');
  assert.equal(new Date(windowOf('KXNEAR15M-26OCT030015-15').openMs).toISOString(), '2026-10-03T04:00:00.000Z');
  assert.equal(windowOf('KXBTC15M-26OCT040045-30'), null); // suffix must be the close minute
  assert.equal(windowOf('KXNFLGAME-26OCT04ARINYG-NYG'), null);
});

test('windowOf uses EST after the November change', () => {
  assert.equal(new Date(windowOf('KXETH15M-26NOV011200-00').closeMs).toISOString(), '2026-11-01T17:00:00.000Z');
  assert.equal(new Date(windowOf('KXETH15M-26OCT311200-00').closeMs).toISOString(), '2026-10-31T16:00:00.000Z');
});

test('spotMarginal limits', () => {
  const base = { ref: 100, sigmaPerMin: 0.001 };
  assert.equal(spotMarginal({ ...base, S_t: 100.5, minutesLeft: 0 }), 1);
  assert.equal(spotMarginal({ ...base, S_t: 99.5, minutesLeft: 0 }), 0);
  assert.equal(spotMarginal({ ...base, S_t: 100, minutesLeft: 0 }), 1); // ties resolve YES (>=)
  assert.ok(spotMarginal({ ...base, S_t: 110, minutesLeft: 10 }) > 0.999999);
  assert.ok(spotMarginal({ ...base, S_t: 90, minutesLeft: 10 }) < 1e-6);
  assert.ok(Math.abs(spotMarginal({ ...base, S_t: 100, minutesLeft: 15, refKnown: false }) - 0.5) < 1e-12);
  const near = spotMarginal({ ...base, S_t: 100.05, minutesLeft: 5 });
  const far = spotMarginal({ ...base, S_t: 100.05, minutesLeft: 14 });
  assert.ok(near > far && far > 0.5);
});

test('correlationFromReturns recovers synthetic correlation without lookahead', () => {
  const rnd = mulberry32(7); const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const N = 4000; const rho = 0.7; const s = { A: [], B: [], C: [] }; let pa = 100; let pb = 50; let pc = 10;
  for (let i = 0; i < N; i += 1) {
    const z1 = gauss(); const z2 = gauss(); const z3 = gauss();
    pa *= Math.exp(0.001 * z1); pb *= Math.exp(0.002 * (rho * z1 + Math.sqrt(1 - rho * rho) * z2)); pc *= Math.exp(0.003 * z3);
    const t = i * 60000; for (const [k, p] of [['A', pa], ['B', pb], ['C', pc]]) s[k].push([t, p, p, p, p]);
  }
  const r = correlationFromReturns(s, N * 60000, 3000);
  assert.ok(Math.abs(r.rho[0][1] - rho) < 0.05, `rho ${r.rho[0][1]}`);
  assert.ok(Math.abs(r.rho[0][2]) < 0.05);
  assert.ok(Math.abs(r.sigma.B - 0.002) < 0.0002);
  // no lookahead: a huge jump after endMs must not change the estimate
  const s2 = { A: s.A.map((b) => b.slice()), B: s.B.map((b) => b.slice()), C: s.C.map((b) => b.slice()) };
  const cut = 2000 * 60000;
  const before = correlationFromReturns(s2, cut, 1440);
  for (const k of Object.keys(s2)) for (const b of s2[k]) if (b[0] >= cut) { b[4] *= 5; }
  const after = correlationFromReturns(s2, cut, 1440);
  assert.deepEqual(before.rho, after.rho);
  assert.equal(barMean([0, 1, 3, 1, 3]), 2);
});

test('jointFair: product at rho=0, comonotone at rho->1, anti-comonotone for opposite sides', () => {
  const mk = (R) => ({ assets: ['A', 'B'], rho: R });
  const legs = [{ asset: 'A', side: 'yes' }, { asset: 'B', side: 'yes' }];
  const m = [0.6, 0.3];
  const ind = jointFair(legs, m, mk([[1, 0], [0, 1]]), { samples: 20000 });
  assert.ok(Math.abs(ind - 0.18) < 0.01, `ind ${ind}`);
  const hi = jointFair(legs, m, mk([[1, 0.999], [0.999, 1]]), { samples: 20000 });
  assert.ok(Math.abs(hi - 0.3) < 0.02, `hi ${hi}`); // min(0.6, 0.3)
  const opp = jointFair([{ asset: 'A', side: 'yes' }, { asset: 'B', side: 'no' }], m, mk([[1, 0.999], [0.999, 1]]), { samples: 20000 });
  assert.ok(Math.abs(opp - 0.3) < 0.02, `opp ${opp}`); // comonotone Z: P(Z high and Z low) = max(0, 0.6 + 0.7 - 1)
  assert.ok(PhiInv(0.5) === 0);
});
