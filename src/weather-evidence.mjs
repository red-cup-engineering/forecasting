import {collectEcmwfEnsemble} from './weather-ecmwf-ensemble.mjs';
import {access} from 'node:fs/promises';
import {homedir} from 'node:os';
import {collectRelationalWeatherNowcast} from './weather-relational-nowcast.mjs';
import {RELATIONAL_REGIONS} from './weather-relational-temperature.mjs';
import {join} from 'node:path';
import {priceDailyTemperatureExtreme} from './weather-temperature-extremes.mjs';
import {makeBracketProbabilityPool} from './weather-ensemble.mjs';
import {INDEX_CITIES,indexConfiguration,collectWeatherIndexEvidence,priceWeatherIndex} from './weather-index.mjs';
import {latestHourlyGuidance} from './nbm-hourly-guidance.mjs';
import {latestLampGuidance} from './lamp-station-guidance.mjs';
import { latestStationGuidance, guidanceForExtreme } from './nbm-station-guidance.mjs';
import { NWS_API, NWS_USER_AGENT, climateDate, climateDayStart, observedExtremes, activeTemperatureHazards } from './station-observations.mjs';
import { TEMPERATURE_MARKETS } from './temperature-market-model.mjs';
import { forecastScale, bracketProbability, bracketBounds, studentTCdf } from './temperature-distribution.mjs';
import { priceRainMarket,priceRainPoolMarket } from './rain-market-model.mjs';
import {climateReportEvidence} from './weather-settlement-source.mjs';
import {latestStationQuantiles,priceStationQuantiles} from './weather-quantiles.mjs';
import { mapLimit } from './weather-universe.mjs';
import { cell, merge, address } from '@red-cup-engineering/signcell/cell';

