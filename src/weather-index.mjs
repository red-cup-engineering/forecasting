import {ecmwfStationDistributions} from './weather-ecmwf-ensemble.mjs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cell,address} from '@red-cup-engineering/signcell/cell';
/** Forecast and verify the published city index using its actual versioned configuration. */
import {makeTemperaturePool,postprocessTemperature,temperatureCdf} from './weather-ensemble.mjs';
export const INDEX_CITIES={
 miami:{timeZone:'America/New_York',version:'1.0',series:'KXTEMPMIAH',terms:'MIAWINDEX'},
 chicago:{timeZone:'America/Chicago',version:'1.1',series:'KXTEMPCHIHS',terms:'CHIMETROWINDEX'},
 nyc:{timeZone:'America/New_York',version:'1.0',series:'KXTEMPNYCHS',terms:'NYCWINDEX'},
 'la-coastal':{timeZone:'America/Los_Angeles',version:'1.0',series:'KXTEMPLAXHS',terms:'LAWINDEX'},
};
const HOUR=3600000,MINUTE=60000,execute=promisify(execFile);
/** Certified document, rather than a manually maintained quorum copy, defines eligibility. */
export function parseIndexMethodology(text,city){
 const normalized=text.replace(/\s+/gu,' '),version=new RegExp(`${city}-temperature-v([0-9]+\\.[0-9]+)`).exec(normalized)?.[1];
 const q=/I\. Quorum\..*?\|A\(t\)\|\s*≥\s*(\d+)\s*members.*?w_i\s*≥\s*([0-9]+(?:\.[0-9]+)?)/u.exec(normalized);
 if(!version||!q||!normalized.includes('nearest 0.01°F')||+q[1]<1||+q[2]<=0||+q[2]>1)throw new TypeError('certified index version, quorum and 0.01F precision required');
 return {configurationVersion:version,quorum:{members:+q[1],weight:+q[2]},precisionF:.01,roundingTieRule:'not specified in certified text'};
}
async function indexMethodology(city,fetchImpl){
 const url=`https://assets.kalshi.com/contract_terms/${INDEX_CITIES[city].terms}.pdf`,r=await fetchImpl(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`certified methodology HTTP ${r.status}`);
 const bytes=Buffer.from(await r.arrayBuffer());if(bytes.length>2*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('bounded certified PDF required');
 const availableAt=new Date().toISOString(),job=execute('pdftotext',['-layout','-','-'],{timeout:10000,maxBuffer:512*1024});job.child.stdin.end(bytes);const {stdout}=await job;
 return {url,availableAt,decodedAt:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,rawPdfBase64:bytes.toString('base64'),rawText:stdout,...parseIndexMethodology(stdout,city)};
}

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
/** A recorded methodology remains usable on its original clock; missing reads
 * cannot substitute a code constant for the certified source. */
const receivedMethodologyBodies=new WeakMap();
function receivedIndexMethodology(document,city,availableAt){
 if(!document||document.url!==`https://assets.kalshi.com/contract_terms/${INDEX_CITIES[city].terms}.pdf`||!Number.isFinite(Date.parse(document.availableAt))||!Number.isFinite(Date.parse(document.decodedAt))||Date.parse(document.availableAt)>Date.parse(document.decodedAt)||Date.parse(document.decodedAt)>availableAt||!/^\d+\.\d+$/.test(document.configurationVersion??'')||document.precisionF!==.01||!Number.isInteger(document.quorum?.members)||document.quorum.members<1||!Number.isFinite(document.quorum?.weight)||document.quorum.weight<=0||document.quorum.weight>1||typeof document.rawPdfBase64!=='string'||document.rawPdfBase64.length>3*1024*1024)return false;
 let parsed;try{parsed=parseIndexMethodology(document.rawText,city);}catch{return false;}
 if(parsed.configurationVersion!==document.configurationVersion||parsed.quorum.members!==document.quorum.members||parsed.quorum.weight!==document.quorum.weight||parsed.precisionF!==document.precisionF||parsed.roundingTieRule!==document.roundingTieRule)return false;
 // Repeated target/minute projections share one original PDF. Recheck its
 // bytes only when the byte carrier or claimed digest changes.
 const previous=receivedMethodologyBodies.get(document);
 if(previous?.rawPdfBase64===document.rawPdfBase64&&previous.sha256===document.sha256&&previous.bytes===document.bytes)return previous.valid;
 const bytes=Buffer.from(document.rawPdfBase64,'base64'),valid=bytes.length===document.bytes&&bytes.subarray(0,5).toString()==='%PDF-'&&bytes.toString('base64')===document.rawPdfBase64&&createHash('sha256').update(bytes).digest('hex')===document.sha256;
 receivedMethodologyBodies.set(document,{rawPdfBase64:document.rawPdfBase64,sha256:document.sha256,bytes:document.bytes,valid});return valid;
}
/** Bind eligibility to the actual received city law, rather than its URL alone.
 * Receipt/generation clocks are evidence availability, never a new law identity. */
export function weatherIndexContractScope(contract,evidence,now){
 const b=contract.binding;if(b?.kind!=='index-at')return contract;
 const packet=evidence.indices?.[b.city],configuration=indexConfiguration(packet,b.city,Date.parse(b.targetTime),now);
 if(!configuration)return {...contract,blocker:packet?.blocker??'hourly index methodology or target configuration is unread or incompatible'};
 const document=packet.methodology,law={city:b.city,methodologyBodyNI:'ni:///sha-256;'+Buffer.from(document.sha256,'hex').toString('base64url'),methodologySha256:document.sha256,configurationVersion:configuration.config_version,cityReferenceC:configuration.city_reference_c,stations:configuration.stations.map(s=>({stationId:s.station_id,weight:s.weight,offsetC:s.offset_c})).sort((a,b)=>a.stationId.localeCompare(b.stationId)),quorum:{members:document.quorum.members,weight:document.quorum.weight},precisionF:document.precisionF,roundingTieRule:document.roundingTieRule};
 const lawId=createHash('sha256').update(JSON.stringify(law)).digest('hex'),baseRuleKey=contract.indexLaw?.baseRuleKey??contract.ruleKey;
 const ruleKey=createHash('sha256').update(JSON.stringify({baseRuleKey,indexLaw:lawId})).digest('hex');
 return {...contract,ruleKey,indexLaw:{id:lawId,baseRuleKey,...law}};
}
export function indexConfiguration(packet,city,eventTime,availableAt){
 if(!Object.hasOwn(INDEX_CITIES,city))return null;
 const rows=packet?.calibrations?.calibrations;
 if(packet?.calibrations?.city!==city||packet.calibrations.units!=='celsius'||!Array.isArray(rows))return null;
 const c=rows.filter(c=>Number.isFinite(c.effective_at_ms)&&c.effective_at_ms<=eventTime&&Number.isFinite(c.published_at_ms)&&c.published_at_ms<=availableAt).sort((a,b)=>b.effective_at_ms-a.effective_at_ms)[0];
 const document=packet?.methodology;if(!receivedIndexMethodology(document,city,availableAt))return null;
 const prefix=city+'-temperature-v'+document.configurationVersion,version=c?.config_version;
 if(!c||typeof version!=='string'||!(version===prefix||version.startsWith(prefix+'-cal-')&&/^[0-9]{8}$/.test(version.slice((prefix+'-cal-').length)))||!Number.isFinite(c.city_reference_c)||!Array.isArray(c.stations)||!c.stations.length)return null;
 if(c.stations.some(s=>!/^[A-Z0-9]{4}1M$/.test(s.station_id)||!Number.isFinite(s.weight)||s.weight<=0||!Number.isFinite(s.offset_c))||new Set(c.stations.map(s=>s.station_id)).size!==c.stations.length)return null;
 const total=c.stations.reduce((sum,s)=>sum+s.weight,0),reference=c.stations.reduce((sum,s)=>sum+s.weight*s.offset_c,0);
 return document.quorum.members<=c.stations.length&&Math.abs(total-1)<1e-8&&Math.abs(reference-c.city_reference_c)<1e-8?c:null;
}
/** Receipt provenance is required: backfilled, pending, unknown, and late inputs never become truth. */
export function canonicalIndexPoints(packet,city,now){
 if(packet?.index?.city!==city||packet.index.units!=='fahrenheit')return [];
 return (packet.index.timeseries??[]).filter(p=>{
  if(!Number.isSafeInteger(p.t)||p.t%MINUTE!==0||!Number.isFinite(p.v)||p.v< -40||p.v>122||p.t+5*MINUTE>now||!['normal','degraded'].includes(p.status)||p.receipt_basis!==undefined&&p.receipt_basis!==null&&p.receipt_basis!=='local_receipt')return false;
  const c=indexConfiguration(packet,city,p.t,now),accepted=p.stations?.filter(s=>s.code==='ok');if(!c||!accepted?.length||accepted.length!==p.contributors)return false;
  if(accepted.some(s=>!Number.isFinite(s.received_at_ms)||s.received_at_ms>p.t+5*MINUTE||!Number.isFinite(s.temp_f)))return false;
  const weight=accepted.reduce((sum,s)=>sum+(c.stations.find(x=>x.station_id===s.station_id)?.weight??0),0),q=packet.methodology?.quorum;
  if(p.status==='degraded'&&!q)return false;
  return new Set(accepted.map(s=>s.station_id)).size===accepted.length&&accepted.every(s=>c.stations.some(x=>x.station_id===s.station_id))&&(p.status==='normal'?accepted.length===c.stations.length:accepted.length>=q.members&&weight+1e-9>=q.weight);
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
  try{packet.methodology=await indexMethodology(city,fetchImpl);}catch(e){errors.push({source:'Kalshi-weather-index-methodology',city,error:e.message});}
  packet.retrievedAt=new Date().toISOString();
  const current=packet.calibrations?.calibrations?.filter(c=>c.effective_at_ms<=now&&c.published_at_ms<=now).sort((a,b)=>b.effective_at_ms-a.effective_at_ms)[0];
  const expected=packet.methodology?.configurationVersion??null,reported=/-temperature-v([0-9]+\.[0-9]+)/.exec(current?.config_version??'')?.[1]??null;
  const support=cell('index:'+city,'current-methodology-version',{version:expected},{for:expected?[{source:packet.methodology.url,sha256:packet.methodology.sha256,version:expected}]:[],against:expected&&reported&&reported!==expected?[{source:packet.calibrationSource,version:reported,configVersion:current.config_version}]:[]});
  const validationAt=Date.now();
  packet.validation={at:new Date(validationAt).toISOString(),expectedVersion:expected,reportedVersion:reported,configVersion:current?.config_version??null,compatible:Boolean(indexConfiguration(packet,city,validationAt,validationAt)),conflicted:Boolean(support.for.length&&support.against.length),address:address(support),cell:support};
  if(!packet.validation.compatible)packet.blocker=!packet.methodology?'certified index methodology is unread':reported&&reported!==expected?`contract configuration v${expected} conflicts with published configuration v${reported}`:'no usable published index configuration';
 }));
 return {cities:packets,errors};
}
function curve(e,station,provider,now){
 let rows=[],issued,age,source;
 if(provider==='lamp'){issued=e.lamp?.runtime;age=3;source=e.lamp?.source;rows=(e.lamp?.stations[station]?.rows??[]).map(r=>({t:Date.parse(r.validTime),mean:r.temperatureF,scale:2.5}));}
 if(provider==='nbh'){issued=e.hourlyGuidance?.runtime;age=3;source=e.hourlyGuidance?.source;rows=(e.hourlyGuidance?.stations[station]?.rows??[]).map(r=>({t:Date.parse(r.ftime),mean:r.tmp,scale:Number.isFinite(r.tsd)?Math.max(1,r.tsd*Math.sqrt(3/5)):2.5}));}
 if(provider==='nbm'){issued=e.guidance?.runtime;age=8;source=e.guidance?.source;rows=(e.guidance?.stations[station]?.rows??[]).map(r=>({t:Date.parse(r.ftime),mean:r.tmp,scale:Number.isFinite(r.tsd)?Math.max(1,r.tsd*Math.sqrt(3/5)):2.5}));}
 if(provider==='nws'){const l=e.local?.[station];issued=l?.updated;age=8;source=l?.hourlyUrl;rows=(l?.periods??[]).filter(r=>['F','C'].includes(r.temperatureUnit)&&Number.isFinite(r.temperature)).map(r=>({t:Date.parse(r.startTime),mean:r.temperatureUnit==='C'?r.temperature*9/5+32:r.temperature,scale:2.5}));}
 if(!Number.isFinite(Date.parse(issued))||now<Date.parse(issued)||now-Date.parse(issued)>age*HOUR)return null;
 rows=rows.filter(r=>Number.isFinite(r.t)&&Number.isFinite(r.mean)&&r.mean>=-150&&r.mean<=180&&Number.isFinite(r.scale)&&r.scale>0).sort((a,b)=>a.t-b.t);return rows.length?{rows,source,issued}:null;
}
function interpolate(rows,t,allowBackfill=false){
 const exact=rows.find(r=>r.t===t);if(exact)return {...exact,backfilled:false};
 if(allowBackfill&&t<rows[0].t&&rows[0].t-t<=HOUR)return {...rows[0],backfilled:true};
 for(let i=0;i<rows.length-1;i++){const a=rows[i],b=rows[i+1];if(a.t<t&&t<b.t&&b.t-a.t<=3*HOUR){const fraction=(t-a.t)/(b.t-a.t);return {mean:a.mean+(b.mean-a.mean)*fraction,scale:Math.max(a.scale,b.scale),backfilled:false};}}
 return null;
}
/** Available forecast trajectory at one timestamp, retaining the actual provider provenance. */
export function stationTemperatureDistribution(e,station,provider,target,now){
 const c=curve(e,station,provider,now),r=c&&interpolate(c.rows,target);return r?{meanF:r.mean,scaleF:r.scale,nu:5,source:c.source,issuedAt:c.issued}:null;
}
/** Push the empirical joint scenarios through the published full-station index arithmetic. */
export function jointEcmwfIndexDistribution(city,e,target,now){
 const packet=e.indices?.[city],config=indexConfiguration(packet,city,target,now),ensemble=e.ecmwfEnsemble;
 if(!config||!packet.methodology||!Number.isFinite(Date.parse(packet.retrievedAt))||Date.parse(packet.retrievedAt)>now||Date.parse(packet.methodology.decodedAt)>now||target-now<5*MINUTE||target-now>24*HOUR)return null;
 const inputs=config.stations.map(s=>({config:s,station:s.station_id.slice(0,4),distribution:ecmwfStationDistributions(ensemble,s.station_id.slice(0,4),{now}).find(r=>Date.parse(r.validTime)===target)}));
 if(inputs.some(s=>!s.distribution))return null;
 const reference=inputs[0].distribution;
 if(inputs.some(s=>s.distribution.memberFieldSha256.some((id,i)=>id!==reference.memberFieldSha256[i])))return null;
 const pointsF=reference.empirical.members.map((member,i)=>inputs.reduce((sum,s)=>sum+s.config.weight*(s.distribution.empirical.pointsF[i]+1.8*(config.city_reference_c-s.config.offset_c)),0));
 const meanF=pointsF.reduce((a,x)=>a+x,0)/pointsF.length,varianceF2=pointsF.reduce((a,x)=>a+(x-meanF)**2,0)/pointsF.length;
 const empirical={kind:'member-aligned-city-index-proxy-v1',pointsF,members:[...reference.empirical.members]};
 const details={mean:meanF,scale:Math.max(.001,Math.sqrt(varianceF2*3/5)),nu:5,empirical,configVersion:config.config_version,configSource:packet.calibrationSource,methodologySha256:packet.methodology.sha256,targetTime:new Date(target).toISOString(),sourceRuntime:ensemble.runtime,sourceAvailableAt:ensemble.availableAt,memberFieldSha256:reference.memberFieldSha256,stationForecasts:inputs.map(s=>({station:s.config.station_id,weight:s.config.weight,offsetC:s.config.offset_c,meanF:s.distribution.meanF,scaleF:s.distribution.scaleF,source:ensemble.sourceUrl,issuedAt:ensemble.runtime})),uncertainty:'same-member spatial dependence retained; conditional on all configured station sensors passing QC at this target minute; grid-to-1-minute sensor discrepancy, degraded/unavailable reporting and 60-minute settlement fallback are unmodeled; local calibration and executable alpha unproven'};
 return {model:'kalshi-index-aifs-joint-v1',family:'ecmwf-aifs',meanF,scaleF:details.scale,nu:5,empirical,details,source:ensemble.sourceUrl,issuedAt:ensemble.runtime,tradeEligible:false};
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
 const joint=jointEcmwfIndexDistribution(city,e,target,now);if(joint)out.push(joint);
 for(const innovative of [false,true]){
  const candidates=out.filter(r=>r.model.endsWith('/recent-innovation-v1')===innovative).map(r=>{const provider=/kalshi-index-(lamp|nbh|nbm|nws|aifs)-/.exec(r.model)?.[1];return {...r,family:provider==='nbh'?'nbm':provider==='aifs'?'ecmwf-aifs':provider,priority:provider==='nbh'?1:0,issuedAt:r.details.stationForecasts?.reduce((a,c)=>a<c.issuedAt?c.issuedAt:a,'')};});
  const pool=makeTemperaturePool(candidates);if(!pool)continue;
  out.push({...pool,model:(candidates.some(c=>c.family==='ecmwf-aifs')?'kalshi-index-family-pool-with-aifs-v2':'kalshi-index-family-pool-v1')+(innovative?'/recent-innovation-v1':''),source:packet.calibrationSource,details:{...pool,mean:pool.meanF,scale:pool.scaleF,configVersion:c.config_version,configSource:packet.calibrationSource,stationForecasts:c.stations.map(s=>({station:s.station_id,weight:s.weight})),targetTime:new Date(target).toISOString(),status:'prospective ensemble experiment; physical calibration and market advantage unproven'}});
 }
 return out;
}
/** Half-cent tie behavior is not specified by the certified documents: retain its probability bounds. */
export function indexBracketProbabilityBounds(m,distribution){
 const cdf=(x,left=false)=>temperatureCdf(distribution,x,{left}),cent=v=>Math.round(v*100),precise=v=>Number.isFinite(v)&&Math.abs(v-cent(v)/100)<1e-9;
 let lower,upper;
 if(m.strike_type==='greater'&&precise(m.floor_strike)){const b=(cent(m.floor_strike)+.5)/100;lower=1-cdf(b);upper=1-cdf(b,true);}
 else if(m.strike_type==='less'&&precise(m.cap_strike)){const b=(cent(m.cap_strike)-.5)/100;lower=cdf(b,true);upper=cdf(b);}
 else if(m.strike_type==='between'&&precise(m.floor_strike)&&precise(m.cap_strike)&&m.floor_strike<=m.cap_strike){const l=(cent(m.floor_strike)-.5)/100,h=(cent(m.cap_strike)+.5)/100;lower=cdf(h,true)-cdf(l);upper=cdf(h)-cdf(l,true);}
 else return null;
 return {lower:Math.max(0,Math.min(1,lower)),upper:Math.max(0,Math.min(1,upper)),precisionF:.01,roundingTieRule:'certified nearest 0.01F; exact half-cent tie behavior unspecified'};
}
export function indexBracketProbability(m,distribution){const bounds=indexBracketProbabilityBounds(m,distribution);return bounds&&bounds.upper-bounds.lower<1e-12?bounds.lower:null;}
export function priceWeatherIndex(c,e,now){
 const b=c.binding;if(b?.kind!=='index-at')return [];
 const target=Date.parse(b.targetTime),h=(target-now)/HOUR,horizon=h<=3?'0-3h':h<=6?'3-6h':h<=12?'6-12h':'12-24h';
 const distributions=indexDistributions(b.city,e,target,now).flatMap(r=>{
  const p=e.science?.parameters?.[`${b.station}/${r.model}/${horizon}`];
  if(!p?.ready)return [r];
  const adjusted=postprocessTemperature(r,p);
  return [r,{...adjusted,model:r.model+'/station-postprocess-v1',details:{...r.details,mean:adjusted.meanF,scale:adjusted.scaleF,meanF:adjusted.meanF,scaleF:adjusted.scaleF,...(adjusted.mixture?{mixture:adjusted.mixture}:{}),postprocessing:{...p,baseModel:r.model}}}];
 });
 if(Number.isFinite(Date.parse(e.science?.at))&&Date.parse(e.science.at)<=now){
  for(const r of e.science.forecasts??[]){
   if(!r.model?.endsWith('/paired-family-ewa-v1')||r.station!==b.station||Date.parse(r.validTime)!==target||r.horizon!==horizon||!Number.isFinite(Date.parse(r.availableAt))||Date.parse(r.availableAt)>now||!Number.isFinite(Date.parse(r.learning?.fitAvailableAt))||Date.parse(r.learning.fitAvailableAt)>Date.parse(r.availableAt))continue;
   const base=distributions.find(d=>d.model===r.model.slice(0,-'/paired-family-ewa-v1'.length)&&d.composition===r.composition&&d.details?.configVersion===r.details?.configVersion);if(!base)continue;
   distributions.push({...r,details:{...r.details,learning:r.learning,frozenScienceAvailableAt:r.availableAt,tradeEligible:false}});
  }
 }
 return distributions.flatMap(r=>{const p=indexBracketProbability(c,r);return Number.isFinite(p)?[{id:r.model,p,details:{...r.details,probabilityBounds:indexBracketProbabilityBounds(c,r)}}]:[];});
}
