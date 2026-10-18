import test from 'node:test';
import assert from 'node:assert/strict';
import { discrepancyTable, clopperPearsonUpper, lessExtremeUpper, moreExtremeUpper } from '../src/weather-extreme-discrepancy.mjs';

test('the Clopper-Pearson bound is the exact binomial bound: zero of n gives about three over n', () => {
  assert.ok(Math.abs(clopperPearsonUpper(0, 100) - (1 - 0.05 ** (1 / 100))) < 1e-6);
  assert.ok(Math.abs(clopperPearsonUpper(0, 1000) - 0.002988) < 1e-5);
  assert.ok(clopperPearsonUpper(5, 100) > 0.05 && clopperPearsonUpper(5, 100) < 0.11);
  assert.equal(clopperPearsonUpper(10, 10), 1);
  assert.equal(clopperPearsonUpper(0, 0), 1);
});

test('the table counts the days the report was k degrees less or more extreme than the observations, for highs and lows', () => {
  const days = [
    { kind: 'high', report: 90, observed: 90 }, { kind: 'high', report: 89, observed: 90 }, { kind: 'high', report: 88, observed: 90 }, { kind: 'high', report: 91, observed: 90 },
    { kind: 'low', report: 50, observed: 50 }, { kind: 'low', report: 51, observed: 50 }, { kind: 'low', report: 49, observed: 50 },
  ];
  const t = discrepancyTable(days);
  assert.equal(t.byKind.high.n, 4); assert.equal(t.byKind.low.n, 3);
  assert.deepEqual(t.byKind.high.lessExtreme, { 1: 2, 2: 1 });
  assert.deepEqual(t.byKind.high.moreExtreme, { 1: 1 });
  assert.deepEqual(t.byKind.low.lessExtreme, { 1: 1 });
  assert.deepEqual(t.byKind.low.moreExtreme, { 1: 1 });
});

test('the bound shrinks only with evidence, and a zero cushion claims nothing', () => {
  const days = (n, lessByOne) => Array.from({ length: n }, (_, i) => ({ kind: 'high', report: i < lessByOne ? 89 : 90, observed: 90 }));
  const small = discrepancyTable(days(100, 40)), large = discrepancyTable(days(2000, 800));
  assert.equal(lessExtremeUpper(small, 'high', 0), 1);
  assert.ok(lessExtremeUpper(small, 'high', 2) > lessExtremeUpper(large, 'high', 2), 'zero in 100 days is a looser claim than zero in 2000');
  assert.ok(lessExtremeUpper(large, 'high', 2) < 0.002);
  assert.ok(lessExtremeUpper(large, 'high', 1) > 0.35, 'a one degree cushion is not enough when 40% of days lose it');
  assert.equal(moreExtremeUpper(small, 'high', 1) < 0.05, true);
  assert.equal(lessExtremeUpper(discrepancyTable([]), 'high', 1), 1);
});
