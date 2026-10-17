import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {publishWeatherIndexSources} from '@red-cup-engineering/forecasting/weather-engine';
import {INDEX_CITIES} from '../src/weather-index.mjs';

const collector=async()=>({cities:{},errors:[]});
const seriesOf=ticker=>{
 const info=Object.values(INDEX_CITIES).find(x=>x.series===ticker);
 if(!info)throw new Error('unexpected hourly series');
 return {ticker,frequency:'hourly',
  contract_terms_url:`https://assets.kalshi.com/contract_terms/${info.terms}.pdf`};
};
const client=()=>({
 getSeries:async ticker=>seriesOf(ticker),
 getMarkets:async()=>[],
});

test('two-minute publisher leaves the previous original source/forecast pointer unchanged throughout a slow census',async t=>{
 const root=mkdtempSync(join(tmpdir(),'kalshi-index-atomic-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const initial=await publishWeatherIndexSources({root,sourceCollector:collector,marketClient:client()});
 const filename=join(root,'index-source.json'),previous=readFileSync(filename,'utf8');
 const firstPointer=JSON.parse(previous);
 assert.equal(firstPointer.evidenceId,initial.evidenceId);
 assert.equal(firstPointer.surface,null);

 let begin,release;
 const started=new Promise(resolve=>begin=resolve);
 const gate=new Promise(resolve=>release=resolve);
 let fired=false;
 const delayed={
  async getSeries(ticker){if(!fired){fired=true;begin();}await gate;return seriesOf(ticker);},
  async getMarkets(){return [];},
 };
 const pending=publishWeatherIndexSources({root,sourceCollector:collector,marketClient:delayed});
 try{
  await started;
  assert.equal(readFileSync(filename,'utf8'),previous,
    'a new index archive being prepared cannot erase the desk-accessible source pointer');
 }finally{release();}
 const done=await pending;
 const after=JSON.parse(readFileSync(filename,'utf8'));
 assert.equal(after.evidenceId,done.evidenceId);
 assert.equal(done.projectionError,null);
 assert.equal(done.hourlyMarketCoverage.length,Object.keys(INDEX_CITIES).length);
 assert.equal(after.surface,null,'absence of station forecast is visible and cannot be fabricated');
});

test('an unqualified venue census failure still admits the new source once, without inventing a forecast',async t=>{
 const root=mkdtempSync(join(tmpdir(),'kalshi-index-refusal-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const original=await publishWeatherIndexSources({root,sourceCollector:collector,marketClient:client()});
 const failure=await publishWeatherIndexSources({root,sourceCollector:collector,marketClient:{
  getSeries:async()=>{throw new Error('public market outage');},
  getMarkets:async()=>{throw new Error('must not be read without the series');},
 }});
 const record=JSON.parse(readFileSync(join(root,'index-source.json'),'utf8'));
 assert.equal(record.evidenceId,failure.evidenceId);
 assert.equal(failure.hourlyMarketCoverage.length,0);
 assert.equal(failure.errors.filter(x=>x.source==='Kalshi-hourly-census').length,Object.keys(INDEX_CITIES).length);
 assert.equal(record.surface,null);
 assert.ok(original.evidenceId);
});

test('the hourly projection reads its station evidence through the derived record and its stored source',async t=>{
 const {writeFileSync}=await import('node:fs');
 const {putEvidence,sealDerivedRecord}=await import('../src/weather-evidence-record.mjs');
 const root=mkdtempSync(join(tmpdir(),'kalshi-index-derived-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const source={at:'2026-10-10T12:00:00.000Z',stations:[],local:{},observations:{},errors:[],indices:{}};
 const sourceEvidenceId=await putEvidence(root,source);
 const row={station:'index:nyc',model:'kalshi-index-family-pool-v1/paired-family-fixed-share-v2',validTime:'2026-10-10T13:00:00.000Z'};
 const other={station:'index:nyc',model:'kalshi-index-family-pool-v1',validTime:'2026-10-10T13:00:00.000Z'};
 const record=sealDerivedRecord({sourceEvidenceId,at:source.at,dailyExtremes:{forecasts:[],gaps:[]},
  science:{at:source.at,scored:0,forecasted:2,parameters:{'index:nyc/m/0-3h':{ready:true},'KNYC/m/0-3h':{ready:true}},forecasts:[row,other]}});
 const stationEvidenceId=await putEvidence(root,record);
 assert.deepEqual(Object.keys(record.science.parameters),['index:nyc/m/0-3h']);
 assert.deepEqual(record.science.forecasts,[row]);
 writeFileSync(join(root,'latest.json'),JSON.stringify({at:source.at,forecasts:[{evidenceId:stationEvidenceId}]}));
 const done=await publishWeatherIndexSources({root,sourceCollector:collector,marketClient:client()});
 assert.equal(done.projectionError,null);
 const pointer=JSON.parse(readFileSync(join(root,'index-source.json'),'utf8'));
 assert.equal(pointer.evidenceId,done.evidenceId);
 assert.ok(pointer.surface,'a surface was projected from the joined station evidence');
 assert.equal(pointer.surface.stationEvidenceId,stationEvidenceId);
});
