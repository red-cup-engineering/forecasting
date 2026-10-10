import test from 'node:test';
import assert from 'node:assert/strict';
import { TAILS, inDecisionWindow, tailLossRate, tailSide, regimeVerdict } from '../src/temperature-tail-prediction.mjs';
import { rainSide } from '../src/rain-market-model.mjs';

test('the measured tail rules are the backtest\'s', () => {
  assert.deepEqual(TAILS.maxModelProbability, { high: 0.01, low: 0.005 });
  assert.equal(TAILS.lossRatePosterior.high.clusters, 61);
});

test('a tail is predicted only inside the measured decision window, in the station\'s own zone', () => {
  const at = (iso) => Date.parse(iso);
  const high = { kind: 'high', targetDate: '2026-10-10', timeZone: 'America/Chicago' };
  assert.equal(inDecisionWindow(high, TAILS.windows, at('2026-10-09T16:30:00Z')), false, '11:30 CDT the day before');
  assert.equal(inDecisionWindow(high, TAILS.windows, at('2026-10-09T18:00:00Z')), true, '13:00 CDT the day before');
  assert.equal(inDecisionWindow(high, TAILS.windows, at('2026-10-10T15:00:00Z')), true, '10:00 CDT the day itself');
  assert.equal(inDecisionWindow(high, TAILS.windows, at('2026-10-10T17:00:00Z')), false, '12:00 CDT the day itself');
  const low = { kind: 'low', targetDate: '2026-10-10', timeZone: 'America/Los_Angeles' };
  assert.equal(inDecisionWindow(low, TAILS.windows, at('2026-10-10T05:30:00Z')), true, '22:30 PDT the day before');
  assert.equal(inDecisionWindow(low, TAILS.windows, at('2026-10-10T06:30:00Z')), false, '23:30 PDT the day before');
});

test('the loss rate is never below the per-day posterior nor the model\'s own probability', () => {
  assert.ok(Math.abs(tailLossRate(0.002, 'high') - 1 / 63) < 1e-12);
  assert.ok(Math.abs(tailLossRate(0.001, 'low') - 2 / 61) < 1e-12);
  assert.equal(tailLossRate(0.05, 'high'), 0.05);
  assert.equal(tailSide({ floorStrike: 101 }, 94), 'warm');
  assert.equal(regimeVerdict('cold', { warm: ['Heat Advisory'], cold: [] }).ok, true);
});

test('rain sides: the long-shot bias at both ends, each sized on its record\'s upper-bound loss rate', () => {
  assert.deepEqual(rainSide({ priced: true, probability: 0.01 }), { side: 'tail', lossRate: 0.014 });
  assert.deepEqual(rainSide({ priced: true, probability: 0.985 }), { side: 'favourite', lossRate: 0.055 });
  assert.equal(rainSide({ priced: true, probability: 0.5 }), null);
  assert.equal(rainSide({ priced: false }), null);
});
