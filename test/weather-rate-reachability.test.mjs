import test from 'node:test';
import assert from 'node:assert/strict';
import {temperatureBracketOutcomeInterval,modalTemperatureReading} from '../src/weather-modal-outcomes.mjs';

const at='2026-10-11T21:00:00Z';
const high={
  ticker:'KXHIGHNY-26OCT11-T90',source:'twc',ruleKey:'rules-hash-123',
  strike_type:'greater',floor_strike:90,
  binding:{kind:'high',source:'twc',station:'KNYC',climateReport:'CLINYC',
    targetDate:'2026-10-11',timeZone:'America/New_York'},
};
const low={...high,ticker:'KXLOWTNY-26OCT11-T58',
  strike_type:'less',cap_strike:58,
  binding:{...high.binding,kind:'low'}};
const segment=(lower,upper,other={})=>({
 id:'sample-assumption',rateLowerPerHour:lower,rateUpperPerHour:upper,
 observedAt:'2026-10-11T20:00:00Z',availableAt:'2026-10-11T20:30:00Z',
 until:'2026-10-11T23:00:00Z',...other,
});
const scenario=(market,initial,extreme,lowerRate,upperRate,other={})=>({
 id:'scenario-candidate',kind:market.binding.kind,
 source:market.source,ruleKey:market.ruleKey,station:market.binding.station,
 climateReport:market.binding.climateReport,targetDate:market.binding.targetDate,
 endAt:'2026-10-11T23:00:00Z',temperature:{lower:initial,upper:initial},
 achievedExtreme:{lower:extreme,upper:extreme},
 segments:[segment(lowerRate,upperRate)],...other,
});

test('daily high and daily low contracts share the venue bracket interpreter',()=>{
 assert.deepEqual(temperatureBracketOutcomeInterval(high),{lower:91,upper:Infinity});
 assert.deepEqual(temperatureBracketOutcomeInterval(low),{lower:-Infinity,upper:57});
});

test('low proxy upper bound remains separate from the source report',()=>{
 const evidence={observations:{'KNYC/2026-10-11':{
  count:3,station:'KNYC',date:'2026-10-11',ceilingPrecise:57,
  latest:'2026-10-11T19:00:00Z',receivedAt:'2026-10-11T20:00:00Z',
  source:'https://api.weather.gov/stations/KNYC/observations',
 }}};
 const r=modalTemperatureReading(low,evidence,{at});
 assert.equal(r.nwsProxyConditional.support.for.length,1);
 assert.equal(r.sourceConditional.support.for.length,0);
 assert.equal(r.tradeEligible,false);
});

test('two hours of HYPOTHETIC guaranteed cooling can rule out another high',()=>{
 const r=modalTemperatureReading(high,{}, {at,rateScenario:scenario(high,80,88,-5,-1)});
 assert.equal(r.rateConditional.status,'conditional-hypothetical-rate-reachability');
 assert.deepEqual(r.rateConditional.envelope.finalExtreme,{lower:88,upper:88});
 assert.equal(r.rateConditional.support.against.length,1);
 assert.equal(r.sourceConditional.support.against.length,0);
 assert.equal(r.tradeEligible,false);
 assert.equal(r.orderEffect,false);
});

test('hypothetical sustained warming can require an above-90 outcome',()=>{
 const r=modalTemperatureReading(high,{}, {at,rateScenario:scenario(high,80,88,6,8)});
 assert.deepEqual(r.rateConditional.integerExtreme,{lower:92,upper:96});
 assert.equal(r.rateConditional.support.for.length,1);
 assert.equal(r.sourceConditional.support.for.length,0);
 assert.equal(r.rateConditional.tradeEligible,false);
});

test('the same upstream rate law derives low-temperature outcome consequences',()=>{
 const r=modalTemperatureReading(low,{}, {at,rateScenario:scenario(low,60,59,-4,-2)});
 assert.deepEqual(r.rateConditional.envelope.finalExtreme,{lower:52,upper:56});
 assert.equal(r.rateConditional.support.for.length,1);
 assert.equal(r.sourceConditional.support.for.length,0);
});

test('potentially significant half-degree tie stays possible, not necessary',()=>{
 const r=modalTemperatureReading(high,{}, {
  at,rateScenario:scenario(high,90.5,90.5,0,0),
 });
 assert.deepEqual(r.rateConditional.integerExtreme,{lower:90,upper:91});
 assert.deepEqual(r.rateConditional.admissibleWorlds,{yes:true,no:true});
 assert.deepEqual(r.rateConditional.support,{for:[],against:[]});
});

test('identity mismatches never make the wrong contract necessary',()=>{
 const base=scenario(high,80,88,-5,-1);
 for(const change of [{source:'nws-cli'},{ruleKey:'stale'},
   {targetDate:'2026-10-10'},{climateReport:'CLIWRONG'},
   {station:'KLAX'},{kind:'low'}]) {
  const r=modalTemperatureReading(high,{}, {at,rateScenario:{...base,...change}});
  assert.equal(r.rateConditional.status,'unmatched-hypothetical-rate-scenario');
  assert.equal(r.sourceConditional.support.against.length,0);
  assert.equal(r.tradeEligible,false);
 }
});

test('missing horizon or unavailable-rate model fails closed',()=>{
 const base=scenario(high,80,88,-5,-1);
 const a=modalTemperatureReading(high,{}, {at,rateScenario:{...base,segments:[]}});
 assert.equal(a.rateConditional.status,'incomplete-rate-horizon');
 assert.deepEqual(a.rateConditional.support,{for:[],against:[]});
 const b=modalTemperatureReading(high,{}, {at,rateScenario:{
  ...base,segments:[segment(-5,-1,{availableAt:'2026-10-11T22:00:00Z'})],
 }});
 assert.equal(b.rateConditional.status,'rate-bound-not-yet-available');
 assert.deepEqual(b.rateConditional.support,{for:[],against:[]});
});

test('independent source certificate and hypothetical dynamics remain separate even when they disagree',()=>{
 const verified={id:'source-lower',qualification:'verified-settlement-source-bound',
  source:'twc',ruleKey:high.ruleKey,station:high.binding.station,
  climateReport:high.binding.climateReport,targetDate:high.binding.targetDate,
  lower:91,upper:Infinity,
  observedAt:'2026-10-11T20:00:00Z',availableAt:'2026-10-11T20:30:00Z',
 };
 const r=modalTemperatureReading(high,{}, {at,verifiedSourceBounds:[verified],
  rateScenario:scenario(high,80,88,-5,-1)});
 assert.equal(r.sourceConditional.support.for.length,1);
 assert.equal(r.rateConditional.support.against.length,1);
 assert.notEqual(r.sourceConditional.address,r.rateConditional.address);
 assert.equal(r.tradeEligible,false);
});

test('path hypotheses require explicit issuance, source, and rate coverage',()=>{
 const broken=scenario(high,80,88,-5,-1,{
  segments:[segment(-5,-1,{until:'2026-10-12T01:00:00Z'})],
 });
 assert.throws(()=>modalTemperatureReading(high,{}, {at,rateScenario:broken}),RangeError);
 assert.equal(modalTemperatureReading({...high,binding:{...high.binding,kind:'rain'}},{},{at}).status,
  'unsupported-or-unbound-temperature-contract');
});
