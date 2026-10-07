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
  try{const c=JSON.parse(await readFile(file,'utf8'));if(stations.every(s=>c.stations[s]||c.missingStations?.includes(s)))return c;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  const date=runtime.slice(0,10).replaceAll('-',''),hh=runtime.slice(11,13),source=`${BASE}/lmp.${date}/lmp.t${hh}30z.lavtxt.ascii`;
  let r;try{r=await fetchImpl(source,{signal:AbortSignal.timeout(20000)});}catch(e){if(back===lookbackHours)throw e;continue;}
  if([403,404].includes(r.status))continue;if(!r.ok)throw new Error(`LAMP ${r.status}: ${source}`);
  let parsed;try{parsed=parseLampBulletin(await r.text(),stations);}catch(e){if(back===lookbackHours)throw e;continue;}
  parsed=Object.fromEntries(Object.entries(parsed).filter(([,b])=>b.runtime===runtime&&b.rows.length===25));
  if(!Object.keys(parsed).length)continue;
  const extendedSource=source.replace('lavtxt.ascii','lavtxt_ext.ascii');let extendedAvailable=false;
  try{const ext=await fetchImpl(extendedSource,{signal:AbortSignal.timeout(20000)});if(ext.ok){const extra=parseLampBulletin(await ext.text(),stations,{extended:true});for(const [s,b] of Object.entries(extra))if(parsed[s]&&parsed[s].runtime===b.runtime&&b.rows.length===13){parsed[s].rows.push(...b.rows);extendedAvailable=true;}}}catch{}
  const record={runtime,source,extendedSource,extendedAvailable,stations:parsed,missingStations:stations.filter(s=>!parsed[s])};
  const tmp=file+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(record));await rename(tmp,file);
  const files=(await readdir(cacheDir)).filter(n=>n.startsWith('lamp-')&&n.endsWith('.json')).sort();for(const stale of files.slice(0,Math.max(0,files.length-6)))await unlink(join(cacheDir,stale)).catch(()=>{});
  return record;
 }
 throw new Error('no LAMP station bulletin in the previous three hours');
}
