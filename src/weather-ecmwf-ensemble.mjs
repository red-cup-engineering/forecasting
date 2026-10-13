import {readNwsJson} from './nws-source.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {NWS_API,NWS_USER_AGENT} from './station-observations.mjs';
const execute=promisify(execFile);
/** Preserve actual member/site/time scenarios and their immutable field receipt clocks. */
export async function collectEcmwfEnsemble(stations,{cacheDir,validCount=1,now=Date.now(),fetchImpl=fetch,stationMetadata,python=process.env.WEATHER_ECCODES_PYTHON??join(homedir(),'.local/share/561-group/weather-research/eccodes/bin/python')}={}){
 if(!Array.isArray(stations)||!stations.length||stations.length>64||new Set(stations.map(s=>s.station)).size!==stations.length||!Number.isInteger(validCount)||validCount<1||validCount>4||!cacheDir)throw new TypeError('1..64 distinct station requests, persistent cacheDir and 1..4 six-hour target slots required');
 const metadata=[];
 for(const s of stations){if(!/^[A-Z0-9]{4}$/.test(s.station)||typeof s.timeZone!=='string')throw new TypeError('station ICAO and time zone required');new Intl.DateTimeFormat('en',{timeZone:s.timeZone});
  const saved=stationMetadata?.[s.station];if(saved){const [lon,lat]=saved.source?.raw?.geometry?.coordinates??[];if(saved.source.url!==`${NWS_API}/stations/${s.station}`||lon!==saved.longitude||lat!==saved.latitude||!Number.isFinite(lat)||Math.abs(lat)>89.75||!Number.isFinite(lon)||Math.abs(lon)>180)throw new TypeError('retained NWS station geometry mismatch');metadata.push({...s,...saved});continue;}
  const url=`${NWS_API}/stations/${s.station}`,raw=await readNwsJson(url,{fetchImpl,headers:{'User-Agent':NWS_USER_AGENT,Accept:'application/geo+json'},timeoutMs:10000});
  const [longitude,latitude]=raw.geometry?.coordinates??[];if(!Number.isFinite(latitude)||Math.abs(latitude)>89.75||!Number.isFinite(longitude)||Math.abs(longitude)>180)throw new TypeError('verified nonpolar station point geometry required');
  metadata.push({...s,latitude,longitude,source:{url,availableAt:new Date().toISOString(),raw}});
 }
 const child=execute(python,[fileURLToPath(new URL('./weather-ecmwf-decode.py',import.meta.url))],{timeout:240000,maxBuffer:16*1024*1024,env:{...process.env,OMP_NUM_THREADS:'1',OPENBLAS_NUM_THREADS:'1'}});child.child.stdin.end(JSON.stringify({stations:metadata,cacheDir,validCount,now:new Date(now).toISOString()}));
 const {stdout}=await child.catch(e=>{throw new Error('ECMWF ensemble collection: '+(e.stderr?.trim()||e.code||e.signal||'decoder failed'));}),packet=JSON.parse(stdout);packet.stationMetadata=metadata;packet.fieldsAvailableAt=packet.availableAt;packet.availableAt=[packet.availableAt,packet.collectedAt,...metadata.map(r=>r.source.availableAt)].sort().at(-1);return packet;
}
/** The empirical law is the 51-member marginal of the retained joint scenarios. */
export function ecmwfStationDistributions(packet,station,{now=Date.now()}={}){
 if(!packet||Date.parse(packet.availableAt)>now||now-Date.parse(packet.runtime)>12*3600000||Date.parse(packet.runtime)>now)return [];
 return (packet.stations?.[station]?.rows??[]).flatMap(r=>{
  if(Date.parse(r.validTime)-now<5*60000||r.members.length!==51||r.members.some((m,i)=>m.member!==i||!Number.isFinite(m.temperatureF)))return [];
  const pointsF=r.members.map(m=>m.temperatureF),meanF=pointsF.reduce((s,x)=>s+x,0)/51,variance=pointsF.reduce((s,x)=>s+(x-meanF)**2,0)/51;
  return [{model:'ecmwf-aifs-ens-v2-bilinear-v1',family:'ecmwf-aifs',validTime:r.validTime,meanF,scaleF:Math.max(.001,Math.sqrt(variance*3/5)),nu:5,empirical:{kind:'joint-ensemble-marginal-v1',pointsF,members:r.members.map(m=>m.member)},issuedAt:packet.runtime,source:packet.sourceUrl,sourceAvailableAt:packet.availableAt,memberFieldSha256:r.members.map(m=>m.fieldSha256),truth:'NWS station observations',tradeEligible:false,uncertainty:packet.projection}];
 });
}
