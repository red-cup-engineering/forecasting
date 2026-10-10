import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPlay, playVerifier } from '@red-cup-engineering/gaming/running/rules';
import { comboArena, rigidityMaker, pnlOf, playStrategy, ONE } from '../src/combo-arena.mjs';

const G = '26OCT10BOSNYR';
const BOS = `KXNHLGAME-${G}-BOS`; const NYR = `KXNHLGAME-${G}-NYR`;
const G2 = '26OCT10TORMTL'; const MTL = `KXNHLGAME-${G2}-MTL`;
const COMBO = 'KXMVE-X1';
const book = (ticker, bid, ask, t = 1) => ({ kind: 'book', ticker, event: ticker.split('-').slice(0, 2).join('-'), bid, ask, t });
const rfq = (id, legs, ticker = COMBO) => ({ kind: 'rfq', id, ticker, legs, at: 2 });
const legs2 = [{ ticker: BOS, side: 'yes' }, { ticker: MTL, side: 'yes' }];
const step = (p, ...ms) => ms.reduce((x, m) => comboArena.extend(x, m).state, p);
const empty = () => comboArena.initialPosition();

test('extend refuses what is not enabled', () => {
  assert.throws(() => comboArena.extend(empty(), { kind: 'quote', rfqId: 'nope', price: 3000 }), /unknown rfq/);
  const s = step(empty(), { kind: 'settle', ticker: BOS, result: 1 });
  assert.throws(() => comboArena.extend(s, { kind: 'settle', ticker: BOS, result: 0 }), /already settled/);
  const b = step(empty(), book(BOS, 5000, 5000, 10));
  assert.throws(() => comboArena.extend(b, book(BOS, 5000, 5000, 9)), /stale/);
  const r = step(empty(), rfq('a', legs2), { kind: 'quote', rfqId: 'a', price: 3000 });
  assert.throws(() => comboArena.extend(r, { kind: 'quote', rfqId: 'a', price: 2000 }), /already quoted/);
  assert.throws(() => comboArena.extend(r, rfq('a', legs2)), /not new/);
});

const tape = [
  book(BOS, 6000, 6000), book(MTL, 5000, 5000), rfq('a', legs2),
  { kind: 'print', ticker: COMBO, price: 3200, count: 500, taker: 'yes', at: 3 },
  { kind: 'settle', ticker: BOS, result: 1 }, { kind: 'settle', ticker: MTL, result: 1 },
];

test('a play with a taker print at or over our quote records one shadow fill and its pnl', () => {
  const p = playStrategy(tape, rigidityMaker());
  assert.equal(p.position.quotes.a.price, 3000);
  assert.equal(p.position.fills.length, 1);
  assert.equal(p.position.fills[0].shadow, true);
  assert.equal(p.position.rfqs.a.status, 'closed');
  const [f] = pnlOf(p.position);
  assert.equal(f.outcome, 1); assert.equal(f.pnl, 3000 - ONE); assert.equal(f.total, (3000 - ONE) * 5);
  // a print under our quote, or a NO taker, fills nothing
  assert.equal(playStrategy(tape.map((m) => (m.kind === 'print' ? { ...m, price: 2900 } : m)), rigidityMaker()).position.fills.length, 0);
  assert.equal(playStrategy(tape.map((m) => (m.kind === 'print' ? { ...m, taker: 'no' } : m)), rigidityMaker()).position.fills.length, 0);
  // unsettled: no pnl; a losing leg: we keep the premium
  assert.equal(pnlOf(playStrategy(tape.slice(0, 4), rigidityMaker()).position).length, 0);
  const lost = playStrategy([...tape.slice(0, 4), { kind: 'settle', ticker: BOS, result: 0 }, { kind: 'settle', ticker: MTL, result: 1 }], rigidityMaker());
  assert.equal(pnlOf(lost.position)[0].pnl, 3000);
});

test('replay of the recorded moves rebuilds the same position hash', () => {
  const p = playStrategy(tape, rigidityMaker());
  const r = replayPlay(comboArena, 0, p.moves);
  assert.equal(r.valid, true); assert.equal(r.stateHash, p.positionHash);
  assert.deepEqual(r.finalState, p.position);
  const v = playVerifier(comboArena)(0, undefined, p.moves.map((intent, seq) => ({ seq, intent })));
  assert.equal(v.stateHash, p.positionHash);
  assert.equal(replayPlay(comboArena, 0, [...p.moves, p.moves[2]]).valid, false);
});

test('rigidityMaker quotes the product of asks for a pinned parlay and passes on incoherent books', () => {
  const p = playStrategy(tape.slice(0, 3), rigidityMaker());
  assert.equal(p.moves.length, 4); assert.equal(p.moves[3].price, 3000);
  assert.equal(playStrategy(tape.slice(0, 3), rigidityMaker({ edge: 50 })).moves[3].price, 3050);
  // both teams' bids sum above 1: no measure
  const bad = [book(BOS, 6000, 6200), book(NYR, 5000, 5200), rfq('b', [{ ticker: BOS, side: 'yes' }, { ticker: NYR, side: 'yes' }])];
  const q = playStrategy(bad, rigidityMaker());
  assert.equal(q.moves.length, 3); assert.equal(q.position.quotes.b, undefined);
});

test('exposure nerve: a second combo on the same two games closes a loop; forest admission passes it', async () => {
  const { exposureNerve, forestAdmission, comboArena } = await import('../src/combo-arena.mjs');
  const a = { id: 'a', legs: [{ ticker: 'KXNHLGAME-26OCT10BOSNYR-BOS' }, { ticker: 'KXNHLGAME-26OCT10TORMTL-MTL' }] };
  const b = { id: 'b', legs: [{ ticker: 'KXNHLTOTAL-26OCT10BOSNYR-6' }, { ticker: 'KXNHLGAME-26OCT10TORMTL-TOR' }] };
  const c = { id: 'c', legs: [{ ticker: 'KXNHLGAME-26OCT10BOSNYR-NYR' }, { ticker: 'KXNHLGAME-26OCT10DETCHI-DET' }] };
  assert.equal(exposureNerve([a]).h1, 0);
  assert.equal(exposureNerve([a, b]).h1, 1, 'two combos sharing two games: one loop');
  assert.equal(exposureNerve([a, c]).h1, 0, 'sharing one game keeps a forest');
  const always = (position, rfq) => ({ kind: 'quote', rfqId: rfq.id, price: 5000 });
  const admit = forestAdmission(always);
  let pos = comboArena.initialPosition();
  const step = (m) => { pos = comboArena.extend(pos, m).state; };
  step({ kind: 'rfq', id: 'a', ticker: 'KXMVE-A', legs: a.legs.map((l) => ({ ...l, side: 'yes' })), at: 1 });
  step(admit(pos, { id: 'a', ...pos.rfqs.a }));
  step({ kind: 'rfq', id: 'b', ticker: 'KXMVE-B', legs: b.legs.map((l) => ({ ...l, side: 'yes' })), at: 2 });
  assert.equal(admit(pos, { id: 'b', ...pos.rfqs.b }), null);
  step({ kind: 'rfq', id: 'c', ticker: 'KXMVE-C', legs: c.legs.map((l) => ({ ...l, side: 'yes' })), at: 3 });
  assert.ok(admit(pos, { id: 'c', ...pos.rfqs.c }));
});
