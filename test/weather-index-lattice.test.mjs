import test from 'node:test';
import assert from 'node:assert/strict';
import { indexLaw, calibrationAt, sumDistribution, stationFilter, observe, latentMean, createIndexTracker, strikeProbabilities, celsiusOf, driftCoefficients } from '../src/weather-index-lattice.mjs';
import { lampTemperatureChange } from '../src/lamp-station-guidance.mjs';
import { reproduceIndex } from '../src/weather-index.mjs';

const calibration = {
  config_version: 'nyc-temperature-v1.0-cal-20261012', effective_at_ms: Date.parse('2026-10-12T00:06:00Z'), city_reference_c: -0.08203125,
  stations: [['KLGA1M', 1.5], ['KEWR1M', 1.015625], ['KTEB1M', 0.125], ['KCDW1M', -0.640625], ['KHPN1M', -1.515625], ['KFRG1M', 0.25], ['KSMQ1M', -1.3125], ['KISP1M', -0.078125]]
    .map(([station_id, offset_c]) => ({ station_id, weight: 0.125, offset_c })),
};
const point = (readings) => ({ stations: Object.entries(readings).map(([station_id, [temp_f, source = 'hf_asos']]) => ({ station_id, code: 'ok', source, temp_f })) });

test('the index law reproduces the published arithmetic, with every member and with members missing or on METAR', () => {
  const law = indexLaw(calibration);
  const cases = [
    { KLGA1M: [64.4], KEWR1M: [66.2], KTEB1M: [62.6], KCDW1M: [62.6], KHPN1M: [60.8], KFRG1M: [64.4], KSMQ1M: [60.8], KISP1M: [62.6] },
    { KEWR1M: [66.2], KTEB1M: [62.6], KCDW1M: [62.6], KHPN1M: [60.8], KFRG1M: [64.4], KSMQ1M: [60.8], KISP1M: [62.6] },
    { KLGA1M: [64.94, 'metar'], KEWR1M: [66.2], KTEB1M: [62.6], KHPN1M: [60.8], KFRG1M: [64.4], KSMQ1M: [60.8] },
  ];
  for (const readings of cases) {
    const accepted = Object.keys(readings), sumTenths = Object.values(readings).reduce((s, [f, source]) => s + Math.round(celsiusOf(f, source) * 10), 0);
    assert.equal(law.valueOf(accepted)(sumTenths), reproduceIndex(point(readings), calibration));
  }
  // with every member accepted the offsets cancel: the index is 32 + 1.8 x mean reading
  assert.equal(law.valueOf(calibration.stations.map((s) => s.station_id))(8 * 170), 62.6);
  assert.throws(() => indexLaw({ ...calibration, stations: calibration.stations.map((s, i) => ({ ...s, weight: i ? 0.1 : 0.3 })) }), /equal member weights/u);
  assert.equal(calibrationAt([calibration, { ...calibration, effective_at_ms: calibration.effective_at_ms + 1 }], calibration.effective_at_ms), calibration);
  assert.equal(calibrationAt([calibration], calibration.effective_at_ms - 1), null);
});

test('at no horizon the sum is the readings themselves; over a horizon it spreads and stays normalized', () => {
  const stations = [stationFilter(17), stationFilter(18), stationFilter(16.3, 0.1)].map((state, i) => ({ state, horizon: 0, shift: 0, resolution: i === 2 ? 0.1 : 1 }));
  const now = sumDistribution(stations, { commonHorizon: 0, sigmaCommon: 0.05, sigmaStation: 0.04, tau: 0.01, tauMetar: 0.01 });
  let best = 0; for (let k = 1; k < now.pmf.length; k += 1) if (now.pmf[k] > now.pmf[best]) best = k;
  assert.equal(now.min + best, 170 + 180 + 163);
  assert.ok(now.pmf[best] > 0.95);
  const later = sumDistribution(stations.map((s) => ({ ...s, horizon: 60 })), { commonHorizon: 60, sigmaCommon: 0.05, sigmaStation: 0.04, sigmaDrift: 0.005, tau: 0.05 });
  assert.ok(Math.abs(later.pmf.reduce((s, v) => s + v, 0) - 1) < 1e-12);
  assert.ok(Math.max(...later.pmf) < 0.5);
  // whole-degree stations only: every mass is on whole degrees
  const whole = sumDistribution(stations.slice(0, 2).map((s) => ({ ...s, horizon: 30 })), { commonHorizon: 30, sigmaCommon: 0.05, sigmaStation: 0.04, tau: 0.05 });
  for (let k = 0; k < whole.pmf.length; k += 1) if (whole.pmf[k] > 0) assert.equal((whole.min + k) % 10, 0);
});

