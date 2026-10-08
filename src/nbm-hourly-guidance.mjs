/** NOAA hourly NBM guidance. Select station blocks before splitting a large bulletin. */
import {mkdir,readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {NBM_OPEN_DATA} from './nbm-station-guidance.mjs';
const HOUR=3600000;
export function hourlyBulletinUrl(runtime,base=NBM_OPEN_DATA){const d=new Date(runtime),day=d.toISOString().slice(0,10).replaceAll('-',''),hh=d.toISOString().slice(11,13);return `${base}/blend.${day}/${hh}/text/blend_nbhtx.t${hh}z`;}
export function parseNbhBulletin(text,stations){
 const wanted=stations?new Set(stations):null,out=new Map();
 const header=/^[^\S\n]*(\S+)[^\S\n]+NBM V[\d.]+ NBH GUIDANCE[^\S\n]+(\d\d)\/(\d\d)\/(\d{4})[^\S\n]+(\d\d)(\d\d) UTC[^\S\n]*$/gm;
 for(const m of text.matchAll(header)){
  const [,station,mm,dd,yyyy,hh,mi]=m;if(wanted&&!wanted.has(station))continue;
  const runtime=Date.UTC(+yyyy,+mm-1,+dd,+hh,+mi);if(+mi!==0||!Number.isFinite(runtime))continue;
  const start=m.index+m[0].length,boundary=/\n[^\S\n]*\n/g;boundary.lastIndex=start;const end=boundary.exec(text)?.index??text.length,block={};
  for(const line of text.slice(start,end<0?text.length:end).split('\n')){
   const label=line.slice(0,5).trim();if(!['UTC','TMP','TSD','P01'].includes(label))continue;
   block[label]=Array.from({length:25},(_,i)=>{const v=line.slice(5+3*i,8+3*i).trim();return v!==''&&/^-?\d+$/.test(v)?Number(v):null;});
  }
  if(!block.UTC||!block.TMP||block.UTC.some((v,i)=>v!==new Date(runtime+(i+1)*HOUR).getUTCHours()))continue;
  const value=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi?v:null;
  const rows=block.UTC.map((_,i)=>({ftime:new Date(runtime+(i+1)*HOUR).toISOString(),tmp:value(block.TMP[i],-150,180),tsd:value(block.TSD?.[i],0,100),p01:value(block.P01?.[i],0,100)}));
  if(!rows.some(r=>r.tmp!==null))continue;
  out.set(station,{station,runtime:new Date(runtime).toISOString(),rows});
 }
 return out;
}
export async function latestHourlyGuidance({stations,now=Date.now(),cacheDir,lookbackHours=3,keepRuns=6},{fetchImpl=fetch,baseUrl=NBM_OPEN_DATA}={}){
 await mkdir(cacheDir,{recursive:true});const hour=Math.floor(new Date(now).getTime()/HOUR)*HOUR;
 for(let back=0;back<=lookbackHours;back++){
  const runtime=new Date(hour-back*HOUR).toISOString(),cached=join(cacheDir,`nbh-${runtime.slice(0,13)}.json`);let prior;
  try{const d=JSON.parse(await readFile(cached,'utf8'));if(d.runtime===runtime)prior=d;if(prior&&stations.every(s=>prior.stations[s]||prior.missingStations?.includes(s)))return prior;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  const source=hourlyBulletinUrl(runtime,baseUrl),res=await fetchImpl(source,{signal:AbortSignal.timeout(30000)});if([403,404].includes(res.status))continue;if(!res.ok)throw new Error(`NBM NBH HTTP ${res.status}: ${source}`);
  const parsed=parseNbhBulletin(await res.text(),stations);if([...parsed.values()].some(s=>s.runtime!==runtime))throw new Error('NBH run/header mismatch');
  const members={...prior?.stations,...Object.fromEntries(parsed)},missingStations=[...new Set([...(prior?.missingStations??[]),...stations.filter(s=>!members[s])])].filter(s=>!members[s]);
  const doc={runtime,source,stations:members,missingStations},tmp=cached+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(doc));await rename(tmp,cached);
  const runs=(await readdir(cacheDir)).filter(n=>/^nbh-.*\.json$/.test(n)).sort();for(const stale of runs.slice(0,Math.max(0,runs.length-keepRuns)))await unlink(join(cacheDir,stale)).catch(()=>{});
  return doc;
 }
 throw new Error(`no NBH run in ${lookbackHours} hours before ${new Date(now).toISOString()}`);
}
