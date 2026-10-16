import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { admitCanonicalJson, JSON_RESOURCE_ENVELOPE } from '@red-cup-engineering/json-services-section/canonical-json';
import { verifyNiUri } from '@red-cup-engineering/uri-services-section/ni-uri';
import { parseMetar, latestMetar, readNwsMetarSnapshot, admitNwsMetarSnapshot, asosWholeCelsiusPreimage, wholeCelsiusTemperatureInterval, preciseBounds, withMetar, METAR_FEED } from '../src/station-observations.mjs';

const report = 'KBOS 131710Z 12005KT 7SM OVC008 13/12 A3002 RMK AO2 CIG 005V012 T01330122';
const bulletin = `2026/10/13 17:10\n${report}\n`;
const bytes = text => new TextEncoder().encode(text);
const response = text => new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
const now = () => '2026-10-13T17:12:00.000Z';

test('independently retained live NOAA source reproduces its exact NI identity and parsed reading', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/nws-metar-KDLH-20261013.json',import.meta.url),'utf8'));
  assert.equal(fixture.source.identity,'ni:///sha-256;u-IibLavCKaqde4HLBmiAQk-9MQ-HWzQ-C2U0l8-iIw');
  assert.equal(fixture.source.bytes,97);
  assert.equal(verifyNiUri(bytes(fixture.source.text),fixture.source.identity),true);
  assert.equal(fixture.observation.temperatureF,50);
  assert.equal(fixture.observation.at,'2026-10-13T21:15:00.000Z');
  assert.equal(fixture.source.freshness.observedAgeSeconds,520.002);
  const replay = await readNwsMetarSnapshot({station:'KDLH'}, {now:()=>fixture.source.receivedAt,fetchImpl:async()=>response(fixture.source.text)});
  // The acquisition receipt belongs to this read, not to the retained source.
  const {transport,...source}=replay.source;
  assert.deepEqual(transport,{attempts:1,rateLimits:[]});
  assert.deepEqual({...replay,source},fixture);
});

test('latestMetar retains the exact parsed report API and an admitted injectable feed', async () => {
  let call;
  const value = await latestMetar({ station: 'KBOS' }, { feed: 'https://fixture.example/metar', fetchImpl: async (url, init) => { call = { url, init }; return response(bulletin); } });
  assert.deepEqual(value, parseMetar(report, Date.parse('2026-10-13T17:10:00Z')));
  assert.deepEqual(Object.keys(value).sort(), ['at', 'precisionF', 'raw', 'station', 'synoptic', 'temperatureF']);
  assert.equal(value.temperatureF, 55.94);
  assert.equal(value.precisionF, 0.09);
  assert.equal(String(call.url), 'https://fixture.example/metar/KBOS.TXT');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.signal instanceof AbortSignal, true);
  assert.equal(await latestMetar({ station: 'KBOS' }, { fetchImpl: async () => response('') }), null);
});

test('malformed station paths are refused before the supplier runs', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(bulletin); };
  for (const station of [null, false, 0, '', ' ', 'kbos', 'KBOS/../EGLL', 'KBOS?url=private', ['KBOS'], {}, 'KBOS.TXT', 'KBO']) {
    await assert.rejects(latestMetar({ station }, { fetchImpl }), TypeError);
  }
  assert.equal(calls, 0);
});

test('original bulletin bytes and rights survive the bounded canonical snapshot', async () => {
  const text = '\uFEFF' + bulletin.replaceAll('\n', '\r\n');
  let url;
  const value = await readNwsMetarSnapshot({ station: 'KBOS' }, { now, fetchImpl: async input => { url = input; return response(text); } });
  assert.equal(String(url), `${METAR_FEED}/KBOS.TXT`);
  assert.equal(value.source.text, text);
  assert.equal(value.source.bytes, bytes(text).byteLength);
  assert.equal(verifyNiUri(bytes(value.source.text), value.source.identity), true);
  assert.equal(verifyNiUri(bytes(text + ' '), value.source.identity), false);
  assert.equal(value.source.receivedAt, now());
  assert.equal(value.source.issuedAt, '2026-10-13T17:10:00.000Z');
  assert.equal(value.source.rights.authority, 'https://www.weather.gov/disclaimer/');
  assert.match(value.source.rights.modifications, /source text is unchanged/u);
  assert.match(value.source.rights.notice, /no NOAA or NWS endorsement/u);
  const carrier = admitCanonicalJson(JSON.stringify(value), { ...JSON_RESOURCE_ENVELOPE, maxSourceBytes: 16384, maxCanonicalBytes: 16384 });
  assert.deepEqual(carrier.value, value);
});

