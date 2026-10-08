import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseNbhBulletin} from '../../../../src/nbm-hourly-guidance.mjs';
import {deriveDailyTemperatureExtremes,extremeCdf,extremeBracketProbability,priceDailyTemperatureExtreme} from '../../../../src/weather-temperature-extremes.mjs';
import {studentTCdf} from '../../../../src/temperature-distribution.mjs';
import {probabilityBand,allocateWeather} from '../../../../src/weather-learning.mjs';
import {weatherEstimates} from '../../../../src/weather-evidence.mjs';
const points=[{meanF:50,scaleF:1},{meanF:49,scaleF:8}];
for(const kind of ['high','low']){
 let previous=0;
 for(let x=-50;x<=150;x+=0.25){
  const d={kind,points},cdf=extremeCdf(x,d),fs=points.map(p=>studentTCdf((x-p.meanF)/p.scaleF,5)),independent=kind==='high'?fs.reduce((s,p)=>s*p,1):1-fs.reduce((s,p)=>s*(1-p),1);
  assert(cdf.low<=cdf.p+1e-12&&cdf.p<=cdf.high+1e-12);assert(cdf.low<=independent+1e-12&&independent<=cdf.high+1e-12);assert(cdf.p>=previous-1e-12);previous=cdf.p;
 }
 for(const bound of [null,48]){
  const d={kind,points,observedBound:bound};let mass=extremeBracketProbability({strikeType:'less',capStrike:0},d).p;
  for(let v=0;v<100;v++)mass+=extremeBracketProbability({strikeType:'between',floorStrike:v,capStrike:v},d).p;
  mass+=extremeBracketProbability({strikeType:'greater',floorStrike:99},d).p;assert(Math.abs(mass-1)<1e-12);
 }
}
assert(extremeCdf(60,{kind:'high',points}).p<studentTCdf(10,5)-0.05,'lower mean with larger uncertainty contributes high tail');
assert(extremeCdf(40,{kind:'high',points,observedBound:48}).p>0,'proxy witness retains disagreement mass');
assert(extremeCdf(60,{kind:'low',points,observedBound:48}).p<1,'proxy witness retains disagreement mass');
assert.throws(()=>extremeCdf(0,{kind:'high',points:[{meanF:0,scaleF:0}]}));
const now=Date.parse('2026-10-07T12:30:00Z'),runtime=Date.parse('2026-10-07T12:00:00Z');
const packet={at:new Date(now).toISOString(),stations:[{station:'KJFK',timeZone:'America/New_York',targetDates:['2026-10-07','2026-10-08']}],hourlyGuidance:{runtime:new Date(runtime).toISOString(),source:'frozen synthetic NOAA-schema calculation',stations:{KJFK:{rows:Array.from({length:25},(_,i)=>({ftime:new Date(runtime+(i+1)*3600000).toISOString(),tmp:60+Math.sin(i/5)*10,tsd:2+i/10}))}}},observations:{'KJFK/2026-10-07':{count:6,floor:61,ceiling:55,latest:'2026-10-07T12:20:00Z'}},local:{}};
const result=deriveDailyTemperatureExtremes(packet,{now});assert.equal(result.forecasts.length,2);assert.equal(result.gaps.length,1);assert.equal(result.forecasts[0].dayStart,'2026-10-07T05:00:00.000Z');assert.equal(result.forecasts[0].dayEndExclusive,'2026-10-08T05:00:00.000Z');assert.equal(result.forecasts[0].points.at(-1).at,'2026-10-08T04:59:59.999Z');assert.equal(result.forecasts[0].points[0].at,new Date(now).toISOString());assert.match(result.forecasts[0].points[0].boundary,/held back/);
const before=structuredClone(packet),beforeNow=Date.parse('2026-10-06T23:00:00Z');before.at=new Date(beforeNow).toISOString();before.stations=[{station:'KJFK',timeZone:'UTC',targetDates:['2026-10-07']}];before.hourlyGuidance.runtime=before.at;before.hourlyGuidance.stations.KJFK.rows=Array.from({length:25},(_,i)=>({ftime:new Date(beforeNow+(i+1)*3600000).toISOString(),tmp:60+i/2,tsd:3}));before.observations={};const preday=deriveDailyTemperatureExtremes(before,{now:beforeNow});assert.equal(preday.forecasts.length,2);assert.equal(preday.forecasts[0].observedBound,null);assert.equal(preday.forecasts[0].points[0].at,'2026-10-07T00:00:00.000Z');
const contract={binding:{station:'KJFK',timeZone:'America/New_York',targetDate:'2026-10-07',kind:'high',proxy:true},strike_type:'greater',floor_strike:65};
const model=priceDailyTemperatureExtreme(contract,{...packet,dailyExtremes:result},now);assert(model);assert.equal(weatherEstimates(contract,{...packet,dailyExtremes:result},now).filter(m=>m.id.startsWith('nbm-nbh-comonotone')).length,1);
assert.equal(priceDailyTemperatureExtreme(contract,{...packet,dailyExtremes:result},now-1),null);assert.equal(priceDailyTemperatureExtreme(contract,{...packet,dailyExtremes:result},now+16*60000),null);
for(const change of [e=>e.hourlyGuidance.stations.KJFK.rows.splice(6,1),e=>e.hourlyGuidance.stations.KJFK.rows[8].tsd=null,e=>e.hourlyGuidance.runtime='2026-10-07T13:00:00Z',e=>e.observations['KJFK/2026-10-07'].latest='2026-10-07T13:00:00Z',e=>e.observations['KJFK/2026-10-07'].count=2]){
 const e=structuredClone(packet);change(e);assert.equal(deriveDailyTemperatureExtremes(e,{now}).forecasts.length,0);
}
const realBlocks=await readFile(new URL('../../2026-10-07-hourly-weather-index/fixtures/nbh-station-blocks.txt',import.meta.url),'utf8'),realStations=Object.fromEntries(parseNbhBulletin(realBlocks,['KMIA'])),realPacket=structuredClone(packet);realPacket.at='2026-10-07T11:55:05.294Z';realPacket.stations=[{station:'KMIA',timeZone:'America/New_York',targetDates:['2026-10-07']}];realPacket.hourlyGuidance={runtime:'2026-10-07T10:00:00.000Z',stations:realStations,source:'https://noaa-nbm-grib2-pds.s3.amazonaws.com/blend.20261007/10/text/blend_nbhtx.t10z'};realPacket.observations={'KMIA/2026-10-07':{count:3,floor:77,ceiling:78,latest:'2026-10-07T11:50:00Z'}};const realDerived=deriveDailyTemperatureExtremes(realPacket,{now:Date.parse(realPacket.at)});assert.equal(realDerived.forecasts.length,2);assert(realDerived.forecasts[0].points.some(p=>p.meanF===88));assert(realDerived.forecasts[0].points.some(p=>p.scaleF>2));
const c={family:'daily-temperature',source:'TWC',station:'KJFK',ruleKey:'frozen',stage:'0-6h'},m={id:'test',p:0.8,details:{structuralProbabilityBounds:{low:0.2,high:0.95}}},key=Object.values(c).join('/')+'/'+m.id;
const bins=Array.from({length:10},()=>({n:30,low:0.7,high:0.9})),grades={[key]:{admitted:true,bins}};
const band=probabilityBand(c,m,grades);assert(band.admitted);assert.equal(band.low,0.2);assert.equal(band.high,0.95);assert(!probabilityBand(c,m,{}).admitted);
const invalid=probabilityBand(c,{...m,details:{structuralProbabilityBounds:{low:0.9,high:0.95}}},grades);assert(!invalid.admitted);assert.equal(invalid.low,0);assert.equal(invalid.high,1);
const quoted={ticker:'TEST',eventTicker:'EVENT',targetDate:'2026-10-07',closeTime:'2026-10-08T00:00:00Z',price:0.5,fee:0.02,depth:100,admitted:true,winLower:band.low,edge:band.low-0.52};assert.equal(allocateWeather([quoted],{capitalUsd:100}).orders.length,0);
console.log(JSON.stringify({checks:'daily path CDF, independent dependence witnesses, coherent whole-degree ladders, proxy disagreement, standard-time window, missing/future source refusal, authoritative candidate-band widening and cash allocation',assertions:'passed',newModelAdmitted:false,orders:0}));
