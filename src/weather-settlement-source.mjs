import {mapLimit} from './weather-universe.mjs';
export const TWC_KALSHI='https://weather.com/kalshi';
async function get(path,fetchImpl){const source=TWC_KALSHI+path;const r=await fetchImpl(source,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`TWC ${r.status}: ${source}`);return {source,data:await r.json()};}
/** Read the same public report endpoints that weather.com/kalshi's own client uses. */
export async function settlementWeatherEvidence(contracts,{now=Date.now(),fetchImpl=fetch}={}){
 const utcDate=new Date(now).toISOString().slice(0,10);
 const yesterday=new Date(now-86400000).toISOString().slice(0,10);
 const dates=[...new Set([yesterday,...contracts.flatMap(c=>c.binding?.targetDate&&c.binding.targetDate<=utcDate?[c.binding.targetDate]:[])])];
 const daily={},international={},errors=[];
 await mapLimit(dates,2,async date=>{
  for(const [kind,target] of [['primary',daily],['international',international]]){
   try{target[date]=await get(`/api/climate/${kind}?date=${date}`,fetchImpl);}catch(e){errors.push({source:'TWC-'+kind,date,error:e.message});}
  }
 });
 return {retrievedAt:new Date().toISOString(),daily,international,errors};
}
export function sourceReport(c,e){
 const b=c.binding;if(!b||b.source!=='twc')return null;
 const raw=e?.daily?.[b.targetDate];
 const r=raw?.data?.results?.find(r=>r.station.icao===b.station);
 return r?{source:raw.source,status:r.status,data:r.data,station:r.station,date:b.targetDate}:null;
}
