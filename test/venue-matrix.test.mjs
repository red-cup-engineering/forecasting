import test from 'node:test';
import assert from 'node:assert/strict';
import { readingOfSides, sidesOfReading } from '@red-cup-engineering/computer-data-services-section/four';
import { americanToProb, bookEntry, claimRow, columnScores, complement, consensus, coverEdge, crossVenueGap, decimalToProb, devig, feePerShare, intersect, kalshiFee, pointEntry, polymarketFee, readEntry } from '../src/venue-matrix.mjs';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);
const K = kalshiFee(1); const PM = polymarketFee(0.03);
const kal = (bid, ask, claim = 'win:0') => bookEntry({ venue: 'kalshi', claim, bid, ask, fee: K });
const pm = (bid, ask, claim = 'win:0') => bookEntry({ venue: 'polymarket', claim, bid, ask, fee: PM });

test('american and decimal odds to implied probability', () => {
  near(americanToProb('-470'), 470 / 570); near(americanToProb('+360'), 100 / 460); near(americanToProb(400), 0.2);
  assert.equal(americanToProb('x'), null); near(decimalToProb('1.58'), 1 / 1.58); assert.equal(decimalToProb('1'), null);
});

test('proportional de-vig sums to one and records the overround', () => {
  const d = devig([americanToProb(-470), americanToProb(360)]);
  near(d.probs[0] + d.probs[1], 1); near(d.vig, 470 / 570 + 100 / 460 - 1);
  near(d.probs[0] / d.probs[1], (470 / 570) / (100 / 460));
  assert.equal(devig([0.5, null]), null);
  near(devig([0.5, 0.3, 0.3]).vig, 0.1);
});

test('fees are quadratic and peak at one half', () => {
  near(feePerShare(K, 0.5), 0.07 * 0.25); near(feePerShare(PM, 0.5), 0.03 * 0.25); near(feePerShare(kalshiFee(0.5), 0.5), 0.035 * 0.25);
  assert.ok(feePerShare(K, 0.9) < feePerShare(K, 0.5)); assert.equal(feePerShare(null, 0.5), 0);
});

test('consensus is the intersection of executable intervals; points do not enter', () => {
  const c = consensus([kal(0.4, 0.5), pm(0.45, 0.55), pointEntry({ venue: 'book', claim: 'win:0', p: 0.9 })]);
  near(c.lo, 0.45); near(c.hi, 0.5); assert.equal(c.empty, false);
  assert.equal(consensus([pointEntry({ venue: 'book', claim: 'win:0', p: 0.5 })]), null);
  const e = intersect([{ lo: 0.6, hi: 0.7 }, { lo: 0.4, hi: 0.5 }]);
  assert.equal(e.empty, true); near(e.size, 0.1);
});

test('missing bid or ask opens the interval; a crossed book is excluded from consensus', () => {
  const e = kal(0, 0.3); near(e.lo, 0); assert.equal(e.hasBid, false);
  const open = kal(0.2, 1); assert.equal(open.hasAsk, false);
  const crossed = kal(0.6, 0.5); assert.equal(crossed.crossed, true);
  near(consensus([crossed, pm(0.4, 0.45)]).hi, 0.45);
});

test('cross-venue Dutch book: gap is bid over ask, net after both taker fees', () => {
  const g = crossVenueGap([kal(0.40, 0.42), pm(0.50, 0.52)]);
  assert.equal(g.buy, 'kalshi'); assert.equal(g.sell, 'polymarket'); near(g.gross, 0.08);
  near(g.net, 0.08 - 0.07 * 0.42 * 0.58 - 0.03 * 0.5 * 0.5);
  assert.ok(g.net > 0);
  assert.equal(consensus([kal(0.40, 0.42), pm(0.50, 0.52)]).empty, true);
  // overlapping books: the best pair has a negative gross edge and no Dutch book
  const o = crossVenueGap([kal(0.48, 0.50), pm(0.49, 0.51)]); assert.ok(o.gross < 0 && o.net < 0);
  assert.equal(crossVenueGap([kal(0.4, 0.5)]), null);
});

