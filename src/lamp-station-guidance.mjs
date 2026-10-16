/** NOAA's observation-updated, station-based LAMP v2.7 guidance, including HRRR/GFS input. */
import {mkdir,readFile,writeFile,readdir,unlink,rename} from 'node:fs/promises';
import {join} from 'node:path';
const BASE='https://nomads.ncep.noaa.gov/pub/data/nccf/com/lmp/prod';
const header=/^\s*([A-Z0-9]{4})\s+GFS LAMP GUIDANCE\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})(\d{2}) UTC/;
const fields={TMP:'temperatureF',DPT:'dewpointF',WDR:'windDirectionTens',WSP:'windKnots',WGS:'gustKnots',PPO:'precipOccurrencePct',P01:'measurablePrecipHourPct',P06:'measurablePrecip6hPct',LP1:'lightningHourPct',CP1:'convectionHourPct'};
function cells(line){const out=[];for(let i=5;i<line.trimEnd().length;i+=3){const value=line.slice(i,i+3).trim();out.push(value!==''&&/^[-+]?\d+$/.test(value)?Number(value):null);}return out;}
export function parseLampBulletin(text,stations,{extended=false}={}) {
 const wanted=stations?new Set(stations):null,out={};const lines=text.split('\n');
 for(let i=0;i<lines.length;i++){
  const m=header.exec(lines[i]);if(!m||wanted&&!wanted.has(m[1]))continue;
  const [,station,mm,dd,yyyy,hh,mi]=m,runtime=Date.UTC(+yyyy,+mm-1,+dd,+hh,+mi),block={};
  for(let j=i+1;j<lines.length&&!header.test(lines[j])&&lines[j].trim()!=='';j++){
   const field=lines[j].slice(0,5).trim();if(field==='UTC'||field==='HR'||fields[field])block[field]=cells(lines[j]);
  }
  const rows=(block.UTC??[]).map((utc,index)=>{
   const hour=block.HR?.[index]??index+(extended?26:1),validTime=Math.floor(runtime/3600000)*3600000+hour*3600000;
   if(!Number.isFinite(utc)||new Date(validTime).getUTCHours()!==utc)return null;
   const row={validTime:new Date(validTime).toISOString(),leadHours:(validTime-runtime)/3600000};
   for(const [label,name] of Object.entries(fields)){const value=block[label]?.[index];row[name]=Number.isFinite(value)&&Math.abs(value)!==999&&!(label==='WDR'&&value===99)?value:null;}
   return row;
  }).filter(Boolean);
  if(rows.length)out[station]={station,runtime:new Date(runtime).toISOString(),rows};
 }
 return out;
}
export async function latestLampGuidance({stations,cacheDir,now=Date.now(),fetchImpl=fetch,lookbackHours=3}) {
 await mkdir(cacheDir,{recursive:true});const nominal=Math.floor(now/3600000)*3600000+30*60000;
 for(let back=nominal>now?1:0;back<=lookbackHours;back++){
  const run=new Date(nominal-back*3600000),runtime=run.toISOString(),file=join(cacheDir,`lamp-${runtime.slice(0,16).replaceAll(':','')}.json`);
  let prior;
  try{const c=JSON.parse(await readFile(file,'utf8'));if(c.runtime===runtime)prior=c;if(c.runtime===runtime&&stations.every(s=>c.stations[s]||c.missingStations?.includes(s)))return {...c,missingStations:stations.filter(s=>!c.stations[s])};}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  const date=runtime.slice(0,10).replaceAll('-',''),hh=runtime.slice(11,13),source=`${BASE}/lmp.${date}/lmp.t${hh}30z.lavtxt.ascii`;
  let r;try{r=await fetchImpl(source,{signal:AbortSignal.timeout(20000)});}catch(e){if(back===lookbackHours)throw e;continue;}
  if([403,404].includes(r.status))continue;if(!r.ok)throw new Error(`LAMP ${r.status}: ${source}`);
  let parsed;try{parsed=parseLampBulletin(await r.text(),stations);}catch(e){if(back===lookbackHours)throw e;continue;}
  parsed=Object.fromEntries(Object.entries(parsed).filter(([,b])=>b.runtime===runtime&&b.rows.length===25));
  if(!Object.keys(parsed).length)continue;
  const extendedSource=source.replace('lavtxt.ascii','lavtxt_ext.ascii');let extendedAvailable=false;
  try{const ext=await fetchImpl(extendedSource,{signal:AbortSignal.timeout(20000)});if(ext.ok){const extra=parseLampBulletin(await ext.text(),stations,{extended:true});for(const [s,b] of Object.entries(extra))if(parsed[s]&&parsed[s].runtime===b.runtime&&b.rows.length===13){parsed[s].rows.push(...b.rows);extendedAvailable=true;}}}catch{}
  const record={runtime,source,extendedSource,extendedAvailable,stations:{...prior?.stations,...parsed},missingStations:[...new Set([...(prior?.missingStations??[]),...stations.filter(s=>!parsed[s])])].filter(s=>!parsed[s]&&!prior?.stations?.[s])};
  const tmp=file+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(record));await rename(tmp,file);
  const files=(await readdir(cacheDir)).filter(n=>n.startsWith('lamp-')&&n.endsWith('.json')).sort();for(const stale of files.slice(0,Math.max(0,files.length-6)))await unlink(join(cacheDir,stale)).catch(()=>{});
  return {...record,missingStations:stations.filter(s=>!record.stations[s])};
 }
 throw new Error('no LAMP station bulletin in the previous three hours');
}
/**
 * A station's forecast temperature change (C) between two instants, from the latest bulletin published by the first,
 * linear between the bulletin's hourly values (and back along its first hour to the bulletin's own runtime). A
 * bulletin ({runtime, stations: {ICAO: {rows: [{validTime, temperatureF}]}}}, the shape latestLampGuidance returns)
 * is usable from its runtime plus `latencyMs`; NOMADS posts the HH30 bulletin at about HH36.
 * @returns {(station: string, from: number, to: number) => number|null}
 */
export function lampTemperatureChange(bulletins,{latencyMs=10*60000}={}){
 const runs=bulletins.map(b=>({usable:Date.parse(b.runtime)+latencyMs,stations:b.stations})).filter(b=>Number.isFinite(b.usable)).sort((a,b)=>a.usable-b.usable);
 const curves=new WeakMap();
 const curveOf=(run,station)=>{
  let byStation=curves.get(run);if(!byStation)curves.set(run,byStation=new Map());
  if(!byStation.has(station)){const rows=(run.stations[station]?.rows??[]).map(r=>({t:Date.parse(r.validTime),f:r.temperatureF})).filter(r=>Number.isFinite(r.t)&&Number.isFinite(r.f)).sort((a,b)=>a.t-b.t);byStation.set(station,rows.length>=2?rows:null);}
  return byStation.get(station);
 };
 const at=(rows,t)=>{
  if(t>rows.at(-1).t)return null;
  let i=1;while(i<rows.length-1&&rows[i].t<t)i+=1;
  const a=rows[i-1],b=rows[i];return a.f+(b.f-a.f)*(t-a.t)/(b.t-a.t);
 };
 return (station,from,to)=>{
  let lo=0,hi=runs.length-1,found=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(runs[mid].usable<=from){found=mid;lo=mid+1;}else hi=mid-1;}
  for(let i=found;i>=0&&i>found-3;i-=1){
   const rows=curveOf(runs[i],station);if(!rows||from<rows[0].t-3600000)continue;
   const a=at(rows,from),b=at(rows,to);if(a!==null&&b!==null)return (b-a)/1.8;
  }
  return null;
 };
}
