import {adaptiveTemperaturePool} from './weather-family-learning.mjs';
import {ecmwfStationDistributions} from './weather-ecmwf-ensemble.mjs';
import {relationalTemperaturePanel,RELATIONAL_REGIONS} from './weather-relational-temperature.mjs';
import {INDEX_CITIES,indexDistributions,canonicalIndexPoints,stationTemperatureDistribution} from './weather-index.mjs';
/** Prequential station verification and regularized local postprocessing, independent of markets. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {weatherReadPage} from './weather-read-page.mjs';
import {readWeatherSourceRecord} from './weather-source-record.mjs';
import {makeTemperaturePool,postprocessTemperature,temperatureDiagnostics,temperatureDistributionCrps} from './weather-ensemble.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=r=>`${r.station}/${r.model}/${r.horizon}`;
const cohort=h=>h<=3?'0-3h':h<=6?'3-6h':h<=12?'6-12h':h<=24?'12-24h':'24-48h';
/** Backwards-compatible single-Student-t scoring, using the same quadrature as ensembles. */
export function temperatureCrps(meanF,scaleF,observedF){return temperatureDistributionCrps({meanF,scaleF,nu:5},observedF);}
const read=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function atomic(path,value){const tmp=path+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600});await rename(tmp,path);}
function fit(history){
 const groups={};for(const day of Object.values(history)){if(day.verification==='routine-report-bin')continue;(groups[day.key]??=[]).push(day);}
 const out={};
 for(const [k,days] of Object.entries(groups)){
  const n=days.length,bias=days.reduce((s,d)=>s+d.errorSum/d.n,0)/(n+10);
  const standardized=days.reduce((s,d)=>s+d.z2Sum/d.n,0)/n;
  out[k]={dates:n,samples:days.reduce((s,d)=>s+d.n,0),biasF:Math.max(-5,Math.min(5,bias)),scaleMultiplier:Math.max(1,Math.sqrt(standardized*3/5)),ready:n>=7,method:'date-weighted residual bias shrunk toward zero by 10 prior days; spread only widens',truth:days[0].truth??'NWS station observations'};
 }
 return out;
}
export function stationScienceReport(state,{station}={}){
 const groups={};for(const d of Object.values(state.history??{})){if(station&&d.station!==station)continue;const r=groups[d.key]??={station:d.station,model:d.model,horizon:d.horizon,truth:d.truth??'NWS station observations',verification:d.verification,discrete:d.discrete,n:0,dates:0,errorSum:0,error2Sum:0,absSum:0,crpsSum:0,covered90:0,diagnosticSamples:0,pitSum:0,pit2Sum:0,pitBins:Array(10).fill(0)};r.n+=d.n;r.dates++;for(const f of ['errorSum','error2Sum','absSum','crpsSum','covered90'])r[f]+=d[f];r.diagnosticSamples+=d.diagnosticSamples??0;r.pitSum+=d.pitSum??0;r.pit2Sum+=d.pit2Sum??0;for(let i=0;i<10;i++)r.pitBins[i]+=d.pitBins?.[i]??0;}
 const metrics=Object.values(groups).map(r=>({station:r.station,model:r.model,horizon:r.horizon,truth:r.truth,verification:r.verification,samples:r.n,dates:r.dates,biasF:r.errorSum/r.n,maeF:r.absSum/r.n,rmseF:Math.sqrt(r.error2Sum/r.n),crpsF:r.crpsSum/r.n,coverage90:r.covered90/r.n,pit:r.diagnosticSamples?{samples:r.diagnosticSamples,mean:r.pitSum/r.diagnosticSamples,variance:r.pit2Sum/r.diagnosticSamples-(r.pitSum/r.diagnosticSamples)**2,bins:r.pitBins,idealMean:.5,idealVariance:1/12,note:r.verification==='routine-report-bin'||r.discrete?'seeded randomized PIT for empirical atoms; continuous CDF for continuous components; correlated hours and ensemble members are not independent calibration trials':'continuous-CDF PIT; correlated hours are not independent calibration trials'}:null}));
 const pairs={};for(const d of Object.values(state.comparisons??{})){if(station&&d.station!==station)continue;(pairs[d.key]??=[]).push(d);}
 const comparisons=Object.values(pairs).map(days=>{const means=days.map(d=>d.gainSum/d.n),n=means.length,mean=means.reduce((s,x)=>s+x,0)/n,se=n>1?Math.sqrt(means.reduce((s,x)=>s+(x-mean)**2,0)/(n*(n-1))):null;const {key,date,n:count,gainSum,...metadata}=days[0];return {...metadata,dates:n,samples:days.reduce((s,d)=>s+d.n,0),meanCrpsGainF:mean,lower95:n>=30?mean-1.96*se:null,upper95:n>=30?mean+1.96*se:null,supportedPhysicalGain:n>=30&&mean-1.96*se>0,method:'component and pool frozen together and scored on identical outcomes; equal day means; approximate date-cluster interval after 30 dates; no market-edge inference'};});
 return {at:state.at??null,truth:'NWS station observations, canonical Kalshi city-index observations and IEM routine-report bins; separate carriers and venue binary settlement',scoring:'first available forecast per location/valid hour/model/lead cohort; NWS nearest hour within 15 minutes; city index latest canonical minute at/before target within 60 minutes; routine bins use the last uncontradicted report within 20 minutes before the boundary; exact empirical-atom CRPS and 41-point Student-t quadrature; weighted mixture CRPS',metrics,comparisons,pending:Object.values(state.pending??{}).filter(r=>!station||r.station===station).length,parameters:Object.fromEntries(Object.entries(state.parameters??{}).filter(([k])=>!station||k.startsWith(station+'/'))),missingOutcomes:state.missingOutcomes??0};
}
export function stationPointForecasts(evidence,{now=Date.now(),parameters={},learningState={}}={}){
 const out=[];
 for(const request of evidence.stations??[]){
  const station=request.station,ecmwf=ecmwfStationDistributions(evidence.ecmwfEnsemble,request.station,{now}),inputs=[...ecmwf];
  const l=evidence.local?.[station];
  if(l&&now-Date.parse(l.updated)>=0&&now-Date.parse(l.updated)<=8*3600000)for(const p of l.periods??[])if(['C','F'].includes(p.temperatureUnit)&&Number.isFinite(p.temperature))inputs.push({model:'nws-grid-hourly-v1',validTime:p.startTime,meanF:p.temperatureUnit==='C'?p.temperature*9/5+32:p.temperature,scaleF:2.5,source:l.hourlyUrl,issuedAt:l.updated,uncertainty:'experimental 2.5F Student-t scale, not an NWS probability product'});
  const nbm=evidence.guidance;
  if(nbm&&now-Date.parse(nbm.runtime)>=0&&now-Date.parse(nbm.runtime)<=8*3600000)for(const r of nbm.stations[station]?.rows??[])if(Number.isFinite(r.tmp))inputs.push({model:'nbm-hourly-v5-v1',validTime:r.ftime,meanF:r.tmp,scaleF:Number.isFinite(r.tsd)?Math.max(1,r.tsd*Math.sqrt(3/5)):2.5,source:nbm.source,issuedAt:nbm.runtime,uncertainty:Number.isFinite(r.tsd)?'NBM TSD converted to Student-t scale; 1F floor':'experimental 2.5F Student-t scale; NBM TSD absent'});
  const nbh=evidence.hourlyGuidance;
  if(nbh&&now-Date.parse(nbh.runtime)>=0&&now-Date.parse(nbh.runtime)<=3*3600000)for(const r of nbh.stations[station]?.rows??[])if(Number.isFinite(r.tmp))inputs.push({model:'nbm-nbh-hourly-v5-v1',validTime:r.ftime,meanF:r.tmp,scaleF:Number.isFinite(r.tsd)?Math.max(1,r.tsd*Math.sqrt(3/5)):2.5,source:nbh.source,issuedAt:nbh.runtime,uncertainty:Number.isFinite(r.tsd)?'NBH TSD converted to Student-t scale; 1F floor':'experimental 2.5F Student-t scale; NBH TSD absent'});
  const lamp=evidence.lamp;
  if(lamp&&now-Date.parse(lamp.runtime)>=0&&now-Date.parse(lamp.runtime)<=3*3600000)for(const r of lamp.stations[station]?.rows??[])if(Number.isFinite(r.temperatureF))inputs.push({model:'lamp-hourly-v2.7-v1',validTime:r.validTime,meanF:r.temperatureF,scaleF:2.5,source:r.leadHours>25?lamp.extendedSource:lamp.source,issuedAt:lamp.runtime,uncertainty:'experimental 2.5F Student-t scale; LAMP temperature is deterministic'});
  for(let valid=Math.ceil((now+5*60000)/3600000)*3600000;valid<=now+48*3600000;valid+=3600000){
   const members=['lamp','nbh','nbm','nws'].flatMap(provider=>{const r=stationTemperatureDistribution(evidence,station,provider,valid,now);return r?[{...r,model:'station-'+provider+'-aligned-v1',family:provider==='nbh'?'nbm':provider,priority:provider==='nbh'?1:0}]:[];});
   const ensembleMember=ecmwf.find(r=>Date.parse(r.validTime)===valid);if(ensembleMember)members.push(ensembleMember);
   const pool=makeTemperaturePool(members);if(pool)inputs.push({...pool,model:ensembleMember?'station-family-pool-with-aifs-v2':'station-family-pool-v1',...(ensembleMember?{tradeEligible:false}:{}),validTime:new Date(valid).toISOString(),source:'component forecast sources in mixture',issuedAt:pool.mixture.components.reduce((a,c)=>a<c.issuedAt?c.issuedAt:a,'')});
  }
  for(const r of inputs){
   const leadHours=(Date.parse(r.validTime)-now)/3600000;if(!Number.isFinite(leadHours)||leadHours<1/12||leadHours>48||Date.parse(r.issuedAt)>now)continue;
   const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:request.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(r.validTime)).map(p=>[p.type,p.value]));
   const base={...r,station,leadHours,horizon:cohort(leadHours),availableAt:new Date(now).toISOString(),date:`${dateParts.year}-${dateParts.month}-${dateParts.day}`,nu:5};out.push(base);
   const parameter=parameters[key(base)];if(parameter?.ready)out.push({...postprocessTemperature(base,parameter),model:base.model+'/station-postprocess-v1',postprocessing:{...parameter,trainedThrough:new Date(now).toISOString(),baseModel:base.model}});
  }
 }
 for(const city of Object.keys(evidence.indices??{})){
  const zone=INDEX_CITIES[city]?.timeZone;if(!zone)continue;
  for(let valid=Math.ceil((now+5*60000)/3600000)*3600000;valid<=now+24*3600000;valid+=3600000)for(const r of indexDistributions(city,evidence,valid,now)){
   const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(valid)).map(p=>[p.type,p.value]));
   const base={...r,station:'index:'+city,validTime:new Date(valid).toISOString(),availableAt:new Date(now).toISOString(),date:`${parts.year}-${parts.month}-${parts.day}`,leadHours:(valid-now)/3600000,horizon:cohort((valid-now)/3600000),verification:'kalshi-index',truth:'canonical Kalshi city weather index'};out.push(base);
   const p=parameters[key(base)];if(p?.ready)out.push({...postprocessTemperature(base,p),model:base.model+'/station-postprocess-v1',postprocessing:{...p,trainedThrough:new Date(now).toISOString(),baseModel:base.model}});
  }
 }
 for(const packet of evidence.relational?.regions??[]){
  const accepted=(packet.forecasts??[]).filter(r=>r.verification==='routine-report-bin'&&Date.parse(r.availableAt)<=now&&Date.parse(r.earliestTargetObservationAt)>now&&Date.parse(r.calibrationLabelBefore)<=Date.parse(r.fitAvailableAt)&&Date.parse(r.fitAvailableAt)<=Date.parse(r.availableAt));
  for(const r of accepted){
   if(['relational-live/recursive-generator/v1','relational-live/irregular-clock-ridge-100/v1'].includes(r.model)){
    const comparators=out.filter(c=>c.station===r.station&&Date.parse(c.validTime)===Date.parse(r.validTime)&&['lamp-hourly-v2.7-v1','nbm-nbh-hourly-v5-v1','nws-grid-hourly-v1'].includes(c.model)).map(c=>({...c,model:c.model+'/routine-bin-comparator-v1',validTime:r.validTime,horizon:'routine-next-bin',verification:r.verification,truth:r.truth,date:r.date,earliestTargetObservationAt:r.earliestTargetObservationAt,tradeEligible:false,approximation:'guidance valid at UTC boundary evaluated against routine report up to 20 minutes earlier'}));
    out.push(...comparators,{...r,comparators:[...(r.comparators??[]),...comparators]});
   }else out.push(r);
  }
 }
 const adaptive=out.filter(r=>/family-pool/.test(r.model)&&!r.model.includes('/station-postprocess-v1')&&!r.model.includes('/paired-family-fixed-share-v2')).map(r=>adaptiveTemperaturePool(r,learningState,{now})).filter(Boolean);
 out.push(...adaptive);
 return out;
}
/** Caller holds the station-science lock. Scores known forecasts BEFORE fitting or recording future forecasts. */
export async function updateStationScience(evidence,{root,now=Date.now(),sourceEvidenceId}={}){
 await mkdir(root,{recursive:true,mode:0o700});const file=join(root,'state.json');
 const state=await read(file,{pending:{},history:{},missingOutcomes:0});
 const traces=new Map();
 for(const e of Object.values(evidence.observations??{}))for(const r of e.readings??[]){if(!traces.has(e.station))traces.set(e.station,new Map());traces.get(e.station).set(r.at,{...r,source:e.source});}
 for(const [city,packet] of Object.entries(evidence.indices??{})){
  const station='index:'+city;if(!traces.has(station))traces.set(station,new Map());
  for(const point of canonicalIndexPoints(packet,city,now)){const at=new Date(point.t).toISOString();traces.get(station).set(at,{at,temperatureF:point.v,status:point.status,contributors:point.contributors,source:packet.indexSource,receiptBasis:point.receipt_basis??'audited local receipt'});}
 }
 const readings=new Map([...traces].map(([s,rows])=>[s,[...rows.values()].sort((a,b)=>a.at.localeCompare(b.at))]));
 const routines=new Map();
 for(const packet of evidence.relational?.regions??[])for(const p of relationalTemperaturePanel(packet.reading,{stations:RELATIONAL_REGIONS[packet.region]})){
  if(p.at>now)continue;
  for(const [station,r] of Object.entries(p.stations)){if(packet.reading.conflicts.some(c=>c.witnesses.some(w=>w.station===station&&Math.ceil(Date.parse(w.observedAt)/3600000)*3600000===p.at&&p.at-Date.parse(w.observedAt)<=20*60000)))continue;
   routines.set('K'+station+'/'+p.at,{at:r.observedAt,temperatureF:r.rawTemperatureF,source:packet.source.url,sourceId:packet.source.sha256,availableAt:packet.source.availableAt,binAt:new Date(p.at).toISOString(),witnesses:r.witnesses});}
 }
 let scored=0,forecasted=0;const outcomes=[];state.comparisons??={};
 for(const [id,r] of Object.entries(state.pending)){
  const valid=Date.parse(r.validTime);if(valid+(r.verification==='routine-report-bin'?0:r.verification==='kalshi-index'?5*60000:15*60000)>now)continue;
  const obs=r.verification==='routine-report-bin'?routines.get(r.station+'/'+valid):r.verification==='kalshi-index'?(readings.get(r.station)??[]).filter(o=>Date.parse(o.at)<=valid&&Date.parse(o.at)>=valid-60*60000&&Date.parse(o.at)>Date.parse(r.availableAt)).sort((a,b)=>b.at.localeCompare(a.at))[0]:(readings.get(r.station)??[]).filter(o=>Math.abs(Date.parse(o.at)-valid)<=15*60000&&Date.parse(o.at)<=now&&Date.parse(o.at)>Date.parse(r.availableAt)).sort((a,b)=>Math.abs(Date.parse(a.at)-valid)-Math.abs(Date.parse(b.at)-valid)||b.at.localeCompare(a.at))[0];
  if(!obs||r.verification==='routine-report-bin'&&(Date.parse(obs.at)<=Date.parse(r.availableAt)||Date.parse(obs.availableAt)<Date.parse(obs.at))){if(now-valid>72*3600000){delete state.pending[id];state.missingOutcomes++;}continue;}
  const error=obs.temperatureF-r.meanF,k=key(r),dk=k+'/'+r.date;
  const d=state.history[dk]??={key:k,station:r.station,model:r.model,horizon:r.horizon,date:r.date,truth:r.truth??'NWS station observations',verification:r.verification,discrete:Boolean(r.empirical||r.mixture?.components?.some(c=>c.empirical)),n:0,errorSum:0,error2Sum:0,z2Sum:0,absSum:0,crpsSum:0,covered90:0};
  const diagnostics=temperatureDiagnostics(r,obs.temperatureF,{tieUniform:parseInt(hash({id,pitSeed:'pre-outcome-pit-v1'}).slice(0,8),16)/4294967296}),crps=diagnostics.crpsF;d.n++;d.errorSum+=error;d.error2Sum+=error*error;d.z2Sum+=(error/r.scaleF)**2;d.absSum+=Math.abs(error);d.crpsSum+=crps;d.covered90+=diagnostics.covered90?1:0;
  d.diagnosticSamples=(d.diagnosticSamples??0)+1;d.pitSum=(d.pitSum??0)+diagnostics.pit;d.pit2Sum=(d.pit2Sum??0)+diagnostics.pit**2;d.pitBins??=Array(10).fill(0);d.pitBins[Math.min(9,Math.floor(diagnostics.pit*10))]++;
  const comparisonComposition=r.mixture?.kind==='empirical-generated-learner-pool-v1'?'frozen-six-learner-past-only-selector-v1':r.composition;
  for(const component of new Map([...(r.mixture?.components??[]),...(r.comparators??[])].map(c=>[c.model,c])).values()){
   const pairKey=hash({station:r.station,pool:r.model,component:component.model,horizon:r.horizon,composition:comparisonComposition,configurationVersion:r.details?.configVersion??null,truth:r.truth??'NWS station observations'}),dayKey=pairKey+'/'+r.date;
   const paired=state.comparisons[dayKey]??={key:pairKey,station:r.station,pool:r.model,component:component.model,family:component.family,horizon:r.horizon,composition:comparisonComposition,configurationVersion:r.details?.configVersion??null,truth:r.truth??'NWS station observations',date:r.date,n:0,gainSum:0};
   paired.scoreAvailableAt=new Date(now).toISOString();paired.sourceEvidenceId=sourceEvidenceId;paired.n++;paired.gainSum+=temperatureDistributionCrps({...component,weight:1},obs.temperatureF)-crps;
  }
  outcomes.push({id,forecast:r,observation:obs,errorF:error,crpsF:crps,sourceEvidenceId});delete state.pending[id];scored++;
 }
 const cutoff=new Date(now-90*86400000).toISOString().slice(0,10);for(const [k,d] of Object.entries(state.history))if(d.date<cutoff)delete state.history[k];
 for(const [k,d] of Object.entries(state.comparisons))if(d.date<cutoff)delete state.comparisons[k];
 state.parameters=fit(state.history);
 state.at=new Date(now).toISOString();
 const forecasts=stationPointForecasts(evidence,{now,parameters:state.parameters,learningState:state});
 for(const r of forecasts){const id=hash({station:r.station,model:r.model,horizon:r.horizon,validTime:r.validTime});if(state.pending[id])continue;state.pending[id]={...r,sourceEvidenceId};forecasted++;}
 state.at=new Date(now).toISOString();await atomic(file,state);
 return {...stationScienceReport(state),scored,forecasted,forecasts,outcomes};
}
export async function readStationScience({root,station}={}){return stationScienceReport(await read(join(root,'state.json'),{}),{station});}

/** Native-sized view of the same scientific record; full library read remains above. */
export async function readStationSciencePage({root,station,field='metrics',offset=0,limit=100,sourceRevision}={}){
 if(station!==undefined&&(typeof station!=='string'||!/^([A-Z0-9]{4}|index:(miami|nyc|chicago|la-coastal))$/.test(station)))throw new TypeError('one ICAO station or existing city-index key is required');
 const {record:state,source:recordSource}=await readWeatherSourceRecord({root,file:'state.json',label:'station-science/state.json',sourceRevision});
 const report=stationScienceReport(state,{station}),source={...recordSource,...(station===undefined?{}:{station})};
 return weatherReadPage(report,{source,field,allowedFields:['metrics','comparisons','parameters'],offset,limit,sourceRevision,
  metadata:{truth:report.truth,scoring:report.scoring,pending:report.pending,missingOutcomes:report.missingOutcomes,orderEffect:false}});
}

