#!/usr/bin/env node
/** Past-only rolling backtest of the hourly city-index forecast from frozen NBH guidance and published index minutes.
 *
 * Usage: node hourly-index-backtest.mjs <cacheDir> <firstEvalDay> <lastEvalDay> [out.json] [--fit <fit.json> --record <path>]
 *
 * Data come from `hourly-index-backtest-data.mjs`. For every NBH cycle c (every third hour) the decision is
 * made at T = c + 2 h, after the bulletin is public (observed publication lag is about 1.4 h), with the latest
 * published index minute at or before T as the anchor. Targets are the whole hours T+1 ... T+12.
 * On each evaluation day every parameter is refitted on decisions whose targets were all settled before that
 * day started; nothing from the evaluation day or later is used.
 *
 * Models (all Student-t, 5 degrees of freedom, as in `weather-index.mjs`):
 *  nbh              guidance proxy of the index, no recent reading
 *  innovation-v1    the deployed model: gain 1, decay 3 h
 *  innovation-fit   gain and decay fitted per city
 *  +hour-bias       plus shrunken offset by local hour (station-quirk term)
 *  +spread          plus lead-time spread multiplier fitted on CRPS
 * With `--fit <file>` the per-city gain and decay fitted on every settled row are written for
 * `src/weather-index-innovation-fit.json`, which `weather-index.mjs` reads.
 * Scores: CRPS (F) and Brier of the events {index > K} for the five integer K nearest the nbh mean, weighted so
 * each local date counts once. Intervals are date-block bootstrap on the paired difference.
 */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {temperatureDistributionCrps,temperatureCdf} from '../src/weather-ensemble.mjs';
