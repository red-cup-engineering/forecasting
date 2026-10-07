import {latestLampGuidance} from './lamp-station-guidance.mjs';
import { latestStationGuidance, guidanceForExtreme } from './nbm-station-guidance.mjs';
import { NWS_API, NWS_USER_AGENT, climateDayStart, observedExtremes, activeTemperatureHazards } from './station-observations.mjs';
import { TEMPERATURE_MARKETS } from './temperature-market-model.mjs';
import { forecastScale, bracketProbability } from './temperature-distribution.mjs';
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
    const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:r.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
    let today=fmt.format(new Date(now));
    if(climateDayStart(today,r.timeZone).getTime()>now)today=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
    const targetDates=r.targetDates??[today];
    if(!Array.isArray(targetDates)||targetDates.length<1||(!marketCollection&&targetDates.length>4)||targetDates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d))throw new TypeError('provide 1..4 real ISO target dates per station');
    return {station:r.station,timeZone:r.timeZone,targetDates:[...new Set(targetDates)]};
  });
  if(new Set(normalized.map(r=>r.station)).size!==normalized.length)throw new TypeError('combine target dates into one request per station');
  const stations=normalized.map(r=>r.station),errors=[];
  let guidance=null,quantiles=null,lamp=null;
  try{guidance=await latestStationGuidance({stations,cacheDir,now},{fetchImpl});}catch(e){errors.push({source:'NBM',error:e.message});}
  try{quantiles=await latestStationQuantiles({stations,cacheDir,now,fetchImpl});}catch(e){errors.push({source:'NBM-QMD',error:e.message});}
  try{lamp=await latestLampGuidance({stations,cacheDir,now,fetchImpl});for(const station of lamp.missingStations??[])errors.push({station,source:'LAMP',error:'no complete station block in the selected run'});}catch(e){errors.push({source:'LAMP',error:e.message});}
  const settlement=await climateReportEvidence({dates:normalized.flatMap(r=>r.targetDates),now,fetchImpl});errors.push(...settlement.errors);
  const observations={},local={};
  await mapLimit(normalized,3,async b=>{
    const station=b.station;
    try{
      const info=await nws(`${NWS_API}/stations/${station}`,fetchImpl);
      const [lon,lat]=info.geometry.coordinates;
      const point=await nws(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,fetchImpl);
      const hourlyUrl=point.properties.forecastHourly;
      const hourly=await nws(hourlyUrl,fetchImpl);
      const alerts=await activeTemperatureHazards({station},{fetchImpl});
      local[station]={station,latitude:lat,longitude:lon,hourlyUrl,updated:hourly.properties.updateTime??hourly.properties.updated,periods:hourly.properties.periods,alerts};
    }catch(e){errors.push({station,source:'NWS-hourly/alerts',error:e.message});}
    // Physical verification needs today's observations even when every open contract is for tomorrow.
    const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:b.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
    let today=fmt.format(new Date(now));if(climateDayStart(today,b.timeZone).getTime()>now)today=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
    const dates=new Set([...b.targetDates,today]);
    if(now-climateDayStart(today,b.timeZone).getTime()<3600000)dates.add(new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10));
    for(const date of dates) {
      const start=climateDayStart(date,b.timeZone).getTime();
      if(now<start)continue;
      try{observations[`${station}/${date}`]=await observedExtremes({station,date,timeZone:b.timeZone,now:Math.min(now,start+86400000)},{fetchImpl});}
      catch(e){errors.push({station,date,source:'NWS-observations',error:e.message});}
    }
  });
  return {at:new Date(now).toISOString(),stations:normalized,guidance,quantiles,lamp,settlement,local,observations,errors};
}
export async function collectWeatherEvidence(contracts,options={}) {
  const requests=new Map();
  for(const c of contracts)if(c.binding){const b=c.binding;if(!requests.has(b.station))requests.set(b.station,{station:b.station,timeZone:b.timeZone,targetDates:[]});const r=requests.get(b.station);if(!r.targetDates.includes(b.targetDate))r.targetDates.push(b.targetDate);}
  if(!requests.size)return {at:new Date(options.now??Date.now()).toISOString(),stations:[],guidance:null,quantiles:null,settlement:null,local:{},observations:{},errors:[]};
  return collectStationWeatherEvidence([...requests.values()],{...options,marketCollection:true});
}
export function weatherEstimates(c,e,now) {
  const b=c.binding;if(!b)return [];
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
  const covered=periods.length&&Date.parse(periods.at(-1).endTime)>=end&&(beforeDay?Date.parse(periods[0].startTime)<=start:Boolean(obs?.count));
  if(covered&&Number.isFinite(Date.parse(l.updated))&&now-Date.parse(l.updated)<=8*3600000) {
    const values=periods.map(p=>p.temperatureUnit==='C'?p.temperature*9/5+32:p.temperature).filter(Number.isFinite);
    if(obs?.count)values.push(b.kind==='high'?obs.maxF:obs.minF);
    if(values.length) {
      const mean=b.kind==='high'?Math.max(...values):Math.min(...values);
      const scale=Math.max(2.5,Math.sqrt(2.5**2+Math.max(0,start-now)/86400000));
      out.push({id:`nws-hourly-extreme-${b.kind}-v1`,p:bracketProbability(bracket,{mean,scale,nu:5}),details:{mean,scale,nu:5,forecastSource:l.hourlyUrl,proxy:b.proxy}});
    }
  }
  out.push(...lampDailyEstimates(c,e,now));
  // Observations and hazards remain witnesses; proxy observations never force a TWC outcome to zero.
  return out;
}
/** Hourly station guidance gives a competing daily-extreme proxy. Its uncertainty is a local experiment. */
export function lampDailyEstimates(c,e,now){
  const b=c.binding,lamp=e.lamp;if(!b||!['high','low'].includes(b.kind)||!lamp||now<Date.parse(lamp.runtime)||now-Date.parse(lamp.runtime)>3*3600000)return [];
  const start=climateDayStart(b.targetDate,b.timeZone).getTime(),end=start+86400000;
  const obs=e.observations[`${b.station}/${b.targetDate}`],rows=(lamp.stations[b.station]?.rows??[]).filter(r=>Number.isFinite(r.temperatureF)&&Date.parse(r.validTime)>=Math.max(start,now)&&Date.parse(r.validTime)<end);
  if(!rows.length||Date.parse(rows.at(-1).validTime)<end-3600000||now>=start&&!obs?.count||now<start&&Date.parse(rows[0].validTime)>start)return [];
  const first=now<start?start:Math.ceil(now/3600000)*3600000;
  for(let t=first;t<end;t+=3600000)if(!rows.some(r=>Date.parse(r.validTime)===t))return [];
  const bracket={strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike},out=[];
  for(const calibrated of [false,true]){
    let adjusted=0;const scales=[2.5];
    const values=rows.map(r=>{
      if(!calibrated)return r.temperatureF;
      const h=(Date.parse(r.validTime)-now)/3600000,horizon=h<=3?'0-3h':h<=6?'3-6h':h<=12?'6-12h':h<=24?'12-24h':'24-48h';
      const p=e.science?.parameters?.[`${b.station}/lamp-hourly-v2.7-v1/${horizon}`];
      if(!p?.ready)return r.temperatureF;adjusted++;scales.push(2.5*p.scaleMultiplier);return r.temperatureF+p.biasF;
    });
    if(calibrated&&!adjusted)continue;
    if(obs?.count)values.push(b.kind==='high'?obs.maxF:obs.minF);
    const mean=b.kind==='high'?Math.max(...values):Math.min(...values),scale=Math.max(...scales),id=calibrated?`lamp-postprocessed-extreme-${b.kind}-v1`:`lamp-hourly-extreme-${b.kind}-v1`;
    out.push({id,p:bracketProbability(bracket,{mean,scale,nu:5}),details:{mean,scale,nu:5,runtime:lamp.runtime,source:lamp.source,extendedSource:lamp.extendedSource,forecastHours:rows.length,adjustedHours:adjusted,proxy:b.proxy,uncertainty:'experimental hourly-to-daily extreme approximation; not LAMP probability guidance',observationSource:obs?.source??null}});
  }
  return out;
}
export function forecastCell(c,models) {
  const tells=models.map(m=>cell(c.ticker,'settles-yes',{source:c.source,rules:c.ruleKey}, {for:m.p>0.5?[{model:m.id,p:m.p}]:[],against:m.p<0.5?[{model:m.id,p:m.p}]:[]}));
  const value=tells.length?tells.reduce(merge):cell(c.ticker,'settles-yes',{source:c.source,rules:c.ruleKey});
  return {address:address(value),cell:value,conflicted:Boolean(value.for.length&&value.against.length)};
}
