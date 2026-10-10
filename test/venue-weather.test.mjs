import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTicker, impliedMedian, nearestRung, windowFeatures, olsCluster, tradePnl, meanSE, feePerContract } from '../src/venue-weather.mjs';

test('parseTicker', () => {
  assert.deepEqual(parseTicker('KXMLBTOTAL-26OCT071600CLECWS-14'), { series: 'KXMLBTOTAL', event: 'KXMLBTOTAL-26OCT071600CLECWS', suffix: 14, date: '2026-10-07', hhmm: '1600', codes: 'CLECWS' });
  assert.equal(parseTicker('KXNFLTOTAL-26OCT05ATLNO-76').date, '2026-10-05');
  assert.equal(parseTicker('junk'), null);
});
test('impliedMedian interpolates and enforces monotonicity', () => {
  const m = impliedMedian([{ strike: 40.5, mid: 0.9 }, { strike: 43.5, mid: 0.6 }, { strike: 46.5, mid: 0.4 }, { strike: 49.5, mid: 0.1 }]);
  assert.ok(Math.abs(m - 45) < 1e-9);
  assert.equal(impliedMedian([{ strike: 1, mid: 0.4 }, { strike: 2, mid: 0.3 }, { strike: 3, mid: 0.1 }]), null);
  assert.equal(impliedMedian([{ strike: 1, mid: 0.9 }, { strike: 2, mid: 0.8 }]), null);
  // a non-monotone bump is flattened by running min
  const m2 = impliedMedian([{ strike: 1, mid: 0.9 }, { strike: 2, mid: 0.3 }, { strike: 3, mid: 0.7 }, { strike: 4, mid: 0.1 }]);
  assert.ok(m2 > 1 && m2 < 2);
});
test('nearestRung', () => assert.equal(nearestRung([{ mid: 0.9 }, { mid: 0.55 }, { mid: 0.2 }]).mid, 0.55));
test('windowFeatures averages the window from the start hour', () => {
  const hourly = { time: ['2026-09-20T17:00', '2026-09-20T18:00', '2026-09-20T19:00', '2026-09-20T20:00'], w: [10, 20, 30, 40], p: [0, 1, 1, 5] };
  const f = windowFeatures(hourly, Date.parse('2026-09-20T17:30:00Z'), 3, { wind: { src: 'w', agg: 'mean' }, rain: { src: 'p', agg: 'sum' } });
  assert.equal(f.wind, 20); assert.equal(f.rain, 2);
  assert.equal(windowFeatures(hourly, Date.parse('2026-09-21T17:00:00Z'), 3, { wind: { src: 'w', agg: 'mean' } }).wind, null);
});
test('olsCluster recovers a line', () => {
  const rows = []; for (let i = 0; i < 40; i++) rows.push({ y: 2 + 3 * i + (i % 2 ? 0.1 : -0.1), x: [i], g: i });
  const r = olsCluster(rows);
  assert.ok(Math.abs(r.b[0] - 2) < 0.1 && Math.abs(r.b[1] - 3) < 0.01); assert.ok(r.se[1] > 0 && r.r2 > 0.99);
});
test('tradePnl and fee', () => {
  const t = tradePnl({ side: 'NO', yesBid: 0.48, yesAsk: 0.52, resolvedYes: false });
  assert.ok(Math.abs(t.ask - 0.52) < 1e-12 && Math.abs(t.gross - 0.48) < 1e-12);
  assert.ok(Math.abs(t.net - (0.48 - feePerContract(0.52))) < 1e-12);
  assert.equal(tradePnl({ side: 'YES', yesBid: 0.48, yesAsk: 0.52, resolvedYes: false }).gross, -0.52);
  assert.equal(tradePnl({ side: 'NO', yesBid: 0, yesAsk: 0.5, resolvedYes: true }), null);
});
test('meanSE', () => { const r = meanSE([1, 2, 3]); assert.equal(r.mean, 2); assert.ok(Math.abs(r.se - 1 / Math.sqrt(3)) < 1e-12); });
