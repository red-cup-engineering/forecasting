#!/usr/bin/env node
/** Collect the inputs of the hourly city-index backtest into one cache directory.
 *
 * Usage: node hourly-index-backtest-data.mjs <cacheDir> <firstDay YYYY-MM-DD> <lastDay YYYY-MM-DD>
 *
 * Truth: Kalshi's published minute index per city (`live_data/weather/<city>`; from/to are
 * milliseconds) and the append-only calibrations. Forecasts: the NOAA NBM hourly (NBH) text
 * bulletin of every third cycle, reduced to the station blocks the four city indices use.
 * Every file is written once and never rewritten, so the backtest reads frozen bytes.
 */
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {hourlyBulletinUrl,parseNbhBulletin} from '../src/nbm-hourly-guidance.mjs';
const HOUR=3600000,DAY=24*HOUR,API='https://api.elections.kalshi.com/trade-api/v2/live_data/weather';
export const CITIES=['miami','nyc','chicago','la-coastal'];
export const CYCLE_HOURS=[0,3,6,9,12,15,18,21];
const exists=p=>access(p).then(()=>true,()=>false);
async function getJson(url){for(let i=0;i<4;i++){try{const r=await fetch(url,{signal:AbortSignal.timeout(120000)});if(r.ok)return await r.json();}catch{}await new Promise(r=>setTimeout(r,2000*2**i));}throw new Error('unreachable: '+url);}
export async function collect(cacheDir,firstDay,lastDay,{concurrency=4,log=console.error}={}){
 await mkdir(join(cacheDir,'nbh'),{recursive:true});
 const stations=new Set(),start=Date.parse(firstDay+'T00:00:00Z'),end=Date.parse(lastDay+'T00:00:00Z')+DAY;
 for(const city of CITIES){
  const cal=join(cacheDir,city+'.calibrations.json'),idx=join(cacheDir,city+'.index.json');
  if(!await exists(cal))await writeFile(cal,JSON.stringify(await getJson(`${API}/${city}/calibrations`)));
  if(!await exists(idx))await writeFile(idx,JSON.stringify(await getJson(`${API}/${city}?from=${start-DAY}&to=${end+DAY}`)));
  for(const c of JSON.parse(await readFile(cal,'utf8')).calibrations)for(const s of c.stations)stations.add(s.station_id.slice(0,4));
 }
 const jobs=[];for(let t=start;t<end;t+=DAY)for(const h of CYCLE_HOURS)jobs.push(t+h*HOUR);
 let next=0,done=0,missing=0;
 await Promise.all(Array.from({length:concurrency},async()=>{
  while(next<jobs.length){
   const runtime=jobs[next++],file=join(cacheDir,'nbh',new Date(runtime).toISOString().slice(0,13)+'.json');
   if(await exists(file)){done++;continue;}
   let text=null;
   for(let i=0;i<4&&text===null;i++){
    try{const r=await fetch(hourlyBulletinUrl(runtime),{signal:AbortSignal.timeout(120000)});if(r.status===404||r.status===403){text='';break;}if(r.ok)text=await r.text();}catch{}
    if(text===null)await new Promise(r=>setTimeout(r,2000*2**i));
   }
   if(text===null)throw new Error('NBH fetch failed '+new Date(runtime).toISOString());
   const parsed=text?parseNbhBulletin(text,[...stations]):new Map();
   if(!parsed.size)missing++;
   await writeFile(file,JSON.stringify({runtime:new Date(runtime).toISOString(),stations:Object.fromEntries(parsed)}));
   if(++done%25===0)log(`${done}/${jobs.length} cycles`);
  }
 }));
 log(`cycles ${jobs.length}, without guidance ${missing}`);
}
if(import.meta.url===`file://${process.argv[1]}`){
 const [dir,first,last]=process.argv.slice(2);if(!dir||!/^\d{4}-\d{2}-\d{2}$/.test(first??'')||!/^\d{4}-\d{2}-\d{2}$/.test(last??''))throw new Error('usage: <cacheDir> <firstDay> <lastDay>');
 await collect(dir,first,last);
}