test('a gap smaller than the fees is not a Dutch book after fees', () => {
  const g = crossVenueGap([kal(0.49, 0.50), pm(0.51, 0.52)]);
  near(g.gross, 0.01); assert.ok(g.net < 0);
});

test('complement flips the interval and its sizes', () => {
  const c = complement(bookEntry({ venue: 'polymarket', claim: 'win:0', bid: 0.19, ask: 0.2, fee: PM, bidSize: 5, askSize: 7 }), 'win:1');
  near(c.lo, 0.8); near(c.hi, 0.81); assert.equal(c.bidSize, 7); assert.equal(c.askSize, 5); assert.equal(c.claim, 'win:1');
});

test('cover edge: the whole partition bought at the cheapest venues', () => {
  const win = coverEdge([[kal(0.40, 0.45), pm(0.41, 0.44)], [kal(0.50, 0.52, 'win:1'), pm(0.52, 0.53, 'win:1')]]);
  near(win.gross, 1 - (0.44 + 0.52)); assert.equal(win.crossVenue, true);
  assert.ok(win.net < win.gross);
  const none = coverEdge([[kal(0.5, 0.52)], [kal(0.5, 0.52, 'win:1')]]); assert.ok(none.gross < 0); assert.equal(none.crossVenue, false);
  assert.equal(coverEdge([[kal(0.4, 1)], [kal(0.5, 0.52, 'win:1')]]), null);
});

test('readings come from four.mjs: above, below, inside, none, contested', () => {
  const book = pointEntry({ venue: 'book', claim: 'win:0', p: 0.6 });
  const ex = [kal(0.40, 0.45), pm(0.41, 0.46)];
  const above = readEntry(book, [...ex, book]);
  assert.equal(above.reading, readingOfSides('told', true, false)); assert.equal(above.direction, 'above'); near(above.gap, 0.6 - 0.45);
  const below = readEntry(pointEntry({ venue: 'book', claim: 'win:0', p: 0.2 }), ex);
  assert.deepEqual(sidesOfReading(below.reading), [false, true]); assert.equal(below.direction, 'below');
  const inside = readEntry(pointEntry({ venue: 'book', claim: 'win:0', p: 0.43 }), ex);
  assert.deepEqual(sidesOfReading(inside.reading), [false, false]); assert.equal(inside.direction, 'inside');
  const alone = readEntry(ex[0], [ex[0]]);
  assert.deepEqual(sidesOfReading(alone.reading), [false, false]); assert.equal(alone.direction, 'none');
  // the others disagree among themselves: reading a third column against an empty reference is contested
  const third = bookEntry({ venue: 'azuro-x', claim: 'win:0', bid: 0.4, ask: 0.5, fee: null });
  const split = readEntry(third, [third, kal(0.30, 0.32), pm(0.50, 0.52)]);
  assert.deepEqual(sidesOfReading(split.reading), [true, true]);
  assert.deepEqual(sidesOfReading(readEntry(kal(0.6, 0.5), [kal(0.6, 0.5)]).reading), [true, true]);
});

test('executable columns are read leave-one-out against each other', () => {
  const row = claimRow('win:0', [kal(0.40, 0.42), pm(0.50, 0.52)]);
  assert.equal(row.consensus.empty, true);
  assert.deepEqual(sidesOfReading(row.readings.kalshi.reading), [false, true]); // Kalshi sits below Polymarket
  assert.deepEqual(sidesOfReading(row.readings.polymarket.reading), [true, false]);
});

test('column scores count how often and which way a column sits outside', () => {
  const ex = (a, b) => [kal(a, a + 0.02), pm(b, b + 0.02)];
  const rows = [0.60, 0.20, 0.45].map((p, i) => claimRow(`win:${i}`, [...ex(0.43, 0.43), pointEntry({ venue: 'book', claim: `win:${i}`, p })]));
  const s = columnScores(rows).book;
  assert.equal(s.rows, 3); assert.equal(s.outside, 2); assert.equal(s.above, 1); assert.equal(s.below, 1); near(s.meanGap, ((0.60 - 0.45) + (0.43 - 0.20)) / 2);
  assert.equal(columnScores(rows).kalshi.outside, 0);
});
