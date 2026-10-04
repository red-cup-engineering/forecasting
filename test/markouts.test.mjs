import test from 'node:test';
import assert from 'node:assert/strict';
import { markouts, meanCi, summarize, phaseIndex, phaseAt, tradeOf, parseTicker } from '../src/markouts.mjs';

const tr = (ticker, s, p, takerYes, count = 1) => ({ ticker, r: 1e6 + s * 1000, p, count, takerYes });

test('maker is short YES when the taker bought YES: price rising after is adverse', () => {
  const rows = markouts([tr('A', 0, 0.5, true), tr('A', 1, 0.6, true)], [1000]);
  assert.ok(Math.abs(rows[0].mo[1000] - -0.1) < 1e-9);
});

test('maker is long YES when the taker bought NO: price falling after is adverse', () => {
  const rows = markouts([tr('A', 0, 0.5, false), tr('A', 5, 0.4, false)], [5000]);
  assert.ok(Math.abs(rows[0].mo[5000] - -0.1) < 1e-9);
});

test('markouts are per market and ignore a stale later trade', () => {
  const rows = markouts([tr('A', 0, 0.5, true), tr('B', 1, 0.9, true), tr('A', 100, 0.9, true)], [1000, 30000]);
  const a = rows.find((r) => r.ticker === 'A' && r.r === 1e6);
  assert.equal(a.mo[1000], null);     // next A trade is 100 s away, outside tolerance
  assert.equal(a.mo[30000], null);
  assert.equal(rows.find((r) => r.ticker === 'B').mo[1000], null);
});

test('the first later trade at or after t+h is the mark', () => {
  const rows = markouts([tr('A', 0, 0.5, true), tr('A', 0.5, 0.9, true), tr('A', 1.2, 0.55, true)], [1000]);
  assert.ok(Math.abs(rows.find((r) => r.r === 1e6).mo[1000] - -0.05) < 1e-9);
});

test('meanCi gives mean, interval and size-weighted mean', () => {
  const m = meanCi([{ x: 0.1, w: 1 }, { x: 0.3, w: 3 }, { x: null, w: 9 }]);
  assert.equal(m.n, 2); assert.ok(Math.abs(m.mean - 0.2) < 1e-9); assert.ok(Math.abs(m.wmean - 0.25) < 1e-9);
  assert.ok(m.lo < m.mean && m.hi > m.mean);
  assert.equal(meanCi([]).mean, null);
});

test('summarize groups by key and horizon', () => {
  const rows = markouts([tr('A', 0, 0.5, true), tr('A', 1, 0.6, true), tr('B', 0, 0.5, false), tr('B', 1, 0.6, false)], [1000]);
  const s = summarize(rows, (r) => r.ticker, [1000]);
  assert.ok(Math.abs(s.A[1000].mean - -0.1) < 1e-9); assert.ok(Math.abs(s.B[1000].mean - 0.1) < 1e-9);
});

test('phase at trade time comes from the last feed row before it', () => {
  const idx = phaseIndex([{ r: 10, code: 'G', state: 'pre' }, { r: 20, event: 'KXNFLGAME-G', status: 'STATUS_IN_PROGRESS' }, { r: 30, code: 'G', state: 'post' }]);
  assert.equal(phaseAt(idx, 'G', 5), 'no-feed'); assert.equal(phaseAt(idx, 'G', 15), 'pre-game');
  assert.equal(phaseAt(idx, 'G', 25), 'in-play'); assert.equal(phaseAt(idx, 'G', 99), 'post-game');
  assert.equal(phaseAt(idx, 'X', 15), 'no-feed');
});

test('a recorded trade message becomes a trade row; other messages do not', () => {
  const t = tradeOf({ r: 7, m: { type: 'trade', msg: { market_ticker: 'M', yes_price_dollars: '0.9300', count_fp: '10.5', taker_outcome_side: 'no', trade_id: 'x' } } });
  assert.deepEqual(t, { ticker: 'M', r: 7, p: 0.93, count: 10.5, takerYes: false, id: 'x' });
  assert.equal(tradeOf({ r: 1, m: { type: 'ticker', msg: {} } }), null);
  assert.deepEqual(parseTicker('KXMLBHIT-26OCT041600SDMIL-PLAYER-1'), { series: 'KXMLBHIT', code: '26OCT041600SDMIL' });
});
