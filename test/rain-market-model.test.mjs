import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseNbsBulletin } from '../src/nbm-station-guidance.mjs';
import { RAIN_MARKETS, rainCity, rainCityCode, rainProbability, combinedRainProbability, climateDayWindow, standardOffsetMs, decisionStage, priceRainMarket, rainStations } from '../src/rain-market-model.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/rain-record-rows.json', import.meta.url), 'utf8'));

test('the cross-fit halves reproduce the record\'s out-of-fold predictions row by row', () => {
  for (const f of fixtures) {
    const { pany, periods } = combinedRainProbability(f.rows, { date: f.date, zone: f.zone });
    assert.equal(periods, f.periods, f.ticker);
    assert.ok(Math.abs(pany - f.pany) < 1e-6, `${f.ticker} pany ${pany} vs ${f.pany}`);
    assert.ok(Math.abs(rainProbability(pany, f.dec, { fold: f.fold }) - f.pm) < 1e-5, `${f.ticker} ${rainProbability(pany, f.dec, { fold: f.fold })} vs ${f.pm}`);
  }
});

test('the frozen weights stay near the record\'s out-of-fold predictions and keep their ordering', () => {
  for (const f of fixtures) assert.ok(Math.abs(rainProbability(f.pany, f.dec) - f.pm) < 0.03, f.ticker);
  assert.ok(rainProbability(0, 'D-1 15h') < 0.001);
  assert.ok(rainProbability(0.999, 'D-1 21h') > 0.995);
  assert.ok(rainProbability(0.3, 'D-1 15h') < rainProbability(0.6, 'D-1 15h'));
  assert.throws(() => rainProbability(0.5, 'D 12h'));
});

test('the climate day is local standard time all year, and only periods whose midpoint is inside it count', () => {
  assert.equal(standardOffsetMs('America/New_York', 2026), -5 * 3600_000);
  assert.equal(standardOffsetMs('America/Phoenix', 2026), -7 * 3600_000);
  // Boston in October is on EDT but the climate day is EST: 05:00Z to 05:00Z
  assert.deepEqual(climateDayWindow('2026-10-04', 'America/New_York'), { start: Date.parse('2026-10-04T05:00:00Z'), end: Date.parse('2026-10-05T05:00:00Z') });
  const rows = ['06', '12', '18'].map((h) => ({ ftime: `2026-10-04T${h}:00:00Z`, p06: 50 })).concat([{ ftime: '2026-10-05T00:00:00Z', p06: 50 }, { ftime: '2026-10-05T06:00:00Z', p06: 90 }, { ftime: '2026-10-04T03:00:00Z', p06: 90 }]);
  // periods ending 06Z, 12Z, 18Z, 00Z, 06Z(next day) have midpoints 03Z (before 05Z: out), 09Z, 15Z, 21Z, 03Z next day (before 05Z: in); the 03Z-ending period of the same day (midpoint 00Z) is out
  const c = combinedRainProbability(rows, { date: '2026-10-04', zone: 'America/New_York' });
  assert.equal(c.periods, 4);
  assert.ok(Math.abs(c.pany - (1 - 0.5 ** 3 * 0.1)) < 1e-12);
});

test('decision stages follow the station-local clock on the day before the event only', () => {
  const at = (iso) => Date.parse(iso);
  const z = 'America/New_York';                                  // EDT in October: UTC-4
  assert.equal(decisionStage({ targetDate: '2026-10-05', zone: z, now: at('2026-10-04T18:59:00Z') }), null);     // 14:59 local
  assert.equal(decisionStage({ targetDate: '2026-10-05', zone: z, now: at('2026-10-04T19:00:00Z') }), 'D-1 15h');
  assert.equal(decisionStage({ targetDate: '2026-10-05', zone: z, now: at('2026-10-05T00:59:00Z') }), 'D-1 15h');
  assert.equal(decisionStage({ targetDate: '2026-10-05', zone: z, now: at('2026-10-05T01:00:00Z') }), 'D-1 21h');
  assert.equal(decisionStage({ targetDate: '2026-10-05', zone: z, now: at('2026-10-05T04:00:00Z') }), null);     // 00:00 on the day itself
  assert.equal(decisionStage({ targetDate: '2026-10-05', zone: 'America/Los_Angeles', now: at('2026-10-05T04:00:00Z') }), 'D-1 21h');
});

