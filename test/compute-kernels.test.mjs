import test from 'node:test';
import assert from 'node:assert/strict';
import { mvnLowerProb } from '../src/combo-pricer.mjs';
import { KERNELS, makeMvnBatch, unpackMvn, packMvn, prepareMvn, makeGradBatch, gradReference, NMAX } from '../src/compute/kernels.mjs';

test('K1 reference is mvnLowerProb problem by problem (fixed seed)', () => {
  const batch = makeMvnBatch(24, { seed: 3, samples: 600 });
  const ref = KERNELS['mvn-orthant'].reference(batch);
  for (let i = 0; i < batch.P; i += 1) {
    const { b, R } = unpackMvn(batch, i);
    assert.equal(ref[i], mvnLowerProb(b, R, { samples: 600, seed: batch.seed }).p);
  }
  assert.ok(ref.every((p) => p >= 0 && p <= 1));
});

test('K1 pack/unpack round trips dimensions 2..9 and handles degenerate inputs', () => {
  const batch = makeMvnBatch(60, { seed: 5, samples: 200 });
  assert.deepEqual([...new Set(batch.n)].sort(), [2, 3, 4, 5, 6, 7, 8, 9]);
  const odd = packMvn([{ b: [], R: [] }, { b: [-Infinity, 0], R: [[1, 0], [0, 1]] }, { b: [0.3], R: [[1]] }], { samples: 100 });
  const ref = KERNELS['mvn-orthant'].reference(odd);
  assert.equal(ref[0], 1); assert.equal(ref[1], 0); assert.ok(Math.abs(ref[2] - 0.6179) < 1e-3);
  const prep = prepareMvn(odd);
  assert.deepEqual([...prep.mode], [0, 0, 0]); // all three resolved on the host
  assert.equal(prep.fixed[0], 1); assert.equal(prep.fixed[1], 0);
  assert.equal(NMAX, 9);
});

test('K1 host preparation sends indefinite matrices through the same shrink as the reference', () => {
  const bad = packMvn([{ b: [0, 0, 0], R: [[1, 0.99, -0.99], [0.99, 1, 0.99], [-0.99, 0.99, 1]] }], { samples: 100 });
  const prep = prepareMvn(bad);
  assert.equal(prep.mode[0], 1); // shrunk to positive definite, then sampled
  assert.ok(prep.L[0] > 0);
});

test('K2 reference equals the brierProjection gradient definition', () => {
  const batch = makeGradBatch(3, { seed: 2, cells: 8, markets: 5 });
  const g = gradReference(batch);
  for (let f = 0; f < 3; f += 1) for (let c = 0; c < 8; c += 1) {
    let s = 0; for (let k = 0; k < 5; k += 1) s += batch.A[(f * 8 + c) * 5 + k] * batch.r[f * 5 + k];
    assert.ok(Math.abs(g[f * 8 + c] - s) < 1e-12);
  }
});

test('slice/concat partition a batch without changing the answer', () => {
  for (const k of Object.values(KERNELS)) {
    const batch = k.make(10, { seed: 9 });
    const whole = k.reference(batch);
    const parts = [k.slice(batch, 0, 4), k.slice(batch, 4, 10)].map((b) => k.reference(b));
    assert.deepEqual([...k.concat(parts)], [...whole]);
  }
});
