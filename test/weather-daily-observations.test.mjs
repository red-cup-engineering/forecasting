import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStation, dayStreams, buildDailyModels, PARAMETERS } from '../src/weather-daily-observations.mjs';

const directory = mkdtempSync(join(tmpdir(), 'daily-observations-'));
test.after(() => rmSync(directory, { recursive: true, force: true }));
mkdirSync(join(directory, 'asos')); mkdirSync(join(directory, 'metar'));
const pad = (n) => String(n).padStart(2, '0');
/** A day of one-minute temperatures: 60 F, 70 F at noon-hour, one lone 95 F spike at 03:00; and routine METARs at :53 with rain from 10:53. */
function writeDay(date, { spike = true, rain = 0.05 } = {}) {
  const rows = ['station,station_name,valid(UTC),tmpf,precip'];
  for (let h = 0; h < 24; h += 1) for (let m = 0; m < 60; m += 1) {
    const t = h === 12 ? 70 : 60;
    rows.push(`TST,TEST,${date} ${pad(h)}:${pad(m)},${spike && h === 3 && m === 0 ? 95 : t},0.0`);
  }
  writeFileSync(join(directory, 'asos', 'KTST.csv'), `${rows.join('\n')}\n`);
  const metar = ['station,valid,tmpf,p01i,wxcodes'];
  for (let h = 0; h < 24; h += 1) metar.push(`TST,${date} ${pad(h)}:53,60.00,${h === 10 ? rain : 0},M`);
  writeFileSync(join(directory, 'metar', 'KTST.csv'), `${metar.join('\n')}\n`);
}
const day = Date.parse('2026-10-01T00:00:00Z');

test('a lone spike is not the day\'s high but a value two consecutive readings reached is, and the gauge totals the routine reports', () => {
  writeDay('2026-10-01');
  const station = loadStation(directory, 'KTST'), s = dayStreams(station, day, day + 86_400_000);
  assert.equal(s.temps.length, 24 * 12);
  assert.equal(PARAMETERS.confirmationReadings.value, 2);
  assert.equal(Math.max(...s.high.map((x) => x.v)), 70, 'the 95 F reading at 03:00 stood alone');
  assert.equal(Math.min(...s.low.map((x) => x.v)), 60);
  assert.equal(s.gauge.at(-1).v, 0.05); assert.equal(s.gauge.find((g) => new Date(g.t).getUTCHours() === 9).v, 0, 'the gauge is the running total at each report');
  assert.equal(s.complete, true);
  assert.equal(dayStreams(station, day - 86_400_000 * 5, day - 86_400_000 * 4).complete, false, 'a day without observations is not complete');
});

test('the tables count the station-days the report differed from the observations and the days the gauge showed rain and the report showed none', () => {
  writeDay('2026-10-01', { rain: 0.04 });
  const station = loadStation(directory, 'KTST');
  const models = buildDailyModels({ stations: { KTST: { tz: 'UTC' } }, rows: { KTST: station }, cli: { KTST: [{ valid: '2026-10-01', high: 69, low: 60, precip: 0 }] }, from: '2026-10-01', to: '2026-10-02' });
  assert.equal(models.stationDays, 1);
  assert.equal(models.dayExtremum.byKind.high.lessExtreme[1], 1, 'the report was a degree under the confirmed high');
  assert.equal(models.dayExtremum.byKind.low.n, 1);
  assert.deepEqual(models.dayPrecip.byTotal['0.04'], { days: 1, dry: 1 });
  assert.deepEqual(models.dayPrecip.byTotal['0.01'], { days: 1, dry: 1 });
  assert.equal(models.dayPrecip.byTotal['0.05'], undefined, 'no gauge total reached 0.05');
});
