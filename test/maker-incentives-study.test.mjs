import test from 'node:test';
import assert from 'node:assert/strict';
import { lipSide, lipPairShare, feeOf, jackknife, restBid } from '../scripts/maker-incentives-study.mjs';

test('lone full-size quoter takes the whole side and an empty side is excluded', () => {
  const r = lipSide([], 1000, 0.5, { p: 0.4, size: 1000 });
  assert.equal(r.qualified, true); assert.equal(r.share, 1);
  assert.equal(lipSide([], 1000, 0.5, { p: 0.4, size: 500 }).qualified, false);
  assert.equal(lipPairShare([], [], 1000, 0.5, { p: 0.4, size: 1000 }, null).share, 0);
});

test('distance discount: one tick below the reference price halves weight at d=0.5', () => {
  // competitor 1000 at 0.50 fills target; we add 1000 at 0.49 but target is already reached, so we do not qualify
  assert.equal(lipSide([{ p: 0.5, size: 1000 }], 1000, 0.5, { p: 0.49, size: 1000 }).share, 0);
  // competitor 500 at 0.50 (ref = 0.50 since 500 >= 200); we 1000 at 0.49 -> take 500 of ours at 0.5^1
  const r = lipSide([{ p: 0.5, size: 500 }], 1000, 0.5, { p: 0.49, size: 1000 });
  assert.ok(Math.abs(r.share - 250 / 750) < 1e-9);
});

test('fee rounds up to the cent; jackknife of constants has zero SE', () => {
  assert.equal(feeOf(0.0175, 10, 0.5), 0.05); assert.equal(feeOf(0, 10, 0.5), 0);
  const j = jackknife([2, 2, 2]); assert.equal(j.mean, 2); assert.ok(Math.abs(j.se) < 1e-12);
  assert.ok(jackknife([1, 2, 3]).se > 0);
});

test('restBid: at-price trades consume the queue first, through-price trades fill outright', () => {
  const o = { price: 0.4, size: 100, ahead: 50 };
  const a = restBid(o, [{ t: 1, yes: 0.4, count: 80, takerSide: 'no' }]);
  assert.equal(a.fills[0].size, 30);
  const b = restBid(o, [{ t: 1, yes: 0.39, count: 20, takerSide: 'no' }]);
  assert.equal(b.fills[0].size, 20);
  assert.equal(restBid(o, [{ t: 1, yes: 0.4, count: 80, takerSide: 'yes' }]).fills.length, 0);
});
