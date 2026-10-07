/** Prequential station verification and regularized local postprocessing, independent of markets. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {studentTCdf} from './temperature-distribution.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=r=>`${r.station}/${r.model}/${r.horizon}`;
const cohort=h=>h<=3?'0-3h':h<=6?'3-6h':h<=12?'6-12h':h<=24?'12-24h':'24-48h';
function tQuantile(p){let lo=-100,hi=100;for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(studentTCdf(mid,5)<p)lo=mid;else hi=mid;}return (lo+hi)/2;}
const quadrature=Array.from({length:41},(_,i)=>tQuantile((i+.5)/41));
const pairHalf=quadrature.reduce((s,x,i)=>s+(2*i-quadrature.length+1)*x,0)/quadrature.length**2;
const t90=tQuantile(.95);
/** 41-point quadrature approximation to the continuous ranked probability score in degrees F. */
export function temperatureCrps(meanF,scaleF,observedF){return Math.max(0,quadrature.reduce((s,z)=>s+Math.abs(meanF+scaleF*z-observedF),0)/quadrature.length-scaleF*pairHalf);}
const read=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function atomic(path,value){const tmp=path+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600});await rename(tmp,path);}
function fit(history){
 const groups={};for(const day of Object.values(history)){(groups[day.key]??=[]).push(day);}
 const out={};
 for(const [k,days] of Object.entries(groups)){
  const n=days.length,bias=days.reduce((s,d)=>s+d.errorSum/d.n,0)/(n+10);
  const standardized=days.reduce((s,d)=>s+d.z2Sum/d.n,0)/n;
  out[k]={dates:n,samples:days.reduce((s,d)=>s+d.n,0),biasF:Math.max(-5,Math.min(5,bias)),scaleMultiplier:Math.max(1,Math.sqrt(standardized*3/5)),ready:n>=7,method:'date-weighted residual bias shrunk toward zero by 10 prior days; spread only widens',truth:'NWS station observations'};
 }
 return out;
}
export function stationScienceReport(state,{station}={}){
 const groups={};for(const d of Object.values(state.history??{})){if(station&&d.station!==station)continue;const r=groups[d.key]??={station:d.station,model:d.model,horizon:d.horizon,n:0,dates:0,errorSum:0,error2Sum:0,absSum:0,crpsSum:0,covered90:0};r.n+=d.n;r.dates++;for(const f of ['errorSum','error2Sum','absSum','crpsSum','covered90'])r[f]+=d[f];}
 const metrics=Object.values(groups).map(r=>({station:r.station,model:r.model,horizon:r.horizon,samples:r.n,dates:r.dates,biasF:r.errorSum/r.n,maeF:r.absSum/r.n,rmseF:Math.sqrt(r.error2Sum/r.n),crpsF:r.crpsSum/r.n,coverage90:r.covered90/r.n}));
 return {at:state.at??null,truth:'NWS station observations; separate from venue settlement',scoring:'first available forecast per station/valid hour/model/lead cohort; observed temperature nearest valid hour within 15 minutes; 41-point quadrature CRPS',metrics,pending:Object.values(state.pending??{}).filter(r=>!station||r.station===station).length,parameters:Object.fromEntries(Object.entries(state.parameters??{}).filter(([k])=>!station||k.startsWith(station+'/'))),missingOutcomes:state.missingOutcomes??0};
}
export function stationPointForecasts(evidence,{now=Date.now(),parameters={}}={}){
 const out=[];
 for(const request of evidence.stations??[]){
  const station=request.station,inputs=[];
  const l=evidence.local?.[station];
  if(l&&now-Date.parse(l.updated)>=0&&now-Date.parse(l.updated)<=8*3600000)for(const p of l.periods??[])if(['C','F'].includes(p.temperatureUnit)&&Number.isFinite(p.temperature))inputs.push({model:'nws-grid-hourly-v1',validTime:p.startTime,meanF:p.temperatureUnit==='C'?p.temperature*9/5+32:p.temperature,scaleF:2.5,source:l.hourlyUrl,issuedAt:l.updated,uncertainty:'experimental 2.5F Student-t scale, not an NWS probability product'});
  const nbm=evidence.guidance;
  if(nbm&&now-Date.parse(nbm.runtime)>=0&&now-Date.parse(nbm.runtime)<=8*3600000)for(const r of nbm.stations[station]?.rows??[])if(Number.isFinite(r.tmp))inputs.push({model:'nbm-hourly-v5-v1',validTime:r.ftime,meanF:r.tmp,scaleF:Number.isFinite(r.tsd)?Math.max(1,r.tsd*Math.sqrt(3/5)):2.5,source:nbm.source,issuedAt:nbm.runtime,uncertainty:'NBM TSD converted to Student-t scale; 1F floor'});
  const lamp=evidence.lamp;
  if(lamp&&now-Date.parse(lamp.runtime)>=0&&now-Date.parse(lamp.runtime)<=3*3600000)for(const r of lamp.stations[station]?.rows??[])if(Number.isFinite(r.temperatureF))inputs.push({model:'lamp-hourly-v2.7-v1',validTime:r.validTime,meanF:r.temperatureF,scaleF:2.5,source:r.leadHours>25?lamp.extendedSource:lamp.source,issuedAt:lamp.runtime,uncertainty:'experimental 2.5F Student-t scale; LAMP temperature is deterministic'});
  for(const r of inputs){
   const leadHours=(Date.parse(r.validTime)-now)/3600000;if(!Number.isFinite(leadHours)||leadHours<1/12||leadHours>48||Date.parse(r.issuedAt)>now)continue;
   const dateParts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:request.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(r.validTime)).map(p=>[p.type,p.value]));
   const base={...r,station,leadHours,horizon:cohort(leadHours),availableAt:new Date(now).toISOString(),date:`${dateParts.year}-${dateParts.month}-${dateParts.day}`,nu:5};out.push(base);
   const parameter=parameters[key(base)];if(parameter?.ready)out.push({...base,model:base.model+'/station-postprocess-v1',meanF:base.meanF+parameter.biasF,scaleF:base.scaleF*parameter.scaleMultiplier,postprocessing:{...parameter,trainedThrough:new Date(now).toISOString(),baseModel:base.model}});
  }
 }
 return out;
}
/** Caller holds the station-science lock. Scores known forecasts BEFORE fitting or recording future forecasts. */
export async function updateStationScience(evidence,{root,now=Date.now(),sourceEvidenceId}={}){
 await mkdir(root,{recursive:true,mode:0o700});const file=join(root,'state.json');
 const state=await read(file,{pending:{},history:{},missingOutcomes:0});
 const traces=new Map();
 for(const e of Object.values(evidence.observations??{}))for(const r of e.readings??[]){if(!traces.has(e.station))traces.set(e.station,new Map());traces.get(e.station).set(r.at,{...r,source:e.source});}
 const readings=new Map([...traces].map(([s,rows])=>[s,[...rows.values()].sort((a,b)=>a.at.localeCompare(b.at))]));
 let scored=0,forecasted=0;const outcomes=[];
 for(const [id,r] of Object.entries(state.pending)){
  const valid=Date.parse(r.validTime);if(valid+15*60000>now)continue;
  const obs=(readings.get(r.station)??[]).filter(o=>Math.abs(Date.parse(o.at)-valid)<=15*60000&&Date.parse(o.at)<=now&&Date.parse(o.at)>Date.parse(r.availableAt)).sort((a,b)=>Math.abs(Date.parse(a.at)-valid)-Math.abs(Date.parse(b.at)-valid)||b.at.localeCompare(a.at))[0];
  if(!obs){if(now-valid>72*3600000){delete state.pending[id];state.missingOutcomes++;}continue;}
  const error=obs.temperatureF-r.meanF,k=key(r),dk=k+'/'+r.date;
  const d=state.history[dk]??={key:k,station:r.station,model:r.model,horizon:r.horizon,date:r.date,n:0,errorSum:0,error2Sum:0,z2Sum:0,absSum:0,crpsSum:0,covered90:0};
  const crps=temperatureCrps(r.meanF,r.scaleF,obs.temperatureF);d.n++;d.errorSum+=error;d.error2Sum+=error*error;d.z2Sum+=(error/r.scaleF)**2;d.absSum+=Math.abs(error);d.crpsSum+=crps;d.covered90+=Math.abs(error)<=t90*r.scaleF?1:0;
  outcomes.push({id,forecast:r,observation:obs,errorF:error,crpsF:crps,sourceEvidenceId});delete state.pending[id];scored++;
 }
 const cutoff=new Date(now-90*86400000).toISOString().slice(0,10);for(const [k,d] of Object.entries(state.history))if(d.date<cutoff)delete state.history[k];
 state.parameters=fit(state.history);
 const forecasts=stationPointForecasts(evidence,{now,parameters:state.parameters});
 for(const r of forecasts){const id=hash({station:r.station,model:r.model,horizon:r.horizon,validTime:r.validTime});if(state.pending[id])continue;state.pending[id]={...r,sourceEvidenceId};forecasted++;}
 state.at=new Date(now).toISOString();await atomic(file,state);
 return {...stationScienceReport(state),scored,forecasted,forecasts,outcomes};
}
export async function readStationScience({root,station}={}){return stationScienceReport(await read(join(root,'state.json'),{}),{station});}
