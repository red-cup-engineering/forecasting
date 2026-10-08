import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
const F=fileURLToPath(new URL('../../../../',import.meta.url)).replace(/\/$/,'');
const m=await import(pathToFileURL(F+'/src/lamp-station-guidance.mjs'));
const main=m.parseLampBulletin(await readFile(new URL('../fixtures/lamp-0230-standard.ascii',import.meta.url),'utf8'),['KNYC','KSEA']);
const ext=m.parseLampBulletin(await readFile(new URL('../fixtures/lamp-0230-extended.ascii',import.meta.url),'utf8'),['KNYC','KSEA'],{extended:true});
for(const s of ['KNYC','KSEA']){assert.equal(main[s].rows.length,25);assert.equal(ext[s].rows.length,13);assert.equal(main[s].rows[0].validTime,'2026-10-07T03:00:00.000Z');assert.equal(ext[s].rows.at(-1).validTime,'2026-10-08T16:00:00.000Z');assert.ok(main[s].rows.every(r=>r.temperatureF>0&&r.temperatureF<120));}
const sci=await import(pathToFileURL(F+'/src/station-weather-science.mjs'));
const root=await mkdtemp('/tmp/weather-science-proof-');
const packet={stations:[{station:'KNYC',timeZone:'America/New_York'}],local:{},lamp:{runtime:'2026-10-07T02:30:00.000Z',source:'noaa-proof',stations:{KNYC:main.KNYC}},observations:{}};
let a=await sci.updateStationScience(packet,{root,now:Date.parse('2026-10-07T02:40Z'),sourceEvidenceId:'known-before-target'});
assert.equal(a.scored,0);assert.equal(a.forecasted,25);
packet.observations={'KNYC/2026-10-06':{station:'KNYC',source:'observation-proof',readings:[{at:'2026-10-07T02:39:00.000Z',temperatureF:100},{at:'2026-10-07T03:00:00.000Z',temperatureF:main.KNYC.rows[0].temperatureF+2},{at:'2026-10-07T04:00:00.000Z',temperatureF:100}]}};
a=await sci.updateStationScience(packet,{root,now:Date.parse('2026-10-07T03:16Z'),sourceEvidenceId:'outcome-packet'});
assert.equal(a.scored,1);assert.equal(a.metrics[0].maeF,2);assert.equal(a.metrics[0].samples,1);assert.equal(a.parameters['KNYC/lamp-hourly-v2.7-v1/0-3h'].ready,false);
a=await sci.updateStationScience(packet,{root,now:Date.parse('2026-10-07T03:16Z'),sourceEvidenceId:'retry'});assert.equal(a.scored,0);assert.equal(a.metrics[0].samples,1);
const obs=await import(pathToFileURL(F+'/src/station-observations.mjs'));
const features=[{timestamp:'2026-10-07T00:00Z',temperature:{value:50,unitCode:'wmoUnit:degF'}},{timestamp:'2026-10-07T00:00Z',temperature:{value:10,unitCode:'wmoUnit:degC',qualityControl:'qc:V'}},{timestamp:'2026-10-07T04:00Z',temperature:{value:100,unitCode:'wmoUnit:degC'}}].map(properties=>({properties}));
const o=await obs.observedExtremes({station:'KNYC',date:'2026-10-06',timeZone:'America/New_York',now:Date.parse('2026-10-07T03:16Z')},{fetchImpl:async()=>({ok:true,json:async()=>({features})})});assert.equal(o.count,1);assert.equal(o.maxF,50);assert.equal(o.readings[0].qualityControl,'qc:V');
const e=await import(pathToFileURL(F+'/src/weather-evidence.mjs')); const next={...packet,lamp:{...packet.lamp,stations:{KNYC:{...main.KNYC,rows:[...main.KNYC.rows,...ext.KNYC.rows]}}}};
const c={strike_type:'greater',floor_strike:65,binding:{station:'KNYC',timeZone:'America/New_York',targetDate:'2026-10-07',kind:'high',proxy:true}};
const estimates=e.weatherEstimates(c,next,Date.parse('2026-10-07T02:40Z'));assert.ok(estimates.some(r=>r.id==='lamp-hourly-extreme-high-v2'&&r.p>0&&r.p<1));
console.log(JSON.stringify({lamp:{stations:Object.keys(main),hours:38,nycStart:main.KNYC.rows[0],nycEnd:ext.KNYC.rows.at(-1)},physicalScoring:{noHindsight:true,retryIdempotent:true,metrics:a.metrics},dailyExtreme:estimates},null,2));

