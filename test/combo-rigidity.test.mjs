import test from 'node:test';
import assert from 'node:assert/strict';
import { sidesOfReading } from '@red-cup-engineering/computer-data-engineering-services-section/four';
import { flexInterval, gameInterval, parlayInterval, priceReading, rigidity, scoreCells, scoreRegion, verifyHedge } from '../src/combo-rigidity.mjs';
import { legMeta } from '../src/combo-pricer.mjs';

const G = '26OCT10BOSNYR';
const nhl = (kind, sfx) => `KXNHL${kind}-${G}-${sfx}`;
const book = (ticker, bid, ask) => ({ ticker, bid, ask });

test('regions follow Kalshi strike spelling: suffix N means >= N', () => {
  const r = (t) => scoreRegion(legMeta(t));
  assert.equal(r(nhl('SPREAD', 'NYR2')).test([1, 3]), true);
  assert.equal(r(nhl('SPREAD', 'NYR2')).test([2, 3]), false);
  assert.equal(r(nhl('TOTAL', '6')).test([3, 3]), true);
  assert.equal(r(nhl('TEAMTOTAL', 'BOS4')).test([4, 0]), true);
  assert.equal(r(nhl('GAME', 'BOS')).test([2, 1]), true);
  assert.equal(r('KXNHLGOAL-26OCT10BOSNYR-PASTRNAK1'), null);
});

test('double banana: two games each pinned by their winners pass the count but flex about their dependence', () => {
  // cells: (game1 home?, game2 home?) = HH, HA, AH, AA
  const g1Home = [0, 1]; const g1Away = [2, 3]; const g2Home = [0, 2]; const g2Away = [1, 3];
  const r = rigidity(4, [g1Home, g1Away, g2Home, g2Away], [0]);
  assert.equal(r.countRigid, true, 'a full matching of quotes to cells: the count promises rigidity');
  assert.equal(r.rigid, false, 'but the normalisations are one relation counted twice');
  assert.equal(r.flexDimension, 1);
  assert.equal(r.targetPinned, false, 'the both-home parlay is not priced by its legs');
  const iv = flexInterval(4, [g1Home, g1Away, g2Home, g2Away].map((cells, i) => ({ cells, lo: [0.6, 0.4, 0.5, 0.5][i], hi: [0.6, 0.4, 0.5, 0.5][i] })), [0]);
  assert.ok(Math.abs(iv.lo - 0.1) < 1e-9 && Math.abs(iv.hi - 0.5) < 1e-9, 'the swing of the hinge is the Fréchet interval');
});

test('one game: the parlay interval comes with hedges the verifier checks without the solver', () => {
  const books = [book(nhl('GAME', 'BOS'), 0.54, 0.56), book(nhl('GAME', 'NYR'), 0.44, 0.46), book(nhl('TOTAL', '6'), 0.47, 0.49), book(nhl('SPREAD', 'BOS2'), 0.3, 0.32)];
  const regions = books.map((b) => scoreRegion(legMeta(b.ticker)));
  const { cells, member } = scoreCells(regions, { noDraw: true });
  const markets = books.map((b, i) => ({ cells: member[i], lo: b.bid, hi: b.ask }));
  const target = cells.flatMap((c, k) => (member[0].includes(k) && member[2].includes(k) ? [k] : []));
  const iv = flexInterval(cells.length, markets, target);
  assert.ok(iv.coherent && iv.lo < iv.hi);
  const sup = verifyHedge(cells.length, markets, target, iv.superHedge, 'super');
  const sub = verifyHedge(cells.length, markets, target, iv.subHedge, 'sub');
  assert.ok(sup.valid && Math.abs(sup.value - iv.hi) < 1e-7);
  assert.ok(sub.valid && Math.abs(sub.value - iv.lo) < 1e-7);
  // BOS by 2+ implies BOS wins: the parlay "BOS wins and BOS by 2+" is the spread leg, pinned to its book
  const pinned = gameInterval([{ ticker: nhl('GAME', 'BOS'), side: 'yes' }, { ticker: nhl('SPREAD', 'BOS2'), side: 'yes' }], books);
  assert.ok(Math.abs(pinned.lo - 0.3) < 1e-9 && Math.abs(pinned.hi - 0.32) < 1e-9);
  assert.equal(pinned.rigidity.targetPinned, true);
});

test('exclusive legs: both winners of one game can never pay', () => {
  const books = [book(nhl('GAME', 'BOS'), 0.54, 0.56), book(nhl('GAME', 'NYR'), 0.44, 0.46)];
  const iv = gameInterval([{ ticker: nhl('GAME', 'BOS'), side: 'yes' }, { ticker: nhl('GAME', 'NYR'), side: 'yes' }], books);
  assert.equal(iv.hi, 0);
});

