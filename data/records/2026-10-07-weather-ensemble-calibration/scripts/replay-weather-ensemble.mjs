/** Read-only reconstruction from immutable issuance snapshots and recorded physical outcomes. */
import {readFile,readdir,realpath,mkdir,writeFile} from 'node:fs/promises';import {gunzipSync} from 'node:zlib';import {createHash} from 'node:crypto';import {execFileSync} from 'node:child_process';import {pathToFileURL} from 'node:url';
const home=process.env.HOME,root=home+'/.local/state/561-group/settlements/kalshi-services-section/weather',runtime=await realpath(home+'/.local/share/561-group/weather-research/current'),scienceFile=execFileSync('find',[runtime+'/lib','-path','*/forecasting-service/src/station-weather-science.mjs'],{encoding:'utf8'}).trim(),F=scienceFile.slice(0,-'/src/station-weather-science.mjs'.length);
const {stationPointForecasts}=await import(pathToFileURL(scienceFile)),{temperatureDiagnostics}=await import(pathToFileURL(F+'/src/weather-ensemble.mjs'));
const cutoff=Date.parse('2026-10-07T12:27:34.857Z'),frames=new Map(),observations=new Map();let packets=0,verifiedHashes=0;
const digest=b=>createHash('sha256').update(b).digest('hex');
async function packet(id){const b=gunzipSync(await readFile(root+'/evidence/'+id+'.json.gz'));if(digest(b)!==id)throw new Error('archive digest mismatch: '+id);verifiedHashes++;return JSON.parse(b);}
for(const name of await readdir(root+'/evidence')){
 if(!/^[a-f0-9]{64}\.json\.gz$/.test(name))continue;const e=await packet(name.slice(0,64));packets++;
 const forecasts=e.science?.forecasts??[],available=forecasts.map(r=>Date.parse(r.availableAt)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
 if(e.sourceEvidenceId&&available<cutoff&&(e.stations??[]).length)frames.set(e.sourceEvidenceId+'/'+available,{id:e.sourceEvidenceId,available});
 for(const o of e.science?.outcomes??[]){const r=o.forecast;if(r.station?.startsWith('index:')||!Number.isFinite(o.observation?.temperatureF)||!Number.isFinite(Date.parse(r.validTime)))continue;const key=r.station+'/'+r.validTime,prior=observations.get(key),distance=Math.abs(Date.parse(o.observation.at)-Date.parse(r.validTime));if(distance>15*60000)continue;if(!prior||distance<prior.distance||distance===prior.distance&&o.observation.at>prior.observation.at)observations.set(key,{observation:o.observation,distance,evidenceId:name.slice(0,64)});}
}
const used=new Set(),samples=[],groups=new Map();
function add(model,r,d){const k=model+'/'+r.horizon+'/'+r.composition,group=groups.get(k)??{model,horizon:r.horizon,composition:r.composition,n:0,dates:new Set(),error2:0,abs:0,crps:0,covered:0,pit:0,pit2:0};group.n++;group.dates.add(r.date);group.error2+=(d.observedF-d.meanF)**2;group.abs+=Math.abs(d.observedF-d.meanF);group.crps+=d.crpsF;group.covered+=d.covered90?1:0;group.pit+=d.pit;group.pit2+=d.pit**2;groups.set(k,group);}
for(const frame of [...frames.values()].sort((a,b)=>a.available-b.available||a.id.localeCompare(b.id))){
 const e=await packet(frame.id);
 for(const r of stationPointForecasts(e,{now:frame.available,parameters:{}}).filter(r=>r.model==='station-family-pool-v1')){
  const key=r.station+'/'+r.validTime+'/'+r.horizon,obs=observations.get(r.station+'/'+r.validTime);if(used.has(key)||!obs||Date.parse(obs.observation.at)<=frame.available)continue;used.add(key);
  const y=obs.observation.temperatureF,pool=temperatureDiagnostics(r,y);add(r.model,r,{...pool,meanF:r.meanF,observedF:y});const componentResults=[];
  for(const c of r.mixture.components){const d=temperatureDiagnostics(c,y);add(c.model,r,{...d,meanF:c.meanF,observedF:y});componentResults.push({model:c.model,family:c.family,meanF:c.meanF,scaleF:c.scaleF,crpsF:d.crpsF,gainF:d.crpsF-pool.crpsF});}
  samples.push({station:r.station,date:r.date,validTime:r.validTime,horizon:r.horizon,availableAt:r.availableAt,sourceEvidenceId:frame.id,outcomeEvidenceId:obs.evidenceId,observation:obs.observation,composition:r.composition,pool:{meanF:r.meanF,scaleF:r.scaleF,...pool},components:componentResults});
 }
}
const metrics=[...groups.values()].map(r=>({model:r.model,horizon:r.horizon,composition:r.composition,samples:r.n,dates:r.dates.size,maeF:r.abs/r.n,rmseF:Math.sqrt(r.error2/r.n),crpsF:r.crps/r.n,coverage90:r.covered/r.n,pitMean:r.pit/r.n,pitVariance:r.pit2/r.n-(r.pit/r.n)**2}));
const result={at:new Date().toISOString(),method:'Historical reconstruction of the new untrained equal-family ensemble from immutable source snapshots, using actual snapshot availability times; earliest usable snapshot per station/valid hour/cohort, identical recorded observations for pool and frozen components; no current feeds, no fitting, no production state mutations',cutoff:new Date(cutoff).toISOString(),packets,verifiedHashes,sourceSnapshots:frames.size,matchedSamples:samples.length,dates:[...new Set(samples.map(r=>r.date))].sort(),metrics,limitations:'One short operational sample; no statistical accuracy or market-edge claim. Source products have shared inputs. Historical comparison is distinct from prospective new-model performance.',productionMutations:0,ordersPlaced:0};
if(!samples.length)throw new Error('no immutable matched historical samples');
const out=home+'/.local/state/561-group/weather-ensemble-demonstration';await mkdir(out,{recursive:true});await writeFile(out+'/historical-replay-receipt.json',JSON.stringify(result,null,2)+'\n');await writeFile(out+'/historical-replay-samples.jsonl',samples.map(r=>JSON.stringify(r)).join('\n')+'\n');console.log(JSON.stringify({...result,metrics:undefined}));