// Seven completed dates are needed before a separately versioned local correction is issued.
const trainingRoot=await mkdtemp('/tmp/weather-learning-proof-');
for(let i=0;i<8;i++){
 const day=Date.UTC(2026,8,20+i),run=new Date(day+30*60000).toISOString(),valid=new Date(day+2*3600000).toISOString();
 const ev={stations:[{station:'KSEA',timeZone:'America/Los_Angeles'}],local:{},lamp:{runtime:run,source:'fixture',stations:{KSEA:{rows:[{validTime:valid,temperatureF:50,leadHours:1.5}]}}},observations:{}};
 const issued=await sci.updateStationScience(ev,{root:trainingRoot,now:day+40*60000,sourceEvidenceId:'forecast-'+i});
 assert.equal(issued.forecasts.length,i<7?1:2);
 if(i===7){assert.equal(issued.forecasts[1].postprocessing.dates,7);assert(issued.forecasts[1].meanF>50);assert(issued.forecasts[1].scaleF>=2.5);}
 ev.observations={obs:{station:'KSEA',source:'fixture',readings:[{at:valid,temperatureF:55}]}};
 await sci.updateStationScience(ev,{root:trainingRoot,now:day+2*3600000+16*60000,sourceEvidenceId:'observation-'+i});
}
const rain=await import(pathToFileURL(F+'/src/rain-market-model.mjs'));
const csv=await readFile(F+'/data/records/2026-10-04-weather-coverage/data/rain-scored.csv','utf8'),lines=csv.trim().split('\n'),headers=lines.shift().split(',');let compared=0,maxError=0;
for(const line of lines){const r=Object.fromEntries(line.split(',').map((v,i)=>[headers[i],v]));if(r.date<'2026-09-02')continue;const p=rain.rainProbability(Number(r.pany),r.dec,{fold:'early'});maxError=Math.max(maxError,Math.abs(p-Number(r.pm_pany)));const logit=q=>{q=Math.min(.999,Math.max(.001,q));return Math.log(q/(1-q));};const expected=1/(1+Math.exp(-.5*(logit(Number(r.pm_pany))+logit(Number(r.mid)))));assert(Math.abs(rain.rainMarketPoolProbability(Number(r.pm_pany),Number(r.mid))-expected)<1e-12);compared++;}
assert(maxError<1e-6);console.log(JSON.stringify({postprocessing:'starts only after seven completed dates; no hindsight; never narrows scale',rainReplay:{compared,maxCoefficientRoundingError:maxError}}));

const facts=await import(pathToFileURL(F+'/../../src/market-facts.mjs'));
const settled={ticker:'fixture',status:'finalized',market_type:'binary',result:'yes',settlement_ts:'2026-10-07T00:00:00Z',notional_value_dollars:'1.00',settlement_value_dollars:'1.00'};
assert.equal(facts.binarySettlement(settled).outcome,1);
for(const overrides of [{status:'determined'},{is_provisional:true},{market_type:'scalar'},{settlement_ts:null,expiration_time:'2026-10-07T00:00:00Z'},{settlement_value_dollars:'.50'}])assert.equal(facts.binarySettlement({...settled,...overrides}),null);
console.log('Definitive venue settlement required; nonbinary payouts, provisional labels and substituted clocks refused.');

next.observations={'KNYC/2026-10-06':{station:'KNYC',count:20,maxF:65,minF:50,floor:64,ceiling:51,source:'NWS-proof',latest:'2026-10-07T04:40:00.000Z'}};
const finalHour={...c,binding:{...c.binding,targetDate:'2026-10-06'}};
const finalModels=e.weatherEstimates(finalHour,next,Date.parse('2026-10-07T04:45Z'));
assert(finalModels.some(m=>m.id==='lamp-hourly-extreme-high-v2'));
assert(finalModels.some(m=>m.id.includes('/observation-proxy-mixture-v1')));
const baseline=[{id:'fixture',p:0,details:{mean:62,scale:2.5,nu:5}}];
const brackets=[{strike_type:'less',cap_strike:60},{strike_type:'between',floor_strike:60,cap_strike:64},{strike_type:'greater',floor_strike:64}];
let sum=0;
for(const bracket of brackets){const market={...finalHour,...bracket};const baseP=(await import(pathToFileURL(F+'/src/temperature-distribution.mjs'))).bracketProbability({strikeType:bracket.strike_type,floorStrike:bracket.floor_strike,capStrike:bracket.cap_strike},{mean:62,scale:2.5,nu:5});const m=e.softObservationEstimates(market,next,[{...baseline[0],p:baseP}])[0];assert(Number.isFinite(m.p));assert(m.p>0&&m.p<1);sum+=m.p;}
assert(Math.abs(sum-1)<1e-12);console.log('Final partial-hour LAMP forecast retained; proxy-mixture probabilities conserve mass and retain source-disagreement support.');

