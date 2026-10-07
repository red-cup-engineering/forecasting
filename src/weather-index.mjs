import {cell,address} from '@red-cup-engineering/signcell/cell';
/** Forecast and verify the published city index using its actual versioned configuration. */
import {studentTCdf} from './temperature-distribution.mjs';
export const INDEX_CITIES={
 miami:{timeZone:'America/New_York',version:'1.0',series:'KXTEMPMIAH',terms:'MIAWINDEX',members:4,weight:.8},
 chicago:{timeZone:'America/Chicago',version:'1.1',series:'KXTEMPCHIHS',terms:'CHIMETROWINDEX',members:4,weight:.8},
 nyc:{timeZone:'America/New_York',version:'1.0',series:'KXTEMPNYCHS',terms:'NYCWINDEX',members:6,weight:.75},
 'la-coastal':{timeZone:'America/Los_Angeles',version:'1.0',series:'KXTEMPLAXHS',terms:'LAWINDEX',members:4,weight:.8},
};
const HOUR=3600000,MINUTE=60000;
const months={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const offsets={EST:-5,EDT:-4,CST:-6,CDT:-5,PST:-8,PDT:-7};
export function weatherIndexBinding(m,series){
 const city=Object.keys(INDEX_CITIES).find(c=>INDEX_CITIES[c].series===series.ticker),info=INDEX_CITIES[city];
 if(!info||series.frequency!=='hourly'||series.contract_terms_url!==`https://assets.kalshi.com/contract_terms/${info.terms}.pdf`||!/Kalshi Weather Index Methodology/i.test(m.rules_secondary??''))return null;
 const match=/for (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4}) at (\d{1,2})(?::(\d{2}))? (AM|PM) (EST|EDT|CST|CDT|PST|PDT)\b/.exec(m.rules_primary??'');
 if(!match||!['less','greater','between'].includes(m.strike_type))return null;
 const [,mon,day,year,hour,minute='0',ampm,zone]=match;
 if(+hour<1||+hour>12||+minute>59)return null;
 const date=`${year}-${String(months[mon]+1).padStart(2,'0')}-${day.padStart(2,'0')}`;
 if(new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)return null;
 const target=Date.parse(date+'T00:00:00Z')+(+hour%12+(ampm==='PM'?12:0)-offsets[zone])*HOUR+(+minute)*MINUTE;
 if(!Number.isFinite(target)||Date.parse(m.close_time)>target+5*MINUTE)return null;
 return {kind:'index-at',city,station:'index:'+city,timeZone:info.timeZone,targetDate:date,targetTime:new Date(target).toISOString(),source:'kalshi-index',proxy:true,precisionF:.01,methodologyUrl:series.contract_terms_url,seriesRevision:series.last_updated_ts??null};
}
export function indexConfiguration(packet,city,eventTime,availableAt){
 if(!Object.hasOwn(INDEX_CITIES,city))return null;
 const rows=packet?.calibrations?.calibrations;
 if(packet?.calibrations?.city!==city||packet.calibrations.units!=='celsius'||!Array.isArray(rows))return null;
 const c=rows.filter(c=>Number.isFinite(c.effective_at_ms)&&c.effective_at_ms<=eventTime&&Number.isFinite(c.published_at_ms)&&c.published_at_ms<=availableAt).sort((a,b)=>b.effective_at_ms-a.effective_at_ms)[0];
 const prefix=city+'-temperature-v'+INDEX_CITIES[city].version,version=c?.config_version;
 if(!c||typeof version!=='string'||!(version===prefix||version.startsWith(prefix+'-cal-')&&/^[0-9]{8}$/.test(version.slice((prefix+'-cal-').length)))||!Number.isFinite(c.city_reference_c)||!Array.isArray(c.stations)||!c.stations.length)return null;
 if(c.stations.some(s=>!/^[A-Z0-9]{4}1M$/.test(s.station_id)||!Number.isFinite(s.weight)||s.weight<=0||!Number.isFinite(s.offset_c))||new Set(c.stations.map(s=>s.station_id)).size!==c.stations.length)return null;
 const total=c.stations.reduce((sum,s)=>sum+s.weight,0),reference=c.stations.reduce((sum,s)=>sum+s.weight*s.offset_c,0);
 return Math.abs(total-1)<1e-8&&Math.abs(reference-c.city_reference_c)<1e-8?c:null;
}
/** Receipt provenance is required: backfilled, pending, unknown, and late inputs never become truth. */
export function canonicalIndexPoints(packet,city,now){
 if(packet?.index?.city!==city||packet.index.units!=='fahrenheit')return [];
 return (packet.index.timeseries??[]).filter(p=>{
  if(!Number.isSafeInteger(p.t)||p.t%MINUTE!==0||!Number.isFinite(p.v)||p.v< -40||p.v>122||p.t+5*MINUTE>now||!['normal','degraded'].includes(p.status)||p.receipt_basis!==undefined&&p.receipt_basis!==null&&p.receipt_basis!=='local_receipt')return false;
  const c=indexConfiguration(packet,city,p.t,now),accepted=p.stations?.filter(s=>s.code==='ok');if(!c||!accepted?.length||accepted.length!==p.contributors)return false;
  if(accepted.some(s=>!Number.isFinite(s.received_at_ms)||s.received_at_ms>p.t+5*MINUTE||!Number.isFinite(s.temp_f)))return false;
  const weight=accepted.reduce((sum,s)=>sum+(c.stations.find(x=>x.station_id===s.station_id)?.weight??0),0),q=INDEX_CITIES[city];
  return new Set(accepted.map(s=>s.station_id)).size===accepted.length&&accepted.every(s=>c.stations.some(x=>x.station_id===s.station_id))&&accepted.length>=q.members&&weight+1e-9>=q.weight&&(p.status!=='normal'||accepted.length===c.stations.length);
 }).sort((a,b)=>a.t-b.t);
}
/** Reproduce arithmetic on already QC-accepted audit readings; this does not reimplement upstream QC. */
export function reproduceIndex(point,config){
 const accepted=point.stations.filter(s=>s.code==='ok');let weighted=0,total=0;
 for(const s of accepted){const c=config.stations.find(c=>c.station_id===s.station_id);if(!c)return null;weighted+=c.weight*((s.temp_f-32)*5/9-c.offset_c+config.city_reference_c);total+=c.weight;}
 if(!total)return null;return Math.round((weighted/total*9/5+32)*100)/100;
}
export async function collectWeatherIndexEvidence(cities,{now=Date.now(),fetchImpl=fetch}={}){
 const requested=[...new Set(cities)];if(!requested.length||requested.some(c=>!Object.hasOwn(INDEX_CITIES,c)))throw new TypeError('known weather-index city required');
 const packets={},errors=[];
 await Promise.all(requested.map(async city=>{
  const base=`https://api.elections.kalshi.com/trade-api/v2/live_data/weather/${city}`,query=new URLSearchParams({from:String(Math.floor(now-2*HOUR)),to:String(Math.floor(now)),detailed:'true'});
  const packet=packets[city]={calibrationSource:base+'/calibrations',indexSource:base+'?'+query};
  for(const [key,url] of [['calibrations',packet.calibrationSource],['index',packet.indexSource]]){
   try{const r=await fetchImpl(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`HTTP ${r.status}`);packet[key]=await r.json();}
   catch(e){errors.push({source:'Kalshi-weather-index',city,kind:key,error:e.message});}
  }
  packet.retrievedAt=new Date().toISOString();
  const current=packet.calibrations?.calibrations?.filter(c=>c.effective_at_ms<=now&&c.published_at_ms<=now).sort((a,b)=>b.effective_at_ms-a.effective_at_ms)[0];
  const expected=INDEX_CITIES[city].version,reported=/-temperature-v([0-9]+\.[0-9]+)/.exec(current?.config_version??'')?.[1]??null;
  const support=cell('index:'+city,'current-methodology-version',{version:expected},{for:[{source:`https://assets.kalshi.com/contract_terms/${INDEX_CITIES[city].terms}.pdf`,version:expected}],against:reported&&reported!==expected?[{source:packet.calibrationSource,version:reported,configVersion:current.config_version}]:[]});
  packet.validation={expectedVersion:expected,reportedVersion:reported,configVersion:current?.config_version??null,compatible:Boolean(indexConfiguration(packet,city,now,now)),conflicted:Boolean(support.for.length&&support.against.length),address:address(support),cell:support};
  if(!packet.validation.compatible)packet.blocker=reported&&reported!==expected?`contract configuration v${expected} conflicts with published configuration v${reported}`:'no usable published index configuration';
 }));
 return {cities:packets,errors};
}
function curve(e,station,provider,now){
 let rows=[],issued,age,source;
 if(provider==='lamp'){issued=e.lamp?.runtime;age=3;source=e.lamp?.source;rows=(e.lamp?.stations[station]?.rows??[]).map(r=>({t:Date.parse(r.validTime),mean:r.temperatureF,scale:2.5}));}
 if(provider==='nbh'){issued=e.hourlyGuidance?.runtime;age=3;source=e.hourlyGuidance?.source;rows=(e.hourlyGuidance?.stations[station]?.rows??[]).map(r=>({t:Date.parse(r.ftime),mean:r.tmp,scale:Number.isFinite(r.tsd)?Math.max(1,r.tsd*Math.sqrt(3/5)):2.5}));}
 if(provider==='nbm'){issued=e.guidance?.runtime;age=8;source=e.guidance?.source;rows=(e.guidance?.stations[station]?.rows??[]).map(r=>({t:Date.parse(r.ftime),mean:r.tmp,scale:Number.isFinite(r.tsd)?Math.max(1,r.tsd*Math.sqrt(3/5)):2.5}));}
 if(provider==='nws'){const l=e.local?.[station];issued=l?.updated;age=8;source=l?.hourlyUrl;rows=(l?.periods??[]).filter(r=>['F','C'].includes(r.temperatureUnit)).map(r=>({t:Date.parse(r.startTime),mean:r.temperatureUnit==='C'?r.temperature*9/5+32:r.temperature,scale:2.5}));}
 if(!Number.isFinite(Date.parse(issued))||now<Date.parse(issued)||now-Date.parse(issued)>age*HOUR)return null;
 rows=rows.filter(r=>Number.isFinite(r.t)&&Number.isFinite(r.mean)&&r.mean>=-150&&r.mean<=180&&Number.isFinite(r.scale)&&r.scale>0).sort((a,b)=>a.t-b.t);return rows.length?{rows,source,issued}:null;
}
function interpolate(rows,t,allowBackfill=false){
 const exact=rows.find(r=>r.t===t);if(exact)return {...exact,backfilled:false};
 if(allowBackfill&&t<rows[0].t&&rows[0].t-t<=HOUR)return {...rows[0],backfilled:true};
 for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(a.t<t&&t<b.t&&b.t-a.t<=3*HOUR){const fraction=(t-a.t)/(b.t-a.t);return {mean:a.mean+(b.mean-a.mean)*fraction,scale:Math.max(a.scale,b.scale),backfilled:false};}}
 return null;
}
export function indexDistributions(city,e,target,now){
 const packet=e.indices?.[city],c=indexConfiguration(packet,city,target,now);if(!c||target<=now||target-now>24*HOUR)return [];
 const anchor=canonicalIndexPoints(packet,city,now).filter(p=>now-p.t<=20*MINUTE).at(-1),out=[];
 for(const provider of ['lamp','nbh','nbm','nws']){
  const inputs=c.stations.map(s=>({config:s,curve:curve(e,s.station_id.slice(0,4),provider,now)}));if(inputs.some(r=>!r.curve))continue;
  const values=inputs.map(r=>interpolate(r.curve.rows,target));if(values.some(r=>!r))continue;
  const mean=values.reduce((sum,r,i)=>sum+c.stations[i].weight*(r.mean+1.8*(c.city_reference_c-c.stations[i].offset_c)),0);
  const scale=values.reduce((sum,r,i)=>sum+c.stations[i].weight*r.scale,0),model=`kalshi-index-${provider}-proxy-v1`;
  const details={mean,scale,nu:5,configVersion:c.config_version,configSource:packet.calibrationSource,targetTime:new Date(target).toISOString(),stationForecasts:inputs.map((r,i)=>({station:r.config.station_id,weight:r.config.weight,offsetC:r.config.offset_c,meanF:values[i].mean,scaleF:values[i].scale,source:r.curve.source,issuedAt:r.curve.issued})),uncertainty:'experimental common Student-t shock across stations; no independence-based spread reduction; airport forecasts proxy 1-minute sensors'};
  out.push({model,meanF:mean,scaleF:scale,nu:5,details,source:packet.calibrationSource});
  if(anchor){
   const reference=inputs.map(r=>interpolate(r.curve.rows,anchor.t,true));if(reference.some(r=>!r))continue;
   const base=reference.reduce((sum,r,i)=>sum+c.stations[i].weight*(r.mean+1.8*(c.city_reference_c-c.stations[i].offset_c)),0),innovation=anchor.v-base,decay=Math.exp(-(target-anchor.t)/(3*HOUR));
   const shifted=mean+innovation*decay;
   out.push({model:model+'/recent-innovation-v1',meanF:shifted,scaleF:scale,nu:5,source:packet.indexSource,details:{...details,mean:shifted,baseMeanF:mean,anchorValueF:anchor.v,anchorTime:new Date(anchor.t).toISOString(),anchorStatus:anchor.status,anchorSource:packet.indexSource,anchorBackfilledForecast:reference.some(r=>r.backfilled),innovationF:innovation,innovationWeight:decay,status:'forward experiment; three-hour decay is uncalibrated; spread retained'}});
  }
 }
 return out;
}
/** Published 0.01F rounding, preserving strict greater/less comparisons. Daily integer rounding is distinct. */
export function indexBracketProbability(m,{meanF,scaleF,nu=5}){
 const cdf=x=>studentTCdf((x-meanF)/scaleF,nu),cent=v=>Math.round(v*100);
 if(m.strike_type==='greater'&&Number.isFinite(m.floor_strike))return 1-cdf((cent(m.floor_strike)+.5)/100);
 if(m.strike_type==='less'&&Number.isFinite(m.cap_strike))return cdf((cent(m.cap_strike)-.5)/100);
 if(m.strike_type==='between'&&Number.isFinite(m.floor_strike)&&Number.isFinite(m.cap_strike)&&m.floor_strike<=m.cap_strike)return cdf((cent(m.cap_strike)+.5)/100)-cdf((cent(m.floor_strike)-.5)/100);
 return null;
}
export function priceWeatherIndex(c,e,now){
 const b=c.binding;if(b?.kind!=='index-at')return [];
 const target=Date.parse(b.targetTime),h=(target-now)/HOUR,horizon=h<=3?'0-3h':h<=6?'3-6h':h<=12?'6-12h':'12-24h';
 const distributions=indexDistributions(b.city,e,target,now).flatMap(r=>{
  const p=e.science?.parameters?.[`${b.station}/${r.model}/${horizon}`];
  return p?.ready?[r,{...r,model:r.model+'/station-postprocess-v1',meanF:r.meanF+p.biasF,scaleF:r.scaleF*p.scaleMultiplier,details:{...r.details,mean:r.meanF+p.biasF,scale:r.scaleF*p.scaleMultiplier,postprocessing:{...p,baseModel:r.model}}}]:[r];
 });
 return distributions.flatMap(r=>{const p=indexBracketProbability(c,r);return Number.isFinite(p)?[{id:r.model,p,details:r.details}]:[];});
}
