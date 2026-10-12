import test from 'node:test';
import assert from 'node:assert/strict';
import { extremeCdf, lateDayHighPassageEnvelope } from '../src/weather-temperature-extremes.mjs';

const hour = (meanF = 88, scaleF = 1) => ({ meanF, scaleF });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, String(a) + ' != ' + String(b));

test('one remaining modeled hour has identical upper and lower passage bounds', () => {
  const value = lateDayHighPassageEnvelope({
    observedHighF: 88,
    futureHourlyPoints: [hour()],
  });
  near(value.noLaterHourlyExceedance.low, 0.5);
  near(value.noLaterHourlyExceedance.high, 0.5);
  near(value.laterHourlyExceedance.low, 0.5);
  near(value.laterHourlyExceedance.high, 0.5);
  assert.equal(value.tradeEligible, false);
});

test('two hourly marginals produce sharp dependence bounds, not a certified point probability', () => {
  const points = [hour(), hour()];
  const value = lateDayHighPassageEnvelope({
    observedHighF: 88,
    futureHourlyPoints: points,
  });
  near(value.noLaterHourlyExceedance.low, 0);
  near(value.noLaterHourlyExceedance.high, 0.5);
  near(value.laterHourlyExceedance.low, 0.5);
  near(value.laterHourlyExceedance.high, 1);
  const commonShock = extremeCdf(88, { kind: 'high', points });
  near(commonShock.p, value.noLaterHourlyExceedance.high);
  assert.notEqual(commonShock.p, value.noLaterHourlyExceedance.low);
});

test('ten apparently unlikely hourly exceedances still leave a wide unmodeled dependence region', () => {
  const points = Array.from({ length: 10 }, () => hour(85, 1));
  const value = lateDayHighPassageEnvelope({
    observedHighF: 88,
    futureHourlyPoints: points,
  });
  const q = extremeCdf(88, { kind: 'high', points: [hour(85, 1)] }).p;
  near(value.noLaterHourlyExceedance.high, q);
  near(value.noLaterHourlyExceedance.low, Math.max(0, 1 - 10 * (1 - q)));
  assert.ok(value.noLaterHourlyExceedance.low < value.noLaterHourlyExceedance.high);
  near(value.laterHourlyExceedance.low, 1 - value.noLaterHourlyExceedance.high);
  near(value.laterHourlyExceedance.high, 1 - value.noLaterHourlyExceedance.low);
});

test('removing future hourly exposure cannot lower either dependence bound', () => {
  const p = hour(87, 2);
  const two = lateDayHighPassageEnvelope({ observedHighF: 88, futureHourlyPoints: [p, p] });
  const one = lateDayHighPassageEnvelope({ observedHighF: 88, futureHourlyPoints: [p] });
  assert.ok(one.noLaterHourlyExceedance.low >= two.noLaterHourlyExceedance.low);
  assert.ok(one.noLaterHourlyExceedance.high >= two.noLaterHourlyExceedance.high);
});

test('invalid or missing marginals cannot manufacture a late-day certification', () => {
  assert.throws(() => lateDayHighPassageEnvelope({ observedHighF: Number.NaN, futureHourlyPoints: [hour()] }), TypeError);
  assert.throws(() => lateDayHighPassageEnvelope({ observedHighF: 88, futureHourlyPoints: [] }), TypeError);
  assert.throws(() => lateDayHighPassageEnvelope({ observedHighF: 88, futureHourlyPoints: [hour(88, 0)] }), TypeError);
});
