#!/usr/bin/env node
/** Derive how far each Kalshi city temperature index has moved over each horizon.
 *
 * Usage: node hourly-index-rate-envelope.mjs <cacheDir> <firstDay YYYY-MM-DD> <lastDay YYYY-MM-DD> [out.json]
 *
 * Source: Kalshi's published minute index per city (`live_data/weather/<city>`, from/to in
 * milliseconds), one original response per city and UTC day, cached once and never rewritten.
 * For every horizon h and every pair of published minutes (t, t+h) with both readings
 * `status: normal`, the move is v(t+h) - v(t). The envelope records, per city and horizon, the
 * largest rise and the largest fall ever observed, the 99.9th percentile of each, and how many
 * pairs were seen. A strike farther from the latest reading than the envelope allows cannot be
 * reached in the time left unless the index moves further than it has in the whole window.
 */
import {mkdir,readFile,writeFile,access} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {INDEX_CITIES} from '../src/weather-index.mjs';

const MINUTE=60000,DAY=86400000,API='https://api.elections.kalshi.com/trade-api/v2/live_data/weather';
export const HORIZONS=Object.freeze([1,2,3,5,10,15,20,30,45,60,90,120,180]);
const exists=p=>access(p).then(()=>true,()=>false);

async function original(url){
 for(let i=0;i<5;i++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(120000)});if(r.ok)return Buffer.from(await r.arrayBuffer());}catch{}
  await new Promise(resolve=>setTimeout(resolve,2000*2**i));
 }
 throw new Error('Kalshi index unavailable: '+url);
}

/** One city's normal minute readings over [start, end), from cached original day responses. */
export async function cityMinutes(cacheDir,city,start,end){
 const minutes=new Map(),sources=[];
 for(let day=start;day<end;day+=DAY){
  const url=`${API}/${city}?from=${day}&to=${day+DAY}`,file=join(cacheDir,`${city}.${new Date(day).toISOString().slice(0,10)}.json`);
  if(!await exists(file))await writeFile(file,await original(url),{flag:'wx'});
  const bytes=await readFile(file),body=JSON.parse(bytes);
  if(body.city!==city||!Array.isArray(body.timeseries))throw new TypeError('original Kalshi city index response required: '+file);
  sources.push({url,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,configVersion:body.config_version});
  for(const row of body.timeseries){
   if(row?.status!=='normal'||!Number.isSafeInteger(row.t)||row.t%MINUTE!==0||!Number.isFinite(row.v))continue;
   if(row.t>=day&&row.t<day+DAY)minutes.set(row.t,row.v);
  }
 }
 return {minutes,sources};
}

const quantile=(sorted,q)=>sorted.length?sorted[Math.min(sorted.length-1,Math.floor(q*sorted.length))]:null;
const hundredths=x=>Math.round(x*100)/100;

/** The largest observed rise and fall over each horizon, from minute readings keyed by epoch ms. */
export function rateEnvelope(minutes,horizons=HORIZONS){
 const out={};
 for(const h of horizons){
  const rises=[],falls=[];
  for(const [t,v] of minutes){const later=minutes.get(t+h*MINUTE);if(later===undefined)continue;const d=later-v;(d>=0?rises:falls).push(Math.abs(d));}
  rises.sort((a,b)=>a-b);falls.sort((a,b)=>a-b);
  out[h]={pairs:rises.length+falls.length,maxRiseF:hundredths(rises.at(-1)??0),maxFallF:hundredths(falls.at(-1)??0),
   p999RiseF:hundredths(quantile(rises,0.999)??0),p999FallF:hundredths(quantile(falls,0.999)??0)};
 }
 return out;
}

export async function deriveEnvelope(cacheDir,firstDay,lastDay){
 await mkdir(cacheDir,{recursive:true});
 const start=Date.parse(firstDay+'T00:00:00Z'),end=Date.parse(lastDay+'T00:00:00Z')+DAY,cities={};
 for(const city of Object.keys(INDEX_CITIES)){
  const {minutes,sources}=await cityMinutes(cacheDir,city,start,end);
  cities[city]={minutes:minutes.size,horizons:rateEnvelope(minutes),sources};
 }
 return {kind:'kalshi-city-index-rate-envelope',version:1,window:{firstDay,lastDay},horizonsMinutes:HORIZONS,cities,derivedAt:new Date().toISOString()};
}

if(import.meta.url===`file://${process.argv[1]}`){
 const [dir,first,last,out]=process.argv.slice(2);
 if(!dir||!/^\d{4}-\d{2}-\d{2}$/.test(first??'')||!/^\d{4}-\d{2}-\d{2}$/.test(last??''))throw new Error('usage: <cacheDir> <firstDay> <lastDay> [out.json]');
 const envelope=await deriveEnvelope(dir,first,last),text=JSON.stringify(envelope,null,1)+'\n';
 if(out)await writeFile(out,text,{flag:'wx'});else process.stdout.write(text);
}