test('only continental US stations and the public fixed source are admitted', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(bulletin); };
  for (const request of [null, [], {}, { station: 'EGLL' }, { station: 'kbos' }, { station: 'PHNL' }, { station: 'KJFK/other' }, { station: 'KBOS', feed: 'https://private.example' }, { station: 'KBOS', date: '2020-01-01' }, { station: 'KBOS', root: '/private' }]) {
    assert.throws(() => admitNwsMetarSnapshot(request), TypeError);
    await assert.rejects(readNwsMetarSnapshot(request, { fetchImpl }), TypeError);
  }
  assert.equal(calls, 0);
  assert.deepEqual(admitNwsMetarSnapshot({ station: 'KBOS' }), { station: 'KBOS' });
  for (const station of ['KDLH','KMSP','KJFK','KDEN','KLAX']) assert.deepEqual(admitNwsMetarSnapshot({station}),{station});
});

test('successful source receipt states measured age and refuses stale or future latest reports', async () => {
  const snapshot = options => readNwsMetarSnapshot({station:'KBOS'}, {fetchImpl:async()=>response(bulletin), ...options});
  const fresh = await snapshot({now});
  assert.deepEqual(fresh.source.freshness,{observedAgeSeconds:120,bulletinAgeSeconds:120,maximumAgeSeconds:7200});
  const boundary = await snapshot({now:()=> '2026-10-13T19:10:00.000Z'});
  assert.equal(boundary.source.freshness.observedAgeSeconds,7200);
  await assert.rejects(snapshot({now:()=> '2026-10-13T19:10:00.001Z'}),/freshness bound/);
  await assert.rejects(snapshot({now:()=> '2026-10-13T17:09:59.999Z'}),/future source/);
  await assert.rejects(snapshot({now:()=> '2026-10-13T17:12:00Z'}),/canonical UTC/);
  await assert.rejects(snapshot({now:()=> 'not-time'}),/canonical UTC/);
});

test('a different admitted US station retains its own original identity and source', async () => {
  const value = await readNwsMetarSnapshot({station:'KDLH'}, {now,fetchImpl:async url=> {
    assert.equal(String(url),`${METAR_FEED}/KDLH.TXT`);
    return response(bulletin.replaceAll('KBOS','KDLH'));
  }});
  assert.equal(value.observation.station,'KDLH');
  assert.equal(verifyNiUri(bytes(value.source.text),value.source.identity),true);
});

test('station mismatch, impossible issue stamps and multi-report sources are refused', async () => {
  for (const source of [bulletin.replace('KBOS', 'EGLL'), bulletin.replace('2026/10/13', '2026/02/30'), bulletin.replace('17:10', '24:10'), bulletin + report, bulletin.replace('2026/10/13 17:10', '<html>')]) {
    await assert.rejects(latestMetar({ station: 'KBOS' }, { fetchImpl: async () => response(source) }), Error);
  }
  await assert.rejects(readNwsMetarSnapshot({ station: 'KBOS' }, { now, fetchImpl: async () => response(bulletin.replace('131710Z', '131711Z')) }), /later than its bulletin/u);
});

test('the upstream HTTP reader cancels an oversized stream and strict UTF-8 is required', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(bytes('X'.repeat(4097))); }, cancel() { cancelled = true; } });
  await assert.rejects(latestMetar({ station: 'KBOS' }, { fetchImpl: async () => new Response(body) }), error => error.code === 'body-too-large');
  assert.equal(cancelled, true);
  await assert.rejects(latestMetar({ station: 'KBOS' }, { fetchImpl: async () => new Response(new Uint8Array([255])) }), TypeError);
});

test('redirected, failed and absent source reports cannot be sold as a snapshot', async () => {
  for (const source of [new Response('', { status: 503 }), new Response('', { status: 302 }), response(''), response('2026/10/13 17:10\nKBOS 139970Z 00/00\n')]) {
    await assert.rejects(readNwsMetarSnapshot({ station: 'KBOS' }, { now, fetchImpl: async () => source }), Error);
  }
  const redirected = response(bulletin);
  Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(readNwsMetarSnapshot({ station: 'KBOS' }, { now, fetchImpl: async () => redirected }), /must not redirect/u);
  const drift = response(bulletin);
  Object.defineProperty(drift, 'url', { value: 'https://other.example/KBOS.TXT' });
  await assert.rejects(latestMetar({ station: 'KBOS' }, { fetchImpl: async () => drift }), /must not redirect/u);
});

