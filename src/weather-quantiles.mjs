import {mkdir,readFile,writeFile,readdir,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {NBM_OPEN_DATA} from './nbm-station-guidance.mjs';
import {bracketBounds,studentTCdf} from './temperature-distribution.mjs';
const header=/^\s*(\S+)\s+NBM V([\d.]+) NBP GUIDANCE\s+(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d)(\d\d) UTC/u;
const labels=['FHR','TXNMN','TXNSD','TXNP1','TXNP2','TXNP5','TXNP7','TXNP9','Q24P1','Q24P2','Q24P5','Q24P7','Q24P9','S24P1','S24P2','S24P5','S24P7','S24P9'];
function columns(line){
 const cells=[];
 for(const [i,day] of line.slice(6).split('|').entries()){
  const split=i===0?4:3;
  for(const raw of [day.slice(0,split),day.slice(split,split+4)]){
   const t=raw.trim();cells.push(t===''?null:Number(t));
  }
 }
 return cells;
}
export function parseNbpBulletin(text,stations){
 const wanted=new Set(stations),out={};const lines=text.split('\n');
 for(let i=0;i<lines.length;i++){
  const m=header.exec(lines[i]);if(!m||!wanted.has(m[1]))continue;
  const [,station,version,mm,dd,yyyy,hh,mi]=m;const runtime=Date.UTC(+yyyy,+mm-1,+dd,+hh,+mi);const block={};
  for(let j=i+1;j<lines.length&&!header.test(lines[j])&&lines[j].trim()!=='';j++){
   const label=lines[j].slice(0,6).trim();if(labels.includes(label))block[label]=columns(lines[j]);
  }
  const rows=(block.FHR??[]).filter(Number.isFinite).map((h,index)=>({ftime:new Date(runtime+h*3600000).toISOString(),mean:block.TXNMN?.[index]??null,spread:block.TXNSD?.[index]??null,temperature:[block.TXNP1?.[index],block.TXNP2?.[index],block.TXNP5?.[index],block.TXNP7?.[index],block.TXNP9?.[index]].map(x=>Number.isFinite(x)&&Math.abs(x)<999?x:null),rainHundredths:[block.Q24P1?.[index],block.Q24P2?.[index],block.Q24P5?.[index],block.Q24P7?.[index],block.Q24P9?.[index]].map(x=>x??null),snowTenths:[block.S24P1?.[index],block.S24P2?.[index],block.S24P5?.[index],block.S24P7?.[index],block.S24P9?.[index]].map(x=>x??null)}));
  out[station]={station,version,runtime:new Date(runtime).toISOString(),rows};
 }
 return out;
}
export async function latestStationQuantiles({stations,cacheDir,now=Date.now(),fetchImpl=fetch}){
 await mkdir(cacheDir,{recursive:true});const hour=Math.floor(now/3600000)*3600000;
 for(let back=0;back<=24;back++){
  const run=new Date(hour-back*3600000);const h=run.getUTCHours();if(![0,1,7,12,13,19].includes(h))continue;
  const runtime=run.toISOString(),cached=join(cacheDir,`nbp-${runtime.slice(0,13)}.json`);
  try{const c=JSON.parse(await readFile(cached,'utf8'));if(stations.every(s=>c.stations[s]))return c;}catch(e){if(e.code!=='ENOENT'&&!(e instanceof SyntaxError))throw e;}
  const hh=String(h).padStart(2,'0'),date=runtime.slice(0,10).replaceAll('-','');
  const source=`${NBM_OPEN_DATA}/blend.${date}/${hh}/text/blend_nbptx.t${hh}z`;
  const r=await fetchImpl(source,{signal:AbortSignal.timeout(45000)});if([403,404].includes(r.status))continue;if(!r.ok)throw new Error(`NBP ${r.status}: ${source}`);
  const record={runtime,source,stations:parseNbpBulletin(await r.text(),stations)};if(!Object.keys(record.stations).length)continue;
  await writeFile(cached,JSON.stringify(record));
  const files=(await readdir(cacheDir)).filter(n=>n.startsWith('nbp-')).sort();for(const stale of files.slice(0,Math.max(0,files.length-6)))await unlink(join(cacheDir,stale)).catch(()=>{});
  return record;
 }
 throw new Error('no probabilistic NBM station bulletin in the previous 24 hours');
}
/** Interpolate published quantiles; heavy outer tails are an explicit, unvalidated extrapolation. */
export function quantileCdf(x,q){
 if(q.length!==5||q.some(v=>!Number.isFinite(v))||q.some((v,i)=>i>0&&v<q[i-1]))throw new TypeError('five monotone temperature quantiles required');
 const probs=[.1,.25,.5,.75,.9];
 if(x===-Infinity)return 0;if(x===Infinity)return 1;
 if(x<q[0])return .2*studentTCdf((x-q[0])/Math.max(1,(q[2]-q[0])/1.28155),4);
 if(x>=q[4])return 1-.2*studentTCdf((q[4]-x)/Math.max(1,(q[4]-q[2])/1.28155),4);
 // Spread integer-valued quantiles by a half degree at ties to retain CDF continuity.
 const knots=q.map((v,i)=>v+(i-2)*.01);
 for(let i=1;i<5;i++)if(x<knots[i])return probs[i-1]+(probs[i]-probs[i-1])*Math.max(0,Math.min(1,(x-knots[i-1])/(knots[i]-knots[i-1])));
 return .9;
}
export function priceStationQuantiles(c,quantiles,now){
 const b=c.binding;if(!b||!['high','low'].includes(b.kind)||!quantiles||now-Date.parse(quantiles.runtime)>18*3600000||now<Date.parse(quantiles.runtime))return null;
 const target=Date.parse(b.targetDate+'T00:00:00Z')+(b.kind==='high'?24:12)*3600000;
 const row=quantiles.stations[b.station]?.rows.find(r=>Date.parse(r.ftime)===target);
 if(!row||row.temperature.some(v=>v===null))return null;
 const [lo,hi]=bracketBounds({strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike});
 try{return {id:`nbm-qmd-${b.kind}-v5-v1`,p:Math.max(0,Math.min(1,quantileCdf(hi,row.temperature)-quantileCdf(lo,row.temperature))),details:{source:quantiles.source,runtime:quantiles.runtime,ftime:row.ftime,quantiles:row.temperature,percentiles:[10,25,50,75,90],outerTails:'Student-t extrapolation, nu=4, not a published tail probability',proxy:b.proxy}};}catch{return null;}
}