test('readings: legs that admit no measure tell both sides; the flex tells neither', () => {
  const bad = gameInterval([{ ticker: nhl('GAME', 'BOS'), side: 'yes' }], [book(nhl('GAME', 'BOS'), 0.6, 0.62), book(nhl('GAME', 'NYR'), 0.5, 0.52)]);
  assert.equal(bad.coherent, false);
  assert.deepEqual(sidesOfReading(priceReading({ coherent: false }, 0.5)), [true, true]);
  assert.deepEqual(sidesOfReading(priceReading({ coherent: true, lo: 0.2, hi: 0.4 }, 0.3)), [false, false]);
  assert.deepEqual(sidesOfReading(priceReading({ coherent: true, lo: 0.2, hi: 0.4 }, 0.45)), [true, false]);
  assert.deepEqual(sidesOfReading(priceReading({ coherent: true, lo: 0.2, hi: 0.4 }, 0.1)), [false, true]);
});

test('evidence only shrinks the interval: a further quote never widens it', () => {
  const legs = [{ ticker: nhl('GAME', 'BOS'), side: 'yes' }, { ticker: nhl('TOTAL', '6'), side: 'yes' }];
  const base = [book(nhl('GAME', 'BOS'), 0.54, 0.56), book(nhl('TOTAL', '6'), 0.47, 0.49)];
  const a = gameInterval(legs, base);
  const b = gameInterval(legs, [...base, book(nhl('TEAMTOTAL', 'BOS4'), 0.25, 0.27), book(nhl('TEAMTOTAL', 'NYR3'), 0.4, 0.42)]);
  assert.ok(b.lo >= a.lo - 1e-9 && b.hi <= a.hi + 1e-9);
  assert.ok(b.hi - b.lo < a.hi - a.lo, 'team totals brace the margin-total hinge');
});

test('parlay across games: the pinned hinge multiplies, the free hinge is Fréchet', () => {
  const g2 = '26OCT10TORMTL';
  const books = new Map([[G, [book(nhl('GAME', 'BOS'), 0.6, 0.6)]], [g2, [book(`KXNHLGAME-${g2}-MTL`, 0.5, 0.5)]]]);
  const p = parlayInterval([{ ticker: nhl('GAME', 'BOS'), side: 'yes' }, { ticker: `KXNHLGAME-${g2}-MTL`, side: 'yes' }], books);
  assert.ok(Math.abs(p.pinned[0] - 0.3) < 1e-9 && Math.abs(p.pinned[1] - 0.3) < 1e-9);
  assert.ok(Math.abs(p.free[0] - 0.1) < 1e-9 && Math.abs(p.free[1] - 0.5) < 1e-9);
});

test('a leg off the score lattice is bounded by Fréchet against the score part', () => {
  const prop = 'KXNHLGOAL-26OCT10BOSNYR-PASTRNAK1';
  const iv = gameInterval([{ ticker: nhl('GAME', 'BOS'), side: 'yes' }, { ticker: prop, side: 'yes' }], [book(nhl('GAME', 'BOS'), 0.55, 0.55), book(prop, 0.4, 0.42)]);
  assert.equal(iv.free, 1);
  assert.ok(Math.abs(iv.hi - 0.42) < 1e-9 && iv.lo === 0);
});

test('team codes sharing a prefix land on their own team (MIA and MIN in MIAMIN)', () => {
  const g = (sfx) => `KXNFLGAME-26OCT04MIAMIN-${sfx}`;
  const iv = gameInterval([{ ticker: g('MIN'), side: 'yes' }], [book(g('MIN'), 0.83, 0.84), book(g('MIA'), 0.16, 0.17)]);
  assert.equal(iv.coherent, true);
  assert.ok(Math.abs(iv.lo - 0.83) < 1e-9 && Math.abs(iv.hi - 0.84) < 1e-9);
});

test('Brier projection: an incoherent ladder is beaten in every outcome', async () => {
  const { brierProjection } = await import('../src/combo-rigidity.mjs');
  const books = [nhl('TOTAL', '5'), nhl('TOTAL', '6'), nhl('TOTAL', '7')];
  const regions = books.map((t) => scoreRegion(legMeta(t)));
  const { cells, member } = scoreCells(regions, { noDraw: true });
  const mids = [0.55, 0.6, 0.3]; // over 5.5 cheaper than over 6.5: no measure gives that
  const p = brierProjection(cells.length, member, mids);
  assert.ok(p.prices[0] >= p.prices[1] - 1e-6, 'the projection is monotone');
  for (let k = 0; k < cells.length; k += 1) {
    const o = member.map((cs) => (cs.includes(k) ? 1 : 0));
    const b = (f) => f.reduce((s, x, i) => s + (x - o[i]) ** 2, 0);
    assert.ok(b(p.prices) <= b(mids) - p.distance2 + 1e-6, `dominates in world ${cells[k].witness}`);
  }
});