test('pure parser retains measured zeros and valid month rollover without inventing calendar times', () => {
  const issued = Date.parse('2026-03-01T00:01:00Z');
  assert.equal(parseMetar('KBOS 282359Z 00/00', issued).at, '2026-02-28T23:59:00.000Z');
  assert.equal(parseMetar('KBOS 282359Z 00/00', issued).temperatureF, 32);
  assert.equal(parseMetar('KBOS 131710Z M01/M01 RMK T10001000', Date.parse('2026-10-13T17:10:00Z')).temperatureF, 32);
  for (const raw of ['KBOS 002359Z 00/00', 'KBOS 282460Z 00/00', 'KBOS 312359Z 00/00', null]) assert.equal(parseMetar(raw, issued), null);
  assert.equal(parseMetar(report, NaN), null);
});

test('ASOS conditional whole-C observation maps to exact whole-F preimage intervals, not naive conversion',()=>{
 assert.deepEqual(asosWholeCelsiusPreimage(10).integerF,[50]);
 assert.deepEqual(asosWholeCelsiusPreimage(11).integerF,[51,52]);
 assert.deepEqual(asosWholeCelsiusPreimage(13).integerF,[55,56]);
 assert.deepEqual(asosWholeCelsiusPreimage(-1).integerF,[30,31]);
 assert.deepEqual([asosWholeCelsiusPreimage(11).lowerF,asosWholeCelsiusPreimage(11).upperFExclusive],[50.5,52.5]);
});

test('conditional inversion is exhaustive across cold and warm Celsius temperatures',()=>{
 const roundC=f=>Math.floor((f-32)*5/9+0.5);
 for(let c=-60;c<=70;c++){
  const got=asosWholeCelsiusPreimage(c);
  const brute=Array.from({length:451},(_,i)=>i-200).filter(f=>roundC(f)===c);
  assert.deepEqual(got.integerF,brute,`C=${c}`);
  assert.equal(got.upperFExclusive-got.lowerF,brute.length);
  assert.ok(brute.every(f=>f>=got.lowerF&&f<got.upperFExclusive));
 }
});

test('quantization law refuses fractional and unbounded inputs without changing ordinary METAR parser',()=>{
 for(const c of [NaN,Infinity,10.1,'11',null,undefined,201,-201])
  assert.throws(()=>asosWholeCelsiusPreimage(c),TypeError);
 const report=parseMetar('KBOS 131710Z 11/05',Date.parse('2026-10-13T17:10:00Z'));
 assert.equal(report.temperatureF,51.8);
 assert.ok(report.precisionF>=1.3-1e-12,'whole-F preimage can extend below 0.9F half-width');
 assert.equal(report.integerF,undefined,'ordinary reports are not silently promoted to certified ASOS preimages');
});

test('coarse whole Celsius observation conservatively contains two possible conversion paths',()=>{
 const p=wholeCelsiusTemperatureInterval(11);
 assert.equal(p.lowerF,50.5);
 assert.ok(Math.abs(p.upperFExclusive-52.7)<1e-12);
 const q=wholeCelsiusTemperatureInterval(10);
 assert.ok(q.lowerF<49.2&&q.upperFExclusive>50.8,'direct Celsius rounding is not narrowed to an assumed firmware law');
 for(const c of [-40,-1,0,11,22,60]){
  const p=wholeCelsiusTemperatureInterval(c),f=c*9/5+32;
  assert.ok(p.lowerF<=f-.9+1e-12&&p.upperFExclusive>=f+.9-1e-12);
  const a=asosWholeCelsiusPreimage(c);
  assert.ok(p.lowerF<=a.lowerF&&p.upperFExclusive>=a.upperFExclusive);
 }
});

test('station extremum uses asymmetric whole-C intervals instead of an unsafe 0.9F half-width',()=>{
 const report=parseMetar('KBOS 141200Z 11/05',Date.parse('2026-10-14T12:00:00Z'));
 assert.ok(report.lowerF<=50.5);
 assert.ok(report.upperFExclusive>=52.7-1e-12);
 const obs={station:'KBOS',date:'2026-10-14',from:'2026-10-14T04:00:00Z',count:0,
  readings:[],synoptic:[],maxF:null,minF:null};
 const combined=withMetar(obs,report);
 assert.equal(combined.count,1);
 assert.ok(combined.readings[0].lowerF<=50.5);
 assert.equal(combined.floorPrecise,50);
 assert.equal(combined.ceilingPrecise,53);
 assert.deepEqual(preciseBounds([{temperatureF:51.8,precisionF:.9,lowerF:50.5,upperFExclusive:52.7}]),
  {floorPrecise:50,ceilingPrecise:53});
});

test('a valid tenths-C T-group retains distinct precision and is not silently widened as whole C',()=>{
 const report=parseMetar('KBOS 141200Z 11/05 RMK AO2 T01050050',Date.parse('2026-10-14T12:00:00Z'));
 assert.equal(report.precisionF,.09);
 assert.equal(report.lowerF,undefined);
 assert.equal(report.upperFExclusive,undefined);
});
