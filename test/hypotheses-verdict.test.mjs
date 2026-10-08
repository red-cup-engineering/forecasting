import test from 'node:test';
import assert from 'node:assert/strict';
import { sidesOfReading } from '@red-cup-engineering/computer-data-engineering-services-section/four';
import { clusterStats } from '../src/hypotheses/stats.mjs';
import { nextStatus, readVerdict } from '../src/hypotheses/verdict.mjs';

const h = (verdict, extra = {}) => ({ id: 'x', verdict, ...extra });
const mk = (n, f, date = (i) => `2026-11-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`) => Array.from({ length: n }, (_, i) => ({ g: `c${i}`, x: f(i), date: date(i) }));
const sides = (v) => sidesOfReading(v.reading);

test('jackknife by cluster: matches the closed form for one-item clusters and respects clustering', () => {
  const xs = [0.1, 0.3, -0.2, 0.4, 0.0, 0.2];
  const s = clusterStats(xs.map((x, i) => ({ g: `c${i}`, x })));
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1));
  assert.ok(Math.abs(s.mean - mean) < 1e-12);
  assert.ok(Math.abs(s.se - sd / Math.sqrt(xs.length)) < 1e-12);
  const clustered = clusterStats([{ g: 'a', x: 1 }, { g: 'a', x: 1 }, { g: 'b', x: -1 }, { g: 'b', x: -1 }]);
  assert.equal(clustered.groups, 2);
});

test('supported side told when the criterion passes; status becomes passed', () => {
  const v = readVerdict(h({ minClusters: 12, k: 2 }), { items: mk(12, (i) => 0.05 + (i % 2) * 0.01) });
  assert.deepEqual(sides(v), [true, false]);
  assert.equal(v.status, 'passed');
  assert.equal(nextStatus('forward', v), 'passed');
});

test('too few clusters tells neither side', () => {
  const v = readVerdict(h({ minClusters: 12, k: 2 }), { items: mk(5, () => 0.05 + Math.random() * 0) });
  assert.deepEqual(sides(v), [false, false]);
  assert.equal(nextStatus('forward', v), 'forward');
});

test('refuted side told on a decisive negative, and when the cluster budget is spent without a pass', () => {
  const neg = readVerdict(h({ minClusters: 12, k: 2 }), { items: mk(8, (i) => -0.2 - (i % 3) * 0.01) });
  assert.deepEqual(sides(neg), [false, true]);
  assert.equal(nextStatus('forward', neg), 'killed');
  const flat = readVerdict(h({ minClusters: 12, k: 2 }), { items: mk(12, (i) => (i % 2 ? 0.3 : -0.3)) });
  assert.deepEqual(sides(flat), [false, true]);
  const stillOpen = readVerdict(h({ minClusters: 12, k: 2, maxClusters: 40 }), { items: mk(12, (i) => (i % 2 ? 0.3 : -0.3)) });
  assert.deepEqual(sides(stillOpen), [false, false]);
});

test('holdout and forward arms that disagree tell both sides', () => {
  const items = [...mk(20, (i) => 0.1 + (i % 2) * 0.02, () => '2026-11-10T00:00:00Z'), ...mk(12, (i) => -0.5 - (i % 2) * 0.02, () => '2026-12-10T00:00:00Z').map((x, i) => ({ ...x, g: `d${i}` }))];
  const v = readVerdict(h({ minClusters: 12, k: 2, holdout: { from: '2026-12-01T00:00:00Z' } }), { items });
  assert.deepEqual(sides(v), [true, true]);
  assert.equal(v.status, null);
  assert.equal(nextStatus('forward', v), 'forward');
});

test('comparison arm must clear its own k; judgeAfter withholds the reading', () => {
  const arm = (a, x) => mk(14, (i) => x + (i % 2) * 0.01).map((it, i) => ({ ...it, g: `${a}${i}`, arm: a }));
  const crit = h({ minClusters: 12, k: 2, comparison: { arm: 'wide', against: 'narrow', k: 2 } });
  assert.deepEqual(sides(readVerdict(crit, { items: [...arm('wide', 0.08), ...arm('narrow', 0.01)] })), [true, false]);
  assert.deepEqual(sides(readVerdict(crit, { items: [...arm('wide', 0.0801), ...arm('narrow', 0.0800)] })), [false, true]);
  const gated = readVerdict(h({ minClusters: 12, k: 2 }, { judgeAfter: '2099-01-01T00:00:00Z' }), { items: mk(12, () => 0.05) }, { now: Date.parse('2026-10-08T00:00:00Z') });
  assert.deepEqual(sides(gated), [false, false]);
});

test('admitted and killed are never left by a reading', () => {
  const v = readVerdict(h({ minClusters: 12, k: 2 }), { items: mk(12, (i) => 0.05 + (i % 2) * 0.01) });
  assert.equal(nextStatus('killed', v), 'killed');
  assert.equal(nextStatus('admitted', v), 'admitted');
});