async function nws(url, fetchImpl) {
  const r=await fetchImpl(url,{headers:{'User-Agent':NWS_USER_AGENT,Accept:'application/geo+json'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`NWS ${r.status}: ${url}`);
  return r.json();
}
/** Public station evidence for research and forecasting, independent of any market. */
export async function collectStationWeatherEvidence(requests,{cacheDir,now=Date.now(),fetchImpl=fetch,marketCollection=false}={}) {
  if(!Array.isArray(requests)||requests.length<1||(!marketCollection&&requests.length>16))throw new TypeError('provide 1..16 station requests');
  const normalized=requests.map(r=>{
    if(!r||!/^[A-Z0-9]{4}$/.test(r.station)||typeof r.timeZone!=='string')throw new TypeError('station ICAO and IANA time zone required');
    const today=climateDate(r.timeZone,now);
    const targetDates=r.targetDates??[today];
    if(!Array.isArray(targetDates)||targetDates.length<1||(!marketCollection&&targetDates.length>4)||targetDates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d))throw new TypeError('provide 1..4 real ISO target dates per station');
    return {station:r.station,timeZone:r.timeZone,targetDates:[...new Set(targetDates)]};
  });
  if(new Set(normalized.map(r=>r.station)).size!==normalized.length)throw new TypeError('combine target dates into one request per station');
  const stations=normalized.map(r=>r.station),errors=[];
  let guidance=null,quantiles=null,lamp=null,hourlyGuidance=null;
  try{guidance=await latestStationGuidance({stations,cacheDir,now},{fetchImpl});}catch(e){errors.push({source:'NBM',error:e.message});}
  try{hourlyGuidance=await latestHourlyGuidance({stations,cacheDir,now},{fetchImpl});for(const station of hourlyGuidance.missingStations??[])if(stations.includes(station))errors.push({station,source:'NBM-NBH',error:'no complete hourly block in selected run'});}catch(e){errors.push({source:'NBM-NBH',error:e.message});}
  try{quantiles=await latestStationQuantiles({stations,cacheDir,now,fetchImpl});}catch(e){errors.push({source:'NBM-QMD',error:e.message});}
  try{lamp=await latestLampGuidance({stations,cacheDir,now,fetchImpl});for(const station of lamp.missingStations??[])errors.push({station,source:'LAMP',error:'no complete station block in the selected run'});}catch(e){errors.push({source:'LAMP',error:e.message});}
  const settlement=await climateReportEvidence({dates:normalized.flatMap(r=>r.targetDates),now,fetchImpl});errors.push(...settlement.errors);
  const observations={},local={},stationMetadata={};
  await mapLimit(normalized,3,async b=>{
    const station=b.station;
    try{
      const info=await nws(`${NWS_API}/stations/${station}`,fetchImpl);
      const [lon,lat]=info.geometry.coordinates;
      stationMetadata[station]={latitude:lat,longitude:lon,source:{url:`${NWS_API}/stations/${station}`,availableAt:new Date().toISOString(),raw:info}};
      const point=await nws(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,fetchImpl);
      const hourlyUrl=point.properties.forecastHourly;
      const hourly=await nws(hourlyUrl,fetchImpl);
      local[station]={station,latitude:lat,longitude:lon,hourlyUrl,updated:hourly.properties.updateTime??hourly.properties.updated,periods:hourly.properties.periods,alerts:null};
    }catch(e){errors.push({station,source:'NWS-hourly',error:e.message});}
    try{const alerts=await activeTemperatureHazards({station},{fetchImpl});if(local[station])local[station].alerts=alerts;}catch(e){errors.push({station,source:'NWS-alerts',error:e.message});}
    // Physical verification needs today's observations even when every open contract is for tomorrow.
    const today=climateDate(b.timeZone,now);
    const dates=new Set([...b.targetDates,today]);
    if(now-climateDayStart(today,b.timeZone).getTime()<3600000)dates.add(new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10));
    for(const date of dates) {
      const start=climateDayStart(date,b.timeZone).getTime();
      if(now<start)continue;
      try{observations[`${station}/${date}`]=await observedExtremes({station,date,timeZone:b.timeZone,now:Math.min(now,start+86400000)},{fetchImpl});}
      catch(e){errors.push({station,date,source:'NWS-observations',error:e.message});}
    }
  });
  const relational={regions:[]};
  for(const [region,peers] of Object.entries(RELATIONAL_REGIONS))if(stations.some(station=>peers.includes(station.slice(1))))try{relational.regions.push(await collectRelationalWeatherNowcast({region,cacheDir:cacheDir?join(cacheDir,'relational'):undefined,now:Date.now(),fetchImpl}));}catch(e){errors.push({source:'relational-nowcast',region,error:e.message});}
  let ecmwfEnsemble=null;
  const python=process.env.WEATHER_ECCODES_PYTHON??join(homedir(),'.local/share/561-group/weather-research/eccodes/bin/python');
  if(cacheDir&&process.env.WEATHER_ECMWF_ENABLED!=='0'&&Object.keys(stationMetadata).length){
   let decoderAvailable=false;try{await access(python);decoderAvailable=true;}catch{}
   if(decoderAvailable)try{ecmwfEnsemble=await collectEcmwfEnsemble(normalized.filter(r=>stationMetadata[r.station]),{cacheDir:join(cacheDir,'..','ecmwf'),now:Date.now(),fetchImpl,python,stationMetadata});}catch(e){errors.push({source:'ECMWF-AIFS-ENS',error:e.message});}
  }
  return {at:new Date(now).toISOString(),stations:normalized,guidance,hourlyGuidance,quantiles,lamp,settlement,local,observations,relational,ecmwfEnsemble,errors};
}
export async function collectWeatherEvidence(contracts,options={}) {
  const requests=new Map(),now=options.now??Date.now(),cities=[...new Set(contracts.filter(c=>c.binding?.kind==='index-at').map(c=>c.binding.city))];
  const indexEvidence=cities.length?await collectWeatherIndexEvidence(cities,{now,fetchImpl:options.fetchImpl}):{cities:{},errors:[]};
  function request(station,timeZone,targetDate){if(!requests.has(station))requests.set(station,{station,timeZone,targetDates:[]});const r=requests.get(station);if(!r.targetDates.includes(targetDate))r.targetDates.push(targetDate);}
  for(const c of contracts)if(c.binding&&c.binding.kind!=='index-at'){const b=c.binding;request(b.station,b.timeZone,b.targetDate);}
  const configurationAvailableAt=Date.now();
  for(const city of cities){
   const cityContracts=contracts.filter(c=>c.binding?.city===city),dates=[...new Set(cityContracts.map(c=>c.binding.targetDate))],packet=indexEvidence.cities[city];
   const targetTimes=[configurationAvailableAt,...cityContracts.map(c=>Date.parse(c.binding.targetTime)).filter(Number.isFinite),...(packet.calibrations?.calibrations??[]).filter(c=>c.published_at_ms<=configurationAvailableAt&&c.effective_at_ms<=configurationAvailableAt+24*3600000&&c.effective_at_ms>configurationAvailableAt).map(c=>c.effective_at_ms)];
   for(const targetTime of new Set(targetTimes)){const cfg=indexConfiguration(packet,city,targetTime,configurationAvailableAt);if(!cfg)continue;for(const member of cfg.stations)for(const date of dates)request(member.station_id.slice(0,4),INDEX_CITIES[city].timeZone,date);}
  }
  const evidence=requests.size?await collectStationWeatherEvidence([...requests.values()],{...options,now,marketCollection:true}):{at:new Date(now).toISOString(),stations:[],guidance:null,quantiles:null,settlement:null,local:{},observations:{},errors:[]};
  evidence.indices=indexEvidence.cities;evidence.errors.push(...indexEvidence.errors);return evidence;
}
export function weatherEstimates(c,e,now) {
  const b=c.binding;if(!b)return [];
  if(b.kind==='index-at')return priceWeatherIndex(c,e,now);
  if(b.kind==='rain') {
    if(!e.guidance)return [];
    const r=priceRainMarket(c,{guidance:e.guidance,now});
    const out=r.priced?[{id:'nbm-rain-logistic-2026-10-04',p:r.probability,details:r}]:[];
    const a=Number(c.yes_ask_dollars),bid=Number(c.yes_bid_dollars);
    const pooled=priceRainPoolMarket(c,{guidance:e.guidance,marketProbability:a>bid&&a<=1&&bid>=0?(a+bid)/2:null,now});if(pooled)out.push(pooled);
    return out;
  }
  const bracket={strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike};
  if(!['less','greater','between'].includes(bracket.strikeType))return [];
  const q=priceStationQuantiles(c,e.quantiles,now);
  const out=q?[q]:[],g=e.guidance&&guidanceForExtreme(e.guidance.stations[b.station],{targetDate:b.targetDate,kind:b.kind});
  if(g&&now-Date.parse(g.runtime)>=0&&now-Date.parse(g.runtime)<=8*3600000) {
    const m=TEMPERATURE_MARKETS.models[b.kind],mean=g.txn+(m.stationBias[b.station]??0);
    const scale=forecastScale(g,m);
    out.push({id:`nbm-t-${b.kind}-2026-10-02`,p:bracketProbability(bracket,{mean,scale,nu:m.nu}),details:{mean,scale,nu:m.nu,runtime:g.runtime}});
  }
  const l=e.local[b.station],obs=e.observations[`${b.station}/${b.targetDate}`];
  const start=climateDayStart(b.targetDate,b.timeZone).getTime(),end=start+86400000;
  const periods=(l?.periods??[]).filter(p=>Date.parse(p.startTime)>=start&&Date.parse(p.startTime)<end);
  const beforeDay=now<start;
  const complete=periods.every((p,i)=>['C','F'].includes(p.temperatureUnit)&&Number.isFinite(p.temperature)&&Number.isFinite(Date.parse(p.startTime))&&Number.isFinite(Date.parse(p.endTime))&&Date.parse(p.endTime)>Date.parse(p.startTime)&&(!i||Date.parse(p.startTime)<=Date.parse(periods[i-1].endTime)));
  const covered=periods.length&&complete&&Date.parse(periods.at(-1).endTime)>=end&&(beforeDay?Date.parse(periods[0].startTime)<=start:Boolean(obs?.count));
  if(covered&&Number.isFinite(Date.parse(l.updated))&&now>=Date.parse(l.updated)&&now-Date.parse(l.updated)<=8*3600000) {
    const values=periods.filter(p=>['C','F'].includes(p.temperatureUnit)&&Number.isFinite(p.temperature)).map(p=>p.temperatureUnit==='C'?p.temperature*9/5+32:p.temperature);
    if(obs?.count)values.push(b.kind==='high'?obs.maxF:obs.minF);
    if(values.length) {
      const mean=b.kind==='high'?Math.max(...values):Math.min(...values);
      const scale=Math.max(2.5,Math.sqrt(2.5**2+Math.max(0,start-now)/86400000));
      out.push({id:`nws-hourly-extreme-${b.kind}-v1`,p:bracketProbability(bracket,{mean,scale,nu:5}),details:{mean,scale,nu:5,forecastSource:l.hourlyUrl,proxy:b.proxy}});
    }
  }
  out.push(...lampDailyEstimates(c,e,now));
  const hourlyExtreme=priceDailyTemperatureExtreme(c,e,now);if(hourlyExtreme)out.push(hourlyExtreme);
  const candidates=out.flatMap(r=>{
    const family=r.id===`nbm-qmd-${b.kind}-v5-v1`||r.id===`nbm-t-${b.kind}-2026-10-02`?'nbm':r.id===`nws-hourly-extreme-${b.kind}-v1`?'nws':r.id===`lamp-hourly-extreme-${b.kind}-v2`?'lamp':null;
    return family?[{...r,family,priority:r.id.startsWith('nbm-qmd-')?1:0}]:[];
  });
  const pool=makeBracketProbabilityPool(candidates);
  if(pool)out.push({id:`weather-family-pool-${b.kind}-v1`,p:pool.p,details:{...pool,proxy:b.proxy,status:'prospective daily-extreme ensemble experiment; NBM quantiles preferred over NBM location-scale model within one family'}});
  out.push(...softObservationEstimates(c,e,out));
  out.push(...observedExtremeEstimates(c,e,now));
  // Observations and hazards remain witnesses; proxy observations never force a TWC outcome to zero.
  return out;
}
/**
 * The day's extreme as the extreme of two parts: what the station has already recorded and what the rest
 * of the climate day still holds. The recorded part carries only the error between hourly observations and
 * the climate report (the report reads the continuous record, so its high sits at or above the hourly
 * maximum and its low at or below the hourly minimum); the rest carries forecast error growing with lead.
 * Once the day is over the rest is empty and the uncertainty is the observation-to-report error alone,
 * which the fixed 2.5 F floors of the forecast-only models above never reach.
 *
 * The observation bound is structural: the report's high cannot fall under the station's one-degree-loose
 * floor (nor its low above the ceiling), so a bracket entirely on the far side is impossible and a
 * one-sided tail entirely on the near side is certain. A report read through a proxy (TWC) keeps a
 * source-disagreement margin instead of an exact bound: the posterior mean (0+1)/(240+2) = 0.4% from the
 * dead-bracket meter, where the precise bound ruled out 430 brackets on 240 settled events (2026-10-02..06,
 * 48 series) and none settled yes; the event is the unit, since a source error would hit a whole ladder.
 */