test('every KXRAIN city has a station, a CLI code, a region and a zone; aliases point at declared cities', () => {
  assert.equal(RAIN_MARKETS.settlement.traceCountsAsZero, true);
  assert.equal(RAIN_MARKETS.settlement.earlyClose.canCloseEarly, true);
  const codes = 'ABQ ATL AUS BOS CHI CLL CMH DAL DC DEN EWR HOU LAX LEX LV MIA MIN MKE NOLA NYC OKC PHIL PHX PIT PVD SATX SEA SFO SGF TTN'.split(' ');
  for (const code of codes) {
    const city = rainCity(code);
    assert.ok(city, code);
    assert.match(city.station, /^K[A-Z]{3}$/u); assert.match(city.cli, /^CLI[A-Z]{3}$/u); assert.ok(city.region && city.zone, code);
  }
  assert.equal(rainCity('CHI').station, 'KORD'); assert.equal(rainCity('CHI').cli, 'CLIORD'); assert.equal(rainCity('NYC').station, 'KNYC');
  assert.equal(rainCity('LV').station, 'KLAS'); assert.equal(rainCity('PHX').zone, 'America/Phoenix');
  for (const [code, city] of Object.entries(RAIN_MARKETS.cities)) if (city.alias) assert.equal(rainCity(city.alias).station, city.station, code);
  assert.equal(rainCity('ABQ').validated, false);
  assert.ok(!rainStations({ validatedOnly: true }).includes('KABQ'));
  assert.equal(rainCityCode('KXRAIN-26OCT04-BOS'), 'BOS');
  assert.equal(rainCityCode('KXRAINWKND-26OCT04-BOS'), null);
});

const bulletin = `
 KBOS    NBM V5.0 NBS GUIDANCE    10/03/2026  1500 UTC
 DT /OCT   3         /OCT   4                /OCT   6                /    
 UTC  09 12 15 18 21 00 03 06 09 12 15 18 21 00 03 06 09 12 15 18 21 00 03 
 FHR  06 09 12 15 18 21 24 27 30 33 36 39 42 45 48 51 54 57 60 63 66 69 72 
 TXN                 61          53          67          46          58   
 P06      0     1    38    39     3     0     0     0     0     0     0   
 Q06      0     0     5     6     0     0     0     0     0     0     0   
`;

test('the NBS parser reads P06 and Q06 beside the temperature rows', () => {
  const doc = parseNbsBulletin(bulletin).get('KBOS');
  const byTime = new Map(doc.rows.map((row) => [row.ftime, row]));
  assert.equal(doc.runtime, '2026-10-03T15:00:00.000Z');
  // P06 is blank on the 06Z/12Z-style odd columns and valid at FHR 09, 15, 21, ...: 6-hour periods ending 00Z, 06Z, 12Z, 18Z
  assert.equal(byTime.get('2026-10-04T00:00:00.000Z').p06, 0);   // FHR 09
  assert.equal(byTime.get('2026-10-04T06:00:00.000Z').p06, 1);   // FHR 15
  assert.equal(byTime.get('2026-10-04T12:00:00.000Z').p06, 38);  // FHR 21
  assert.equal(byTime.get('2026-10-04T12:00:00.000Z').q06, 5);
  assert.equal(byTime.get('2026-10-04T18:00:00.000Z').q06, 6);
  assert.equal(byTime.get('2026-10-03T21:00:00.000Z').p06, null);
  assert.equal(byTime.get('2026-10-04T06:00:00.000Z').txn, null);
});

test('a market is priced from live-shaped guidance only on the day before, only for fitted cities', () => {
  const doc = parseNbsBulletin(bulletin).get('KBOS');
  const guidance = { runtime: doc.runtime, stations: { KBOS: doc } };
  const now = Date.parse('2026-10-03T19:30:00Z');                // 15:30 EDT on Oct 3, the run is 4.5h old
  const priced = priceRainMarket({ ticker: 'KXRAIN-26OCT04-BOS' }, { guidance, now });
  assert.equal(priced.priced, true);
  assert.equal(priced.stage, 'D-1 15h');
  assert.equal(priced.station, 'KBOS'); assert.equal(priced.cli, 'CLIBOS'); assert.equal(priced.region, 'northeast');
  // the 2026-10-04 EST day is 05Z..05Z: periods ending 12Z(38), 18Z(39), 00Z(3), 06Z(0) are inside; the 06Z-ending one (1) has its midpoint at 03Z, before the day
  assert.equal(priced.periods, 4);
  assert.ok(Math.abs(priced.pany - (1 - 0.62 * 0.61 * 0.97)) < 1e-9);
  assert.ok(priced.probability > 0.5 && priced.probability < 0.7);
  assert.equal(priceRainMarket({ ticker: 'KXRAIN-26OCT04-BOS' }, { guidance, now: Date.parse('2026-10-04T12:00:00Z') }).priced, false);
  assert.match(priceRainMarket({ ticker: 'KXRAIN-26OCT04-BOS' }, { guidance, now: Date.parse('2026-10-04T02:00:00Z') }).reason, /old/u);
  assert.match(priceRainMarket({ ticker: 'KXRAIN-26OCT04-ABQ' }, { guidance, now }).reason, /no settled history/u);
  assert.match(priceRainMarket({ ticker: 'KXRAIN-26OCT04-NYC' }, { guidance, now }).reason, /no NBS block/u);
  assert.match(priceRainMarket({ ticker: 'KXRAINWKND-26OCT04-BOS' }, { guidance, now }).reason, /not a KXRAIN/u);
});