import {fitInnovation,fitHourlyBias,fitSpread,innovationWeight,innovationMean} from '../src/weather-index-innovation.mjs';
import {CITIES} from './hourly-index-backtest-data.mjs';
const HOUR=3600000,MINUTE=60000,DAY=24*HOUR;
const ZONES={miami:'America/New_York',nyc:'America/New_York',chicago:'America/Chicago','la-coastal':'America/Los_Angeles'};
const crps=(meanF,scaleF,y)=>temperatureDistributionCrps({meanF,scaleF,nu:5},y);
const bucketOf=k=>k<=3?'1-3h':k<=6?'4-6h':'7-12h';
const BUCKETS=['1-3h','4-6h','7-12h'];
const localHour=(t,zone)=>+new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(t);
const localDate=(t,zone)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone}).format(t);
/** Frozen inputs -> decision rows with the guidance proxy, the anchor innovation and the truth. */
async function buildRows(cacheDir,city){
 const cal=JSON.parse(await readFile(join(cacheDir,city+'.calibrations.json'),'utf8')).calibrations;
 const index=JSON.parse(await readFile(join(cacheDir,city+'.index.json'),'utf8')).timeseries;
 const byMinute=new Map(index.map(p=>[p.t,p])),sorted=index.slice().sort((a,b)=>a.t-b.t);
 const configAt=T=>cal.filter(c=>c.effective_at_ms<=T&&c.published_at_ms<=T&&c.stations?.length).sort((a,b)=>b.effective_at_ms-a.effective_at_ms)[0];
 const files=(await readdir(join(cacheDir,'nbh'))).sort(),rows=[],zone=ZONES[city];
 let lo=0;
 for(const f of files){
  const cycle=JSON.parse(await readFile(join(cacheDir,'nbh',f),'utf8')),c=Date.parse(cycle.runtime),T=c+2*HOUR,config=configAt(T);
  if(!config)continue;
  const total=config.stations.reduce((s,x)=>s+x.weight,0),guidance=config.stations.map(s=>cycle.stations[s.station_id.slice(0,4)]);
  if(guidance.some(g=>!g))continue;
  const proxy=(t,which)=>{
   const k=(t-c)/HOUR;if(!Number.isInteger(k)&&which==='exact')return null;
   let mean=0,scale=0;
   for(let i=0;i<guidance.length;i++){
    const rs=guidance[i].rows,s=config.stations[i];let tmp,tsd;
    if(Number.isInteger(k)){const r=rs[k-1];if(!r||r.tmp===null)return null;tmp=r.tmp;tsd=r.tsd;}
    else{const a=rs[Math.floor(k)-1],b=rs[Math.ceil(k)-1];if(!a||!b||a.tmp===null||b.tmp===null)return null;const f=k-Math.floor(k);tmp=a.tmp+(b.tmp-a.tmp)*f;tsd=Math.max(a.tsd??2.5,b.tsd??2.5);}
    const w=s.weight/total;mean+=w*(tmp+1.8*(config.city_reference_c-s.offset_c));scale+=w*(Number.isFinite(tsd)?Math.max(1,tsd*Math.sqrt(3/5)):2.5);
   }
   return {mean,scale};
  };
  while(lo<sorted.length-1&&sorted[lo+1].t<=T)lo++;
  const anchor=sorted[lo];if(!anchor||anchor.t>T||T-anchor.t>20*MINUTE)continue;
  const ref=proxy(anchor.t,'any');if(!ref)continue;
  for(let k=1;k<=12;k++){
   const target=T+k*HOUR,truth=byMinute.get(target),base=proxy(target,'exact');
   if(!truth||!base)continue;
   rows.push({city,k,bucket:bucketOf(k),cycle:cycle.runtime,target,targetEnd:target,date:localDate(target,zone),localHour:localHour(target,zone),lagMs:target-anchor.t,
    baseMeanF:base.mean,baseScaleF:base.scale,innovationF:anchor.v-ref.mean,truthF:truth.v,anchorStatus:anchor.status,config:config.config_version});
  }
 }
 return rows;
}
function evaluateCity(rows,days,city,log){
 const out=[],settled=(r,dayStart)=>r.target<dayStart;
 for(const day of days){
  const dayStart=Date.parse(day+'T00:00:00Z'),train=rows.filter(r=>settled(r,dayStart)),test=rows.filter(r=>r.date===day);
  if(train.length<300||!test.length)continue;
  const fit=fitInnovation(train),bias=fitHourlyBias(train,fit);
  const spread={};
  for(const b of BUCKETS){
   const t=train.filter(r=>r.bucket===b).map(r=>({meanF:innovationMean(r,fit,bias),scaleF:r.baseScaleF,truthF:r.truthF}));
   spread[b]=t.length?fitSpread(t,crps).multiplier:1;
  }
  for(const r of test){
   const v1={gain:1,decayHours:3};
   const means={
    nbh:r.baseMeanF,
    'innovation-v1':r.baseMeanF+innovationWeight(r.lagMs,v1)*r.innovationF,
    'innovation-fit':innovationMean(r,fit),
    '+hour-bias':innovationMean(r,fit,bias),
    '+spread':innovationMean(r,fit,bias),
   };
   const scales={nbh:r.baseScaleF,'innovation-v1':r.baseScaleF,'innovation-fit':r.baseScaleF,'+hour-bias':r.baseScaleF,'+spread':r.baseScaleF*spread[r.bucket]};
   const centre=Math.round(r.baseMeanF),rec={city,date:day,bucket:r.bucket,k:r.k,models:{}};
   for(const m of Object.keys(means)){
    const dist={meanF:means[m],scaleF:scales[m],nu:5};let brier=0;
    for(let j=-2;j<=2;j++){const K=centre+j,p=1-temperatureCdf(dist,K+.005),o=r.truthF>K+.005?1:0;brier+=(p-o)**2;}
    rec.models[m]={crps:crps(means[m],scales[m],r.truthF),brier:brier/5,err:means[m]-r.truthF};
   }
   out.push(rec);
  }
  out.lastFit={day,fit,spread,bias};
 }
 log(`${city}: ${out.length} scored rows; last fit ${JSON.stringify(out.lastFit?.fit)} spread ${JSON.stringify(out.lastFit?.spread)}`);
 return {scored:out,lastFit:out.lastFit};
}
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
/** Equal weight per (city, date), then per city. */
function summarize(scored,models,metric,filter=()=>true){
 const cells=new Map();
 for(const r of scored){if(!filter(r))continue;const key=r.city+'|'+r.date,cell=cells.get(key)??{city:r.city,date:r.date,sum:Object.fromEntries(models.map(m=>[m,0])),n:0};for(const m of models)cell.sum[m]+=r.models[m][metric];cell.n++;cells.set(key,cell);}
 return [...cells.values()].map(c=>({city:c.city,date:c.date,v:Object.fromEntries(models.map(m=>[m,c.sum[m]/c.n]))}));
}
function bootstrap(cells,a,b,{resamples=4000,seed=20261015}={}){
 const dates=[...new Set(cells.map(c=>c.date))].sort(),diffs=dates.map(d=>mean(cells.filter(c=>c.date===d).map(c=>c.v[b]-c.v[a])));
 let s=seed;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/2**32;};
 const draws=Array.from({length:resamples},()=>mean(Array.from({length:diffs.length},()=>diffs[Math.floor(rnd()*diffs.length)]))).sort((x,y)=>x-y);
 return {dates:dates.length,meanDiff:mean(diffs),lo:draws[Math.floor(.025*resamples)],hi:draws[Math.floor(.975*resamples)],betterOnDates:diffs.filter(d=>d<0).length};
}
export async function run(cacheDir,firstDay,lastDay,{log=console.error}={}){
 const days=[];for(let t=Date.parse(firstDay+'T00:00:00Z');t<=Date.parse(lastDay+'T00:00:00Z');t+=DAY)days.push(new Date(t).toISOString().slice(0,10));
 const models=['nbh','innovation-v1','innovation-fit','+hour-bias','+spread'],scored=[],fits={},finalFit={};
 const through=Date.parse(lastDay+'T00:00:00Z')+DAY;
 for(const city of CITIES){
  const rows=await buildRows(cacheDir,city),res=evaluateCity(rows,days,city,log);
  scored.push(...res.scored);fits[city]=res.lastFit;
  const settled=rows.filter(r=>r.target<through),f=fitInnovation(settled);
  finalFit[city]={gain:Math.round(f.gain*1000)/1000,decayHours:f.decayHours,rows:settled.length,mseF2:Math.round(f.mse*1000)/1000};
 }
 const report={finalFit:{fitThrough:lastDay,cities:finalFit},protocol:{decisionLagHours:2,targets:'T+1..T+12 whole hours',cycles:'every third hour',refit:'daily, past-only',days:days.length,evalFrom:firstDay,evalTo:lastDay,rows:scored.length},fits,results:{}};
 for(const [label,filter] of [['all',()=>true],...BUCKETS.map(b=>[b,r=>r.bucket===b]),...CITIES.map(c=>['city:'+c,r=>r.city===c])]){
  const entry={};
  for(const metric of ['crps','brier']){
   const cells=summarize(scored,models,metric,filter);
   entry[metric]={mean:Object.fromEntries(models.map(m=>[m,mean(cells.map(c=>c.v[m]))])),
    pairedVs:Object.fromEntries(models.filter(m=>m!=='nbh').map(m=>[m,{vsNbh:bootstrap(cells,'nbh',m),vsV1:m==='innovation-v1'?null:bootstrap(cells,'innovation-v1',m)}]))};
  }
  const ent=summarize(scored,models,'err',filter);void ent;
  entry.meanAbsErrF=Object.fromEntries(models.map(m=>[m,mean(scored.filter(filter).map(r=>Math.abs(r.models[m].err)))]));
  entry.meanErrF=Object.fromEntries(models.map(m=>[m,mean(scored.filter(filter).map(r=>r.models[m].err))]));
  report.results[label]=entry;
 }
 return report;
}
if(import.meta.url===`file://${process.argv[1]}`){
 const args=process.argv.slice(2),flag=n=>{const i=args.indexOf(n);return i<0?null:args.splice(i,2)[1];};
 const fitOut=flag('--fit'),record=flag('--record'),[dir,first,last,out]=args;if(!dir||!first||!last)throw new Error('usage: <cacheDir> <firstEvalDay> <lastEvalDay> [out.json] [--fit <fit.json> --record <path>]');
 const report=await run(dir,first,last);
 if(out)await writeFile(out,JSON.stringify(report,null,1));
 if(fitOut){if(!record)throw new Error('--fit needs --record, the path of the record that holds this backtest');await writeFile(fitOut,JSON.stringify({...report.finalFit,record,model:'a*exp(-lag/decayHours) on the recent index innovation; NBH guidance only'},null,1)+'\n');}
 const f=x=>x.toFixed(3);
 for(const [label,e] of Object.entries(report.results)){
  console.log(`\n== ${label}`);
  for(const metric of ['crps','brier'])console.log(metric.padEnd(6),Object.entries(e[metric].mean).map(([m,v])=>`${m} ${f(v)}`).join(' | '));
  console.log('MAE   ',Object.entries(e.meanAbsErrF).map(([m,v])=>`${m} ${f(v)}`).join(' | '));
  for(const m of ['innovation-v1','innovation-fit','+hour-bias','+spread']){const p=e.crps.pairedVs[m].vsNbh,q=e.crps.pairedVs[m].vsV1;console.log(`  CRPS ${m}: vs nbh ${f(p.meanDiff)} [${f(p.lo)}, ${f(p.hi)}] ${p.betterOnDates}/${p.dates} dates`+(q?`; vs v1 ${f(q.meanDiff)} [${f(q.lo)}, ${f(q.hi)}] ${q.betterOnDates}/${q.dates}`:''));}
 }
}