/**
 * What the day's readings so far rule in or out for one bracket, exactly: the report's whole-degree high K is at
 * least the precise floor (its low at most the precise ceiling), so a bracket wholly on the far side cannot
 * settle yes and a one-sided tail wholly on the near side must. A proxy-read report keeps `margin`.
 * @returns {{structural: {low: number, high: number}|null, bound: number|null}}
 */
export function observedBracketBound({kind,proxy,bracket},obs,margin=OBSERVED_EXTREME.proxyMargin){
  const [lo,hi]=bracketBounds(bracket),m=proxy?margin:0;
  const bound=kind==='high'?(Number.isFinite(obs?.floorPrecise)?obs.floorPrecise:obs?.floor):(Number.isFinite(obs?.ceilingPrecise)?obs.ceilingPrecise:obs?.ceiling);
  if(!Number.isFinite(bound))return {structural:null,bound:null};
  let structural=null;
  const ruled=(low,high)=>({low,high,kind:'station-observation'});
  if(kind==='high'){if(hi<=bound)structural=ruled(0,m);else if(hi===Infinity&&lo<bound)structural=ruled(1-m,1);}
  else{if(lo>=bound)structural=ruled(0,m);else if(lo===-Infinity&&hi>bound)structural=ruled(1-m,1);}
  return {structural,bound};
}
// Fitted 2026-10-08 (forecasting-service scripts/climate-report-meter.mjs, 140 station-days with full readings): the final
// report's extreme minus the observed hourly extreme centres on 0 (62 of 140 exactly) with a spread of about 0.6 F.
export const OBSERVED_EXTREME = Object.freeze({reportShiftF:0,reportScaleF:0.6,restScaleF:1.5,restScalePerHourF:0.1,restScaleMaxF:4,nu:5,maxObservationAgeMinutes:90,proxyMargin:0.004});
export function observedExtremeEstimates(c,e,now,model=OBSERVED_EXTREME){
  const b=c.binding;if(!b||!['high','low'].includes(b.kind)||!['less','greater','between'].includes(c.strike_type))return [];
  const obs=e.observations?.[`${b.station}/${b.targetDate}`];if(!obs?.count)return [];
  const start=climateDayStart(b.targetDate,b.timeZone).getTime(),end=start+86400000,latest=Date.parse(obs.latest);
  if(now<start||!Number.isFinite(latest)||Math.min(now,end)-latest>model.maxObservationAgeMinutes*60000)return [];
  const high=b.kind==='high',sign=high?1:-1,observed=high?obs.maxF:obs.minF;
  const remaining=(e.local?.[b.station]?.periods??[]).flatMap(p=>{const t=Date.parse(p.startTime);return t>latest&&t<end&&Number.isFinite(p.temperature)&&['C','F'].includes(p.temperatureUnit)?[{t,f:p.temperatureUnit==='C'?p.temperature*9/5+32:p.temperature}]:[];});
  const hoursLeft=Math.max(0,(end-Math.max(latest,now))/3600000);
  if(hoursLeft>1&&!remaining.length)return [];
  const rest=remaining.reduce((best,r)=>!best||sign*r.f>sign*best.f?r:best,null);
  const restScale=rest?Math.min(model.restScaleMaxF,model.restScaleF+model.restScalePerHourF*Math.max(0,(rest.t-now)/3600000)):null;
  const reportCenter=observed+sign*model.reportShiftF;
  const T=(x,center,scale)=>studentTCdf((x-center)/scale,model.nu);
  // CDF of the report's extreme: a max of independent parts multiplies CDFs, a min multiplies survivals.
  const F=high?x=>T(x,reportCenter,model.reportScaleF)*(rest?T(x,rest.f,restScale):1):x=>1-(1-T(x,reportCenter,model.reportScaleF))*(rest?1-T(x,rest.f,restScale):1);
  const bracket={strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike},[lo,hi]=bracketBounds(bracket);
  let p=(hi===Infinity?1:F(hi))-(lo===-Infinity?0:F(lo));
  const {structural,bound}=observedBracketBound({kind:b.kind,proxy:b.proxy,bracket},obs,model.proxyMargin);
  const floor=bound,ceiling=bound;
  p=Math.min(structural?.high??1,Math.max(structural?.low??0,Math.min(1,Math.max(0,p))));
  return [{id:`observed-extreme-${b.kind}-v1`,p,details:{observedF:observed,boundF:high?floor:ceiling,observationLatest:obs.latest,observationCount:obs.count,observationSource:obs.source,reportCenterF:reportCenter,reportScaleF:model.reportScaleF,restExtremeF:rest?.f??null,restLeadHours:rest?(rest.t-now)/3600000:null,restScaleF:restScale,hoursLeft,nu:model.nu,proxy:b.proxy,...(structural?{structuralProbabilityBounds:structural}:{}),status:'forward experiment: report shift and scales are priors until settlement grades fit them'}}];
}
/** Hourly station guidance gives a competing daily-extreme proxy. Its uncertainty is a local experiment. */
export function lampDailyEstimates(c,e,now){
  const b=c.binding,lamp=e.lamp;if(!b||!['high','low'].includes(b.kind)||!lamp||now<Date.parse(lamp.runtime)||now-Date.parse(lamp.runtime)>3*3600000)return [];
  const start=climateDayStart(b.targetDate,b.timeZone).getTime(),end=start+86400000;
  const obs=e.observations[`${b.station}/${b.targetDate}`],first=Math.max(start,now);
  if(first>=end||now>=start&&!obs?.count)return [];
  const all=new Map((lamp.stations[b.station]?.rows??[]).filter(r=>Number.isFinite(r.temperatureF)).map(r=>[Date.parse(r.validTime),r]));
  const rows=[];for(let t=Math.ceil(first/3600000)*3600000;t<=Math.ceil(end/3600000)*3600000;t+=3600000){const r=all.get(t);if(!r)return [];rows.push(r);}
  // Join the latest real temperature to future guidance when the fresh bulletin starts next hour.
  const anchor=now>=start?(obs?.readings??[]).filter(r=>Date.parse(r.at)<=first&&first-Date.parse(r.at)<=30*60000&&Number.isFinite(r.temperatureF)).sort((a,b)=>b.at.localeCompare(a.at))[0]:null;
  if(anchor){while(rows.length&&Date.parse(rows[0].validTime)<=Date.parse(anchor.at))rows.shift();rows.unshift({validTime:anchor.at,temperatureF:anchor.temperatureF,observedAnchor:true});}
  else if(Math.floor(first/3600000)*3600000<first&&all.has(Math.floor(first/3600000)*3600000))rows.unshift(all.get(Math.floor(first/3600000)*3600000));
  else if(Date.parse(rows[0].validTime)>first)rows.unshift({validTime:new Date(first).toISOString(),temperatureF:rows[0].temperatureF,constantBackfill:true});
  const interpolate=(t,values)=>{if(values.has(t))return values.get(t);for(let i=0;i<rows.length-1;i++){const lo=Date.parse(rows[i].validTime),hi=Date.parse(rows[i+1].validTime);if(lo<=t&&t<=hi)return values.get(lo)+(values.get(hi)-values.get(lo))*(t-lo)/(hi-lo);}return NaN;};
  const bracket={strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike},out=[];
  for(const calibrated of [false,true]){
    let adjusted=0;const scales=[2.5];
    const pointValues=rows.map(r=>{
      if(!calibrated||r.observedAnchor)return r.temperatureF;
      const h=(Date.parse(r.validTime)-now)/3600000,horizon=h<=3?'0-3h':h<=6?'3-6h':h<=12?'6-12h':h<=24?'12-24h':'24-48h';
      const p=e.science?.parameters?.[`${b.station}/lamp-hourly-v2.7-v1/${horizon}`];
      if(!p?.ready)return r.temperatureF;adjusted++;scales.push(2.5*p.scaleMultiplier);return r.temperatureF+p.biasF;
    });
    if(calibrated&&!adjusted)continue;
    const byTime=new Map(rows.map((r,i)=>[Date.parse(r.validTime),pointValues[i]]));
    const values=[interpolate(first,byTime),interpolate(end-1,byTime),...rows.map((r,i)=>({t:Date.parse(r.validTime),value:pointValues[i]})).filter(r=>r.t>first&&r.t<end).map(r=>r.value)];
    if(obs?.count)values.push(b.kind==='high'?obs.maxF:obs.minF);
    const mean=b.kind==='high'?Math.max(...values):Math.min(...values),scale=Math.max(...scales),id=calibrated?`lamp-postprocessed-extreme-${b.kind}-v2`:`lamp-hourly-extreme-${b.kind}-v2`;
    out.push({id,p:bracketProbability(bracket,{mean,scale,nu:5}),details:{mean,scale,nu:5,runtime:lamp.runtime,source:lamp.source,extendedSource:lamp.extendedSource,forecastHours:rows.filter(r=>!r.observedAnchor&&!r.constantBackfill).length,trajectoryPoints:rows.length,boundaryMethod:rows[0].observedAnchor?'latest NWS reading joined to future LAMP':rows[0].constantBackfill?'first future LAMP temperature held constant back to now':'LAMP point interpolation',adjustedHours:adjusted,proxy:b.proxy,uncertainty:'experimental piecewise-linear hourly-to-daily extreme approximation; not LAMP probability guidance',observationSource:obs?.source??null}});
  }
  return out;
}
/** Recover the existing bounded-temperature model with an explicit, uncalibrated proxy-failure mixture. */
export function softObservationEstimates(c,e,models){
  const b=c.binding,obs=b&&e.observations[`${b.station}/${b.targetDate}`];
  if(!b||!['high','low'].includes(b.kind)||!obs||obs.count<3)return [];
  const observedFloor=b.kind==='high'&&Number.isFinite(obs.floor)?obs.floor:-Infinity;
  const observedCeiling=b.kind==='low'&&Number.isFinite(obs.ceiling)?obs.ceiling:Infinity;
  if(!Number.isFinite(observedFloor)&&!Number.isFinite(observedCeiling))return [];
  const bracket={strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike},proxyFailureProbability=.01,out=[];
  for(const m of models){
    const {mean,scale,nu}=m.details??{};if(![mean,scale,nu,m.p].every(Number.isFinite)||scale<=0||nu<=0)continue;
    const mass=studentTCdf((observedCeiling+.5-mean)/scale,nu)-studentTCdf((observedFloor-.5-mean)/scale,nu);
    if(mass<=1e-12)continue;
    const conditioned=bracketProbability(bracket,{mean,scale,nu,observedFloor,observedCeiling});
    out.push({id:m.id+'/observation-proxy-mixture-v1',p:(1-proxyFailureProbability)*conditioned+proxyFailureProbability*m.p,details:{...m.details,baseModel:m.id,conditionedProbability:conditioned,proxyFailureProbability,observedFloor:Number.isFinite(observedFloor)?observedFloor:null,observedCeiling:Number.isFinite(observedCeiling)?observedCeiling:null,observationSource:obs.source,observationLatest:obs.latest,observationCount:obs.count,observationMethod:'existing one-degree-loose observation bound, mixed with unconditioned model',status:'forward experiment; 1% source-disagreement prior is uncalibrated'}});
  }
  return out;
}
export function forecastCell(c,models) {
  const tells=models.map(m=>cell(c.ticker,'settles-yes',{source:c.source,rules:c.ruleKey}, {for:m.p>0.5?[{model:m.id,p:m.p}]:[],against:m.p<0.5?[{model:m.id,p:m.p}]:[]}));
  const value=tells.length?tells.reduce(merge):cell(c.ticker,'settles-yes',{source:c.source,rules:c.ruleKey});
  return {address:address(value),cell:value,conflicted:Boolean(value.for.length&&value.against.length)};
}
