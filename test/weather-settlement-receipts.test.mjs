import test from 'node:test';
import assert from 'node:assert/strict';
import {climateReportEvidence,sourceReport,settlementWeatherEvidence} from '../src/weather-settlement-source.mjs';

const date='2026-10-11';
const contract={binding:{source:'twc',targetDate:date,station:'KNYC'}};
const received='2026-10-11T23:00:00Z';
const report=(results,{receivedAt=received,evidenceDigest='evidence-sha'}={})=>({
  retrievedAt:received,
  daily:{[date]:{source:'https://weather.com/kalshi/api/climate/primary?date='+date,
    receivedAt,evidenceDigest,data:{results}}},
});
const row=(station='KNYC',high=91,status='final')=>({
  station:{icao:station},status,data:{maxTemp:high},
});

test('one exact source report preserves receipt time, content witness and station identity',()=>{
 const e=report([row()]);
 const r=sourceReport(contract,e);
 assert.equal(r.status,'final');
 assert.equal(r.receivedAt,received);
 assert.equal(r.evidenceDigest,'evidence-sha');
 assert.equal(r.date,date);
 assert.deepEqual(r.data,{maxTemp:91});
 assert.equal(r.conflicted,false);
});

test('contradictory same-station official rows are preserved, not silently first-wins',()=>{
 const r=sourceReport(contract,report([row('KNYC',90,'preliminary'),row('KNYC',94,'final')]));
 assert.equal(r.status,'ambiguous-station-reports');
 assert.equal(r.conflicted,true);
 assert.equal(r.candidateCount,2);
 assert.deepEqual(r.candidates.map(x=>x.data.maxTemp),[90,94]);
 assert.equal(r.data,undefined);
 assert.equal(r.receivedAt,received);
});

test('duplicate rows also remain explicit when values accidentally agree',()=>{
 const r=sourceReport(contract,report([row(),row()]));
 assert.equal(r.status,'ambiguous-station-reports');
 assert.equal(r.candidateCount,2);
});

test('missing and malformed station rows do not crash or invent a source reading',()=>{
 assert.equal(sourceReport(contract,report([{status:'bad'},{station:null},row('KLAX')])),null);
 assert.equal(sourceReport(contract,{daily:{[date]:{data:{results:null}}}}),null);
 assert.equal(sourceReport({binding:{...contract.binding,source:'nws-cli'}},report([row()])),null);
});

test('older source archives with only an end-of-cycle receipt are conservatively time-labeled',()=>{
 const e=report([row()]);
 delete e.daily[date].receivedAt;
 const r=sourceReport(contract,e);
 assert.equal(r.receivedAt,received);
 assert.equal(r.evidenceDigest,'evidence-sha');
});

test('report fetch preserves independent primary and international receipts and content hashes',async()=>{
 const calls=[];
 const get=async url=>{
  calls.push(String(url));
  return {ok:true,json:async()=>({results:[row()]})};
 };
 const before=Date.now();
 const e=await climateReportEvidence({dates:[date,date],now:Date.parse('2026-10-12T08:00:00Z'),fetchImpl:get});
 assert.equal(e.errors.length,0);
 assert.equal(calls.length,2);
 assert.ok(calls.some(url=>url.includes('/primary?date='+date)));
 assert.ok(calls.some(url=>url.includes('/international?date='+date)));
 assert.ok(Date.parse(e.daily[date].receivedAt)>=before);
 assert.ok(Date.parse(e.daily[date].receivedAt)<=Date.now());
 assert.equal(e.daily[date].evidenceDigest,e.international[date].evidenceDigest);
 assert.equal(sourceReport(contract,e).status,'final');
});

test('a failed source fetch becomes an explicit evidence gap, never a null-equivalent successful report',async()=>{
 const get=async url=>({
   ok:!String(url).includes('primary'),status:503,json:async()=>({results:[row()]}),
 });
 const e=await settlementWeatherEvidence([contract],{now:Date.parse('2026-10-12T08:00:00Z'),fetchImpl:get});
 assert.equal(e.errors.length,1);
 assert.equal(e.errors[0].source,'TWC-primary');
 assert.equal(sourceReport(contract,e),null);
 assert.ok(e.international[date].receivedAt);
});