const freshOnly={...next,lamp:{...next.lamp,runtime:'2026-10-07T04:30:00.000Z',stations:{KNYC:{rows:next.lamp.stations.KNYC.rows.filter(r=>Date.parse(r.validTime)>=Date.parse('2026-10-07T05:00Z'))}}}};
freshOnly.observations['KNYC/2026-10-06'].readings=[{at:'2026-10-07T04:40:00.000Z',temperatureF:53}];
const bridged=e.lampDailyEstimates(finalHour,freshOnly,Date.parse('2026-10-07T04:45Z'));
assert.equal(bridged.length,1);assert.equal(bridged[0].details.boundaryMethod,'latest NWS reading joined to future LAMP');assert(Number.isFinite(bridged[0].p));
console.log('A fresh bulletin beginning next hour still supports the final partial-hour forecast through a timestamped observation anchor.');

const priorGrade=(await import(new URL('../fixtures/grade-models-before-stream.mjs',import.meta.url))).gradeModels;
const learning=await import(pathToFileURL(F+'/src/weather-learning.mjs'));
const historicRows=lines.map(line=>Object.fromEntries(line.split(',').map((v,i)=>[headers[i],v]))).filter(r=>r.date>='2026-09-02').map(r=>({family:'rain',source:'TWC',station:r.stn,ruleKey:'chronological-study',stage:r.dec,eventTicker:r.ticker,targetDate:r.date,mid:Number(r.mid),outcome:Number(r.y),models:[{id:'weather',p:Number(r.pm_pany)},{id:'pool',p:rain.rainMarketPoolProbability(Number(r.pm_pany),Number(r.mid))}]}));
assert.deepEqual(learning.gradeModels(historicRows),priorGrade(historicRows));
const accumulator=learning.createModelGradeAccumulator();for(const row of historicRows)accumulator.add(row);assert.deepEqual(accumulator.report(),priorGrade(historicRows));
console.log('Streaming grades exactly preserve the old event/date and probability-bin results on 2,298 chronological rain observations.');

// Exercise the actual scorer with out-of-order, repeated forecasts and correlated ladder rungs.
const engine=await import(pathToFileURL(F+'/src/weather-engine.mjs'));
const historyRoot=await mkdtemp('/tmp/weather-history-proof-'),history=[],expected=[];
for(let day=1;day<=31;day++)for(let rung=0;rung<2;rung++){
 const date=`2026-08-${String(day).padStart(2,'0')}`;
 const base={id:`${day}-${rung}`,ticker:`T${day}-${rung}`,family:'rain',source:'TWC',station:'KSEA',ruleKey:'verified',stage:'12-24h',eventTicker:`E${day}`,targetDate:date,mid:.5,outcome:1};
 const early={...base,at:`${date}T01:00:00Z`,models:[{id:'prospective',p:.8}]};
 history.push({...base,id:base.id+'-late',at:`${date}T02:00:00Z`,models:[{id:'prospective',p:.01}]},early,{...early,id:base.id+'-tie'});expected.push(early);
}
await writeFile(historyRoot+'/resolved.jsonl',history.map(r=>JSON.stringify(r)).join('\n')+'\n');
const scored=await engine.scoreWeather({root:historyRoot,client:{getMarkets(){throw new Error('no pending contract should be read');}}});
assert.deepEqual(scored.grades,priorGrade(expected));
const grade=Object.values(scored.grades)[0];assert.equal(grade.dates,31);assert.equal(grade.events,31);assert.equal(grade.bins[8].n,31);assert.equal(grade.admitted,true);
console.log('Actual scoreWeather retains earliest model forecasts across unsorted history and retries; 62 ladder contracts contribute only 31 effective dates.');
