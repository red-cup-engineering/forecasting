import { latestStationGuidance, guidanceForExtreme } from './nbm-station-guidance.mjs';
import { NWS_API, NWS_USER_AGENT, climateDayStart, observedExtremes, activeTemperatureHazards } from './station-observations.mjs';
import { TEMPERATURE_MARKETS } from './temperature-market-model.mjs';
import { forecastScale, bracketProbability } from './temperature-distribution.mjs';
import { priceRainMarket } from './rain-market-model.mjs';
import {settlementWeatherEvidence} from './weather-settlement-source.mjs';
import {latestStationQuantiles,priceStationQuantiles} from './weather-quantiles.mjs';
import { mapLimit } from './weather-universe.mjs';
import { cell, merge, address } from '@red-cup-engineering/signcell/cell';

async function nws(url, fetchImpl) {
  const r=await fetchImpl(url,{headers:{'User-Agent':NWS_USER_AGENT,Accept:'application/geo+json'},signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw new Error(`NWS ${r.status}: ${url}`);
  return r.json();
}
export async function collectWeatherEvidence(contracts,{cacheDir,now=Date.now(),fetchImpl=fetch}={}) {
  const stations=[...new Set(contracts.flatMap(c=>c.binding?[c.binding.station]:[]))];
  const errors=[];
  let guidance=null;
  try{guidance=await latestStationGuidance({stations,cacheDir,now},{fetchImpl});}catch(e){errors.push({source:'NBM',error:e.message});}
  let quantiles=null;try{quantiles=await latestStationQuantiles({stations,cacheDir,now,fetchImpl});}catch(e){errors.push({source:'NBM-QMD',error:e.message});}
  const settlement=await settlementWeatherEvidence(contracts,{now,fetchImpl});errors.push(...settlement.errors);
  const observations={},local={};
  await mapLimit(stations,3,async station=>{
    const contractsHere=contracts.filter(c=>c.binding?.station===station);
    const b=contractsHere[0].binding;
    try{
      const info=await nws(`${NWS_API}/stations/${station}`,fetchImpl);
      const [lon,lat]=info.geometry.coordinates;
      const point=await nws(`${NWS_API}/points/${lat.toFixed(4)},${lon.toFixed(4)}`,fetchImpl);
      const hourlyUrl=point.properties.forecastHourly;
      const hourly=await nws(hourlyUrl,fetchImpl);
      const alerts=await activeTemperatureHazards({station},{fetchImpl});
      local[station]={station,latitude:lat,longitude:lon,hourlyUrl,updated:hourly.properties.updateTime ?? hourly.properties.updated,periods:hourly.properties.periods,alerts};
    }catch(e){errors.push({station,source:'NWS-hourly/alerts',error:e.message});}
    for(const date of new Set(contractsHere.map(c=>c.binding.targetDate))) {
      if(now<Date.parse(climateDayStart(date,b.timeZone)) || now>Date.parse(climateDayStart(date,b.timeZone))+86400000)continue;
      try{observations[`${station}/${date}`]=await observedExtremes({station,date,timeZone:b.timeZone,now},{fetchImpl});}
      catch(e){errors.push({station,date,source:'NWS-observations',error:e.message});}
    }
  });
  return {at:new Date(now).toISOString(),guidance,quantiles,settlement,local,observations,errors};
}
export function weatherEstimates(c,e,now) {
  const b=c.binding;if(!b)return [];
  if(b.kind==='rain') {
    if(!e.guidance)return [];
    const r=priceRainMarket(c,{guidance:e.guidance,now});
    return r.priced?[{id:'nbm-rain-logistic-2026-10-04',p:r.probability,details:r}]:[];
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
  // Observations and hazards remain witnesses; proxy observations never force a TWC outcome to zero.
  return out;
}
export function forecastCell(c,models) {
  const tells=models.map(m=>cell(c.ticker,'settles-yes',{source:c.source,rules:c.ruleKey}, {for:m.p>0.5?[{model:m.id,p:m.p}]:[],against:m.p<0.5?[{model:m.id,p:m.p}]:[]}));
  const value=tells.length?tells.reduce(merge):cell(c.ticker,'settles-yes',{source:c.source,rules:c.ruleKey});
  return {address:address(value),cell:value,conflicted:Boolean(value.for.length&&value.against.length)};
}