test('a reading moves the latent posterior into its bin', () => {
  let s = stationFilter(17);
  assert.ok(Math.abs(latentMean(s) - 17) < 0.05);
  s = observe(s, 18, 0.05);
  assert.ok(latentMean(s) > 17.4 && latentMean(s) < 18.5);
});

test('strike probabilities fall with the strike and the tracker centres on the current index', () => {
  const t0 = Date.parse('2026-10-13T15:00:00Z');
  const tracker = createIndexTracker({
    params: { sigmaCommon: 0.03, sigmaStation: 0.06, sigmaDrift: 0.005, tau: 0.05, trendMinutes: 30, climateHalfLifeDays: 5, drift: { horizons: [2, 60], coefficients: [[1, 1, 0], [1, 1, 0]] } },
    climate: new Array(24).fill(0), localHour: (t) => new Date(t).getUTCHours(), calibrations: [calibration],
  });
  const readings = { KLGA1M: 18, KEWR1M: 19, KTEB1M: 17, KCDW1M: 17, KHPN1M: 16, KFRG1M: 18, KSMQ1M: 16, KISP1M: 17 };
  for (let m = 0; m < 60; m += 1) for (const [id, c] of Object.entries(readings)) tracker.observe(id, t0 + m * 60_000, { code: 'ok', celsius: c, source: 'hf_asos' });
  const now = t0 + 59 * 60_000, value = Math.round((32 + 1.8 * (138 / 8)) * 100) / 100;
  const d = tracker.distribution(now);
  assert.ok(d.find((x) => x.value === value).p > 0.9);
  const strikes = tracker.strikes(now + 30 * 60_000, [60.99, 61.99, 62.99, 63.99, 64.99]).map((s) => s.p);
  for (let i = 1; i < strikes.length; i += 1) assert.ok(strikes[i] <= strikes[i - 1] + 1e-12);
  assert.deepEqual(strikeProbabilities([{ value: 63, p: 0.5 }, { value: 64, p: 0.5 }], [63.5]), [{ strike: 63.5, p: 0.5 }]);
  // a member that stops reporting leaves the accepted set the index is computed over
  tracker.observe('KLGA1M', now + 60_000, { code: 'missing' });
  assert.deepEqual(tracker.accepted().includes('KLGA1M'), false);
  assert.deepEqual(driftCoefficients({ horizons: [2, 60], coefficients: [[0, 0, 0], [1, 2, 3]] }, 31), [0.5, 1, 1.5]);
});

test('LAMP change is read from the latest bulletin usable at the start, linear between its hours', () => {
  const bulletin = (runtime, temps) => ({ runtime, stations: { KLGA: { rows: temps.map((f, i) => ({ validTime: new Date(Date.parse(runtime) + (i + 1) * 3_600_000 - 30 * 60_000).toISOString(), temperatureF: f })) } } });
  const change = lampTemperatureChange([bulletin('2026-10-16T12:30:00Z', [60, 62, 66]), bulletin('2026-10-16T13:30:00Z', [70, 70, 70])]);
  const at = (iso) => Date.parse(iso);
  // the 12:30 bulletin (hours 13, 14, 15) at 13:10, before the 13:30 one is posted
  assert.ok(Math.abs(change('KLGA', at('2026-10-16T13:10:00Z'), at('2026-10-16T14:30:00Z')) - (64 - (60 + 2 / 6)) / 1.8) < 1e-12);
  assert.equal(change('KLGA', at('2026-10-16T13:00:00Z'), at('2026-10-16T14:00:00Z')), 2 / 1.8);
  assert.equal(change('KLGA', at('2026-10-16T13:45:00Z'), at('2026-10-16T14:45:00Z')), 0);
  assert.equal(change('KJFK', at('2026-10-16T13:00:00Z'), at('2026-10-16T14:00:00Z')), null);
  assert.equal(change('KLGA', at('2026-10-16T12:00:00Z'), at('2026-10-16T13:00:00Z')), null);
});
