import test from 'node:test';
import assert from 'node:assert/strict';
import {highBracketOutcomeInterval,modalHighReading} from '../src/weather-modal-outcomes.mjs';

const at='2026-10-11T21:00:00Z';
const contract=(overrides={})=>({
 ticker:'KXHIGHNY-26OCT11-T90',source:'twc',ruleKey:'rules-hash-123',
 strike_type:'greater',floor_strike:90,
 binding:{source:'twc',station:'KNYC',climateReport:'CLINYC',kind:'high',
   targetDate:'2026-10-11',timeZone:'America/New_York'},
 ...overrides,
});
const proxy=(floorPrecise=91,extra={})=>({observations:{
 'KNYC/2026-10-11':{station:'KNYC',date:'2026-10-11',count:5,
 latest:'2026-10-11T19:00:00Z',receivedAt:'2026-10-11T20:00:00Z',
 source:'https://api.weather.gov/stations/KNYC/observations',floorPrecise,...extra},
}});
const official=(lower,upper,extra={})=>({
 id:'climate-source-record-1',qualification:'verified-settlement-source-bound',
 source:'twc',ruleKey:'rules-hash-123',station:'KNYC',climateReport:'CLINYC',
 targetDate:'2026-10-11',observedAt:'2026-10-11T19:00:00Z',
 availableAt:'2026-10-11T20:00:00Z',lower,upper,...extra,
});

test('reuse the exact Kalshi bracket parser: strict less, strict greater, inclusive between',()=>{
 assert.deepEqual(highBracketOutcomeInterval(contract()),{lower:91,upper:Infinity});
 assert.deepEqual(highBracketOutcomeInterval(contract({strike_type:'less',cap_strike:91})),{lower:-Infinity,upper:90});
 assert.deepEqual(highBracketOutcomeInterval(contract({strike_type:'between',floor_strike:89,cap_strike:90})),{lower:89,upper:90});
 assert.equal(highBracketOutcomeInterval(contract({binding:{kind:'low',source:'twc'}})),null);
});

test('no source proof may be manufactured from an uncalibrated proxy spike',()=>{
 const reading=modalHighReading(contract(),proxy(91),{at});
 assert.equal(reading.status,'conditional-modal-research');
 assert.equal(reading.sourceBoundWitnessCount,0);
 assert.equal(reading.sourceConditional.support.for.length,0);
 assert.equal(reading.nwsProxyConditional.support.for.length,1);
 assert.equal(reading.nwsProxyConditional.sourceMismatch,true);
 assert.equal(reading.tradeEligible,false);
 assert.equal(reading.orderEffect,false);
 assert.ok(reading.sourceConditional.address);
 assert.ok(!reading.sourceConditional.cell.for.length);
});

test('a cooling NWS proxy cannot prove that a future warmer high is impossible',()=>{
 const r=modalHighReading(contract({floor_strike:105}),proxy(91),{at});
 assert.equal(r.nwsProxyConditional.support.for.length,0);
 assert.equal(r.nwsProxyConditional.support.against.length,0);
 assert.deepEqual(r.nwsProxyConditional.admissibleWorlds,{yes:true,no:true});
});

test('authoritative-source bounds support conditional necessity and impossibility in separate brackets',()=>{
 const above=modalHighReading(contract(),proxy(91),{at,verifiedSourceBounds:[official(91,Infinity)]});
 const below=modalHighReading(contract({strike_type:'less',cap_strike:91}),proxy(91),
   {at,verifiedSourceBounds:[official(91,Infinity)]});
 assert.equal(above.sourceConditional.support.for.length,1);
 assert.equal(below.sourceConditional.support.against.length,1);
 assert.equal(above.sourceConditional.cell.for.length,1);
 assert.equal(below.sourceConditional.cell.against.length,1);
 assert.equal(above.tradeEligible,false);
});

test('wrong station, report, date, rule or source cannot silently establish outcome',()=>{
 for(const patch of [{station:'KMIA'},{climateReport:'CLIMIA'},{source:'nws-cli'},
                     {ruleKey:'old-hash'},{targetDate:'2026-10-10'},
                     {qualification:'preliminary'}]) {
  const v=modalHighReading(contract(),proxy(),{at,verifiedSourceBounds:[official(91,Infinity,patch)]});
  assert.equal(v.sourceBoundWitnessCount,0,JSON.stringify(patch));
  assert.equal(v.sourceConditional.support.for.length,0,JSON.stringify(patch));
 }
});

test('late historical publication does not travel backward in the evidence order',()=>{
 const v=modalHighReading(contract(),proxy(91),
   {at:'2026-10-11T19:30:00Z',verifiedSourceBounds:[official(91,Infinity)]});
 assert.equal(v.sourceConditional.support.for.length,0);
 assert.equal(v.nwsProxyConditional.support.for.length,0);
 assert.equal(v.sourceConditional.withheld.length,1);
 assert.equal(v.nwsProxyConditional.withheld.length,1);
});

test('no archived receipt timestamp means no projection of the proxy into an earlier decision',()=>{
 const v=modalHighReading(contract(),proxy(91,{receivedAt:undefined}),{at});
 assert.equal(v.observationBoundWitnessCount,0);
 assert.deepEqual(v.nwsProxyConditional.support,{for:[],against:[]});
});

test('conflicting same-source certificates preserve both SignCell evidence slots',()=>{
 const yes=official(91,Infinity,{id:'yes-witness'});
 const no=official(-Infinity,88,{id:'no-witness'});
 const v=modalHighReading(contract(),{}, {at,verifiedSourceBounds:[yes,no]});
 assert.equal(v.sourceConditional.inconsistentPremises,true);
 assert.equal(v.sourceConditional.support.for.length,1);
 assert.equal(v.sourceConditional.support.against.length,1);
 assert.equal(v.sourceConditional.cell.for.length,1);
 assert.equal(v.sourceConditional.cell.against.length,1);
 assert.equal(v.tradeEligible,false);
});

test('same context and premises are reproducibly addressed',()=>{
 const bounds=[official(91,Infinity)];
 const a=modalHighReading(contract(),{}, {at,verifiedSourceBounds:bounds});
 const b=modalHighReading(contract(),{}, {at,verifiedSourceBounds:bounds.slice()});
 assert.equal(a.sourceConditional.address,b.sourceConditional.address);
});

test('source bounds alone do not remove correction or fair-price fallback assumptions',()=>{
 const v=modalHighReading(contract(),{}, {at,verifiedSourceBounds:[official(91,Infinity)]});
 assert.ok(v.sourceConditional.assumptions.some(s=>s.includes('fair-price fallback')));
 assert.equal(v.tradeEligible,false);
});
