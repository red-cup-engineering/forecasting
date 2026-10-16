import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scoreWeather} from '@red-cup-engineering/forecasting/weather-engine';
test('recovered hourly weather capability keeps unverified and post-settlement rows out of confidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'weather-grading-'));
 try{
  const row={id:'valid',ticker:'TEST',family:'hourly-temperature',source:'test',station:'index:test',ruleKey:'test-rule',stage:'0-6h',eventTicker:'TEST',targetDate:'2026-10-06',closeTime:'2026-10-06T20:00:00Z',at:'2026-10-06T18:00:00Z',mid:0.5,outcome:1,models:[{id:'synthetic-model',p:0.8}],settlementEvidenceVersion:1,settlement:{settledAt:'2026-10-06T21:00:00Z'}};
  const late={...row,id:'late',ticker:'LATE',eventTicker:'LATE',at:'2026-10-06T22:00:00Z'};
  const unverified={...row,id:'unverified',ticker:'UNVERIFIED',eventTicker:'UNVERIFIED',settlementEvidenceVersion:undefined};
  await writeFile(join(root,'resolved.jsonl'),[late,unverified,row].map(x=>JSON.stringify(x)).join('\n')+'\n');
  const result=await scoreWeather({root,client:{getMarkets:async()=>{throw Error('unexpected market request');}},now:Date.parse('2026-10-07T00:00:00Z')});
  // One valid row grades its station key and the pooled family/stage key; the late and unverified rows grade nothing.
  const grades=Object.values(result.grades);assert.equal(grades.length,2);for(const g of grades){assert.equal(g.events,1);assert.equal(g.dates,1);assert.equal(g.admitted,false);}
 }finally{await rm(root,{recursive:true,force:true});}
});
