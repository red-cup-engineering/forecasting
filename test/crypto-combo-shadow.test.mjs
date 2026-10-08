import test from 'node:test';
import assert from 'node:assert/strict';
import { cryptoRfq, midOf, decide, nextPollAt, comboOutcome, jackknife, slope, score, sampled, fnv, ASSETS } from '../src/crypto-combo-shadow-core.mjs';

const rho = { assets: ASSETS, rho: ASSETS.map((_, i) => ASSETS.map((__, j) => (i === j ? 1 : 0.6))) };
const rfq = (legs, extra = {}) => ({ id: 'r1', market_ticker: 'KXMVE-X', created_ts: '2026-10-08T01:00:30Z', target_cost_dollars: '5.0000', mve_selected_legs: legs.map(([m, side]) => ({ market_ticker: m, side })), ...extra });

test('cryptoRfq accepts same-window crypto combos only', () => {
  const ok = cryptoRfq(rfq([['KXBTC15M-26OCT072115-15', 'yes'], ['KXETH15M-26OCT072115-15', 'no']]));
  assert.equal(ok.legs.length, 2); assert.equal(ok.closeMs - ok.openMs, 900000); assert.equal(ok.size, 5);
  assert.equal(cryptoRfq(rfq([['KXBTC15M-26OCT072115-15', 'yes'], ['KXNFLGAME-26OCT04ARINYG-NYG', 'yes']])), null);
  assert.equal(cryptoRfq(rfq([['KXBTC15M-26OCT072115-15', 'yes'], ['KXETH15M-26OCT072130-30', 'yes']])), null);
  assert.equal(cryptoRfq(rfq([['KXBTC15M-26OCT072115-15', 'yes'], ['KXBTC15M-26OCT072115-15', 'no']])), null);
});

test('midOf', () => {
  assert.ok(Math.abs(midOf({ yes_bid_dollars: '0.40', yes_ask_dollars: '0.44' }).mid - 0.42) < 1e-12);
  assert.equal(midOf({ yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000' }), null);
  assert.equal(midOf({ yes_bid_dollars: '0.40', yes_ask_dollars: '0' }), null);
});

test('decide: positive correlation lifts same-side joint above independence; quote = midJoint + 0.02', () => {
  const r = cryptoRfq(rfq([['KXBTC15M-26OCT072115-15', 'yes'], ['KXETH15M-26OCT072115-15', 'yes']]));
  const mk = { 'KXBTC15M-26OCT072115-15': { yes_bid_dollars: '0.49', yes_ask_dollars: '0.51' }, 'KXETH15M-26OCT072115-15': { yes_bid_dollars: '0.49', yes_ask_dollars: '0.51' } };
  const d = decide(r, mk, rho, { now: r.closeMs - 600000 });
  assert.ok(Math.abs(d.indepMid - 0.25) < 1e-12); assert.ok(d.midJoint > 0.3 && d.midJoint < 0.45);
  assert.ok(Math.abs(d.ourQuote - d.midJoint - 0.02) < 1e-12);
  assert.equal(decide(r, mk, rho, { now: r.closeMs + 1 }).skip, 'closed');
  assert.match(decide(r, {}, rho, { now: r.closeMs - 1000 }).skip, /^no-book/);
});

test('poll schedule ends with a final poll after close', () => {
  const st = { createdMs: 1000, closeMs: 1000 + 60000, i: 0 };
  assert.equal(nextPollAt(st), 5000);
  assert.equal(nextPollAt({ ...st, i: 8, last: 20000 }), 91000);
  assert.equal(nextPollAt({ ...st, final: true }), Infinity);
});

test('comboOutcome', () => {
  const legs = [{ m: 'a', side: 'yes' }, { m: 'b', side: 'no' }];
  assert.equal(comboOutcome(legs, { a: 'yes', b: 'no' }), true);
  assert.equal(comboOutcome(legs, { a: 'yes', b: 'yes' }), false);
  assert.equal(comboOutcome(legs, { a: 'yes' }), null);
});

test('sampling is stable and roughly 1/N', () => {
  assert.equal(fnv('a'), fnv('a'));
  let k = 0; for (let i = 0; i < 4000; i += 1) if (sampled(`KXMVE-${i}`, 4)) k += 1;
  assert.ok(k > 800 && k < 1200); assert.ok(sampled('x', 1));
});

test('jackknife of a mean over equal groups matches the classical SE; slope', () => {
  const rows = [1, 2, 3, 4].map((v, i) => ({ w: i, v }));
  const j = jackknife(rows, (r) => r.w, (s) => s.reduce((a, r) => a + r.v, 0) / s.length);
  assert.equal(j.est, 2.5); assert.ok(Math.abs(j.se - Math.sqrt(1.25 / 3)) < 1e-12);
  assert.ok(Math.abs(slope([{ x: 0, y: 1 }, { x: 1, y: 3 }, { x: 2, y: 5 }], (r) => r.y, (r) => r.x) - 2) < 1e-12);
});

test('score: sell-YES fills only on taker-yes prints at or above our quote', () => {
  const row = (window, y, p, takerYes = true) => ({ window, y, midJoint: 0.3, indepMid: 0.25, ourQuote: 0.32, prints: [{ p, takerYes }] });
  const s = score([row(1, 0, 0.40), row(2, 1, 0.35), row(3, 0, 0.30), row(4, 0, 0.5, false), row(5, 0, 0.45)]);
  assert.equal(s.matched, 5); assert.equal(s.filled, 3);
  assert.ok(Math.abs(s.pnlAtQuote.est - (0.32 + (0.32 - 1) + 0.32) / 3) < 1e-12);
  assert.ok(Math.abs(s.pnlAtPrint.est - (0.40 + (0.35 - 1) + 0.45) / 3) < 1e-12);
  assert.ok(Math.abs(s.hitRate - 2 / 3) < 1e-12);
});
