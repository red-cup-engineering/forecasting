import {mapLimit,digest} from './weather-universe.mjs';
export const TWC_KALSHI='https://weather.com/kalshi';
async function get(path,fetchImpl){const source=TWC_KALSHI+path;const r=await fetchImpl(source,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`TWC ${r.status}: ${source}`);const data=await r.json();return {source,receivedAt:new Date().toISOString(),evidenceDigest:digest(data),data};}
/** Read the same public report endpoints that weather.com/kalshi's own client uses. */
export async function climateReportEvidence({dates:requestedDates=[],now=Date.now(),fetchImpl=fetch}={}){
 const utcDate=new Date(now).toISOString().slice(0,10);
 const yesterday=new Date(now-86400000).toISOString().slice(0,10);
 const dates=[...new Set([yesterday,...requestedDates.filter(date=>date<=utcDate)])];
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
 const results=Array.isArray(raw?.data?.results)?raw.data.results:[];
 const rows=results.filter(r=>r?.station?.icao===b.station);
 if(!rows.length)return null;
 // Older archives only have the cycle completion receipt. That is a safe
 // later availability bound, never permission to backdate publication.
 const receivedAt=raw.receivedAt??e.retrievedAt??null;
 const base={source:raw.source,receivedAt,evidenceDigest:raw.evidenceDigest??null,date:b.targetDate};
 if(rows.length!==1)return {...base,status:'ambiguous-station-reports',
   candidateCount:rows.length,candidates:rows.map(r=>({status:r.status,
     data:r.data,station:r.station})),conflicted:true};
 const r=rows[0];
 return {...base,status:r.status,data:r.data,station:r.station,conflicted:false};
}

export function settlementWeatherEvidence(contracts,options={}){
 return climateReportEvidence({...options,dates:contracts.flatMap(c=>c.binding?.targetDate?[c.binding.targetDate]:[])});
}
