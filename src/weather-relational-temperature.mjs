/** An empirical, finite numerical experiment inspired by Obsmetrologia's measured
 * reading: raw witnesses remain distinct from fitted values and skill claims.
 * Carrier: routine near-surface air-temperature reports, with station/time/unit.
 * Transformation: temporal/spatial differences -> next reporting-bin increment.
 * This is neither an identification of FOUR with probability nor a H1 theorem. */
import {createHash} from 'node:crypto';
export const RELATIONAL_REGIONS=Object.freeze({nyc:['JFK','LGA','EWR','HPN'],miami:['MIA','FLL','OPF']});
const HOUR=3600000,DAY=24*HOUR;
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const quantile=(xs,p)=>{const a=[...xs].sort((a,b)=>a-b);return a[Math.min(a.length-1,Math.ceil((a.length+1)*p)-1)];};
const iso=t=>new Date(t).toISOString();
export function parseRelationalTemperatureCsv(text,{stations,availableAt,sourceId}={}){
 if(!Array.isArray(stations)||stations.length<2||!Number.isFinite(Date.parse(availableAt??'')))throw new TypeError('station scope and actual retrieval clock required');
 const lines=text.trim().split(/\r?\n/),header=lines.shift().split(','),ix=Object.fromEntries(header.map((v,i)=>[v,i]));
 if(!['station','valid','tmpf','lon','lat','elevation'].every(k=>Object.hasOwn(ix,k)))throw new TypeError('IEM temperature/clock/geometry header required');
 const marks=[],groups=new Map(),missing=[];
 for(let row=0;row<lines.length;row++){
  const a=lines[row].split(','),station=a[ix.station];if(!stations.includes(station))continue;
  const raw=a[ix.tmpf],t=Date.parse(a[ix.valid].replace(' ','T')+'Z'),temperatureF=raw?.trim()!==''&&raw!=='M'?Number(raw):NaN;
  if(!Number.isFinite(t)||!Number.isFinite(temperatureF)||temperatureF< -150||temperatureF>160||t>Date.parse(availableAt)){missing.push({row:row+2,station,reason:'missing, invalid or future report'});continue;}
  const mark={station,observedAt:iso(t),availableAt,temperatureC:(temperatureF-32)*5/9,rawTemperatureF:temperatureF,geometry:{longitude:Number(a[ix.lon]),latitude:Number(a[ix.lat]),elevationM:Number(a[ix.elevation])},witness:{sourceId,row:row+2}};
  marks.push(mark);const key=station+'/'+t;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(mark);
 }
 const conflicts=[],accepted=[];let duplicates=0;
 for(const [key,rows] of groups){const values=new Set(rows.map(r=>r.temperatureC));if(values.size>1){conflicts.push({key,witnesses:rows});continue;}duplicates+=rows.length-1;accepted.push({...rows[0],witnesses:rows.map(r=>r.witness)});}
 return {marks,accepted,conflicts,missing,duplicates,reading:'numeric values retain raw witnesses; contradictory same-station/same-clock reports are withheld, not averaged; absent data is not contrary evidence'};
}
/** Each bin uses the last routine report at/before the UTC boundary, <=20 min old.
 * No interpolation across an unobserved reporting hour and no future report fill. */
export function relationalTemperaturePanel(reading,{stations}={}){
 const panel=new Map();
 for(const r of reading.accepted){const t=Date.parse(r.observedAt),boundary=Math.ceil(t/HOUR)*HOUR;if(boundary-t>20*60000)continue;let p=panel.get(boundary);if(!p)panel.set(boundary,p={});if(!p[r.station]||Date.parse(p[r.station].observedAt)<t)p[r.station]=r;}
 return [...panel].sort((a,b)=>a[0]-b[0]).map(([t,p])=>({at:t,complete:stations.every(s=>p[s]),stations:p}));
}
export function relationalTemperatureFeatures(panel,t,target,stations,relational,peerFeatures='both'){
 const a=panel.get(t),b=panel.get(t-HOUR),c=panel.get(t-2*HOUR);if(!a||!b||!c)return null;
 const required=relational?stations:[target];if(!required.every(s=>a[s]&&b[s]&&c[s]))return null;
 const T=(p,s)=>p[s].temperatureC,theta=2*Math.PI*(t/HOUR%24)/24;
 const x=[T(a,target)-T(b,target),T(b,target)-T(c,target),Math.sin(theta),Math.cos(theta)];
 if(relational)for(const peer of stations.filter(s=>s!==target)){if(['both','gradients'].includes(peerFeatures))x.push(T(a,peer)-T(a,target));if(['both','increments'].includes(peerFeatures))x.push(T(a,peer)-T(b,peer));}
 return {x,anchorC:T(a,target),witnesses:required.flatMap(s=>[a[s],b[s],c[s]].flatMap(r=>r.witnesses)),lastObservedAt:Math.max(...required.map(s=>Date.parse(a[s].observedAt)))};
}
/** Different learner: actual report durations and ages, without filling missing bins. */
export function relationalIrregularTemperatureFeatures(panel,t,target,stations){
 const histories=new Map(stations.map(s=>[s,[...panel].filter(([b,p])=>b<=t&&b>=t-4*HOUR&&p[s]).sort(([a],[b])=>b-a).map(([,p])=>p[s])])),own=histories.get(target);
 if(own.length<3||!stations.every(s=>histories.get(s).length>=2&&panel.get(t)?.[s]))return null;
 const elapsed=(a,b)=>(Date.parse(a.observedAt)-Date.parse(b.observedAt))/HOUR,span1=elapsed(own[0],own[1]),span2=elapsed(own[1],own[2]);if(span1<=0||span2<=0)return null;
 const theta=2*Math.PI*(t/HOUR%24)/24,x=[(own[0].temperatureC-own[1].temperatureC)/span1,(own[1].temperatureC-own[2].temperatureC)/span2,Math.sin(theta),Math.cos(theta),span1,span2];
 for(const peer of stations.filter(s=>s!==target)){const [a,b]=histories.get(peer),span=elapsed(a,b);if(span<=0)return null;x.push(a.temperatureC-own[0].temperatureC,(a.temperatureC-b.temperatureC)/span,span);}
 const used=stations.flatMap(s=>histories.get(s).slice(0,s===target?3:2));return {x,anchorC:own[0].temperatureC,witnesses:used.flatMap(r=>r.witnesses),lastObservedAt:Math.max(...used.map(r=>Date.parse(r.observedAt))),reportSpansHours:[span1,span2],operator:'actual temporal rates and durations, current peer gradients; no filled report'};
}
function solve(A,b){
 const n=b.length,L=Array.from({length:n},()=>Array(n).fill(0));
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let v=A[i][j];for(let k=0;k<j;k++)v-=L[i][k]*L[j][k];if(i===j){if(!(v>0))throw new Error('nonpositive ridge normal matrix');L[i][j]=Math.sqrt(v);}else L[i][j]=v/L[j][j];}
 const y=Array(n),x=Array(n);for(let i=0;i<n;i++){let v=b[i];for(let j=0;j<i;j++)v-=L[i][j]*y[j];y[i]=v/L[i][i];}for(let i=n-1;i>=0;i--){let v=y[i];for(let j=i+1;j<n;j++)v-=L[j][i]*x[j];x[i]=v/L[i][i];}return x;
}
export function fitRelationalTemperature(rows,{ridge=10}={}){
 if(rows.length<72||!Number.isFinite(ridge)||ridge<=0)throw new TypeError('>=72 past examples and positive fixed ridge required');
 const d=rows[0].x.length,centers=Array.from({length:d},(_,j)=>mean(rows.map(r=>r.x[j]))),scales=centers.map((m,j)=>Math.max(1e-9,Math.sqrt(mean(rows.map(r=>(r.x[j]-m)**2))))),yMean=mean(rows.map(r=>r.y));
 const A=Array.from({length:d},(_,i)=>Array.from({length:d},(_,j)=>i===j?ridge:0)),b=Array(d).fill(0);
 for(const r of rows){const x=r.x.map((v,j)=>(v-centers[j])/scales[j]);for(let i=0;i<d;i++){b[i]+=x[i]*(r.y-yMean);for(let j=0;j<d;j++)A[i][j]+=x[i]*x[j];}}
 return {centers,scales,coefficients:solve(A,b),yMean,ridge,samples:rows.length};
}
export function predictRelationalTemperature(model,x){return model.yMean+x.reduce((s,v,j)=>s+model.coefficients[j]*(v-model.centers[j])/model.scales[j],0);}
/** Full empirical predictive law from earlier calibration residuals, without a
 * Gaussian shape assumption. CRPS is exact for this discrete distribution. */
export function empiricalResidualLaw(residuals){
 const sorted=[...residuals].sort((a,b)=>a-b);if(!sorted.length||sorted.some(v=>!Number.isFinite(v)))throw new TypeError('finite earlier calibration residuals required');
 const prefix=[0];for(const r of sorted)prefix.push(prefix.at(-1)+r);
 const n=sorted.length,halfPairDistance=sorted.reduce((sum,r,i)=>sum+(2*i-n+1)*r,0)/(n*n);
 return {sorted,prefix,halfPairDistance};
}
export function empiricalResidualCrps(law,observedResidual){
 const {sorted:a,prefix:s,halfPairDistance}=law;let lo=0,hi=a.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(a[mid]<=observedResidual)lo=mid+1;else hi=mid;}
 const absolute=(observedResidual*lo-s[lo]+s.at(-1)-s[lo]-observedResidual*(a.length-lo))/a.length;
 return Math.max(0,absolute-halfPairDistance);
}
function interval(days){
 if(days.length<30)return null;let seed=20261007;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
 const block=Math.min(7,days.length),samples=[];
 for(let k=0;k<1000;k++){const xs=[];while(xs.length<days.length){const start=Math.floor(random()*(days.length-block+1));xs.push(...days.slice(start,start+block));}samples.push(mean(xs.slice(0,days.length)));}
 samples.sort((a,b)=>a-b);return {lower95C:samples[25],upper95C:samples[974],blockDays:block,replicates:1000,method:'exploratory moving seven-day block bootstrap of paired UTC issuance-day means; assumes representative approximately stationary day blocks, not independent hours; no multiple-comparison or market-edge claim'};
}
function relationalModels(train,cal,{ridge=10}={}){
 const models={persistence:{residualLaw:empiricalResidualLaw(cal.map(r=>r.y)),radius90C:quantile(cal.map(r=>Math.abs(r.y)),.9)}};
 for(const mode of ['own','relational']){const m=fitRelationalTemperature(train.map(r=>({x:r[mode],y:r.y})),{ridge:mode==='relational'?ridge:10}),residuals=cal.map(r=>r.y-predictRelationalTemperature(m,r[mode]));models[mode]={...m,residualLaw:empiricalResidualLaw(residuals),radius90C:quantile(residuals.map(Math.abs),.9)};}
 return models;
}
/** Freeze a prospective learner on labels strictly before a specified day. */
export function fitRelationalTemperatureForIssuance(reading,{stations,before,ridge=10,peerFeatures='both',trainingDays=60,calibrationDays=14,irregular=false}={}){
 const day=Date.parse(before);if(!Number.isFinite(day)||day%DAY||!Number.isFinite(ridge)||ridge<=0||ridge>1000||!['both','gradients','increments','none'].includes(peerFeatures)||trainingDays!==60||calibrationDays!==14)throw new TypeError('UTC-day cutoff and bounded prospective specification required');
 const panel=new Map(relationalTemperaturePanel(reading,{stations}).map(p=>[p.at,p.stations])),fits=[];
 for(const station of stations){const past=[];for(const [t] of panel){if(t+HOUR>=day||t+HOUR<day-trainingDays*DAY)continue;const rel=irregular?relationalIrregularTemperatureFeatures(panel,t,station,stations):relationalTemperatureFeatures(panel,t,station,stations,true,peerFeatures),own=irregular?rel&&{x:rel.x.slice(0,6),anchorC:rel.anchorC}:relationalTemperatureFeatures(panel,t,station,stations,false),truth=panel.get(t+HOUR)?.[station];if(own&&rel&&truth)past.push({own:own.x,relational:rel.x,y:truth.temperatureC-own.anchorC,targetAt:t+HOUR});}
 const train=past.filter(r=>r.targetAt<day-calibrationDays*DAY),cal=past.filter(r=>r.targetAt>=day-calibrationDays*DAY);if(train.length<72||cal.length<48)continue;
 fits.push({station,trainingLabelBefore:iso(day-calibrationDays*DAY),calibrationLabelBefore:iso(day),trainingExamples:train.length,calibrationExamples:cal.length,models:relationalModels(train,cal,{ridge})});}
 return fits;
}
/** Refit once per held-out day; every training/calibration label is strictly earlier.
 * All comparators use exactly the same complete cases and past-only fitting scope. */
export function replayRelationalTemperature(reading,{stations,trainingDays=60,calibrationDays=14,includePredictions=false,includeFits=false,ridge=10,peerFeatures='both'}={}){
 if(!Number.isFinite(ridge)||ridge<=0||ridge>1000||!['both','gradients','increments','none'].includes(peerFeatures))throw new TypeError('bounded learner specification required');
 if(!Number.isInteger(trainingDays)||trainingDays<30||!Number.isInteger(calibrationDays)||calibrationDays<7||calibrationDays>=trainingDays)throw new TypeError('bounded chronological train/calibration scopes required');
 const points=relationalTemperaturePanel(reading,{stations}),panel=new Map(points.map(p=>[p.at,p.stations]));if(!points.length)throw new Error('no comparable reporting bins');
 const rows=new Map(stations.map(s=>[s,[]]));
 for(const {at:t} of points)for(const station of stations){const own=relationalTemperatureFeatures(panel,t,station,stations,false),rel=relationalTemperatureFeatures(panel,t,station,stations,true,peerFeatures),truth=panel.get(t+HOUR)?.[station];if(!own||!rel||!truth)continue;rows.get(station).push({at:t,targetAt:t+HOUR,anchorC:own.anchorC,y:truth.temperatureC-own.anchorC,own:own.x,relational:rel.x,truth,inputs:rel});}
 const start=Math.ceil((points[0].at+trainingDays*DAY)/DAY)*DAY,last=points.at(-1).at,predictions=[],frozen=[];
 for(let day=start;day<=last;day+=DAY)for(const station of stations){
  const candidates=rows.get(station),past=candidates.filter(r=>r.targetAt<day&&r.targetAt>=day-trainingDays*DAY),train=past.filter(r=>r.targetAt<day-calibrationDays*DAY),cal=past.filter(r=>r.targetAt>=day-calibrationDays*DAY),test=candidates.filter(r=>r.at>=day&&r.at<day+DAY);
  if(train.length<72||cal.length<48||!test.length)continue;
  const models=relationalModels(train,cal,{ridge});
  frozen.push({station,issuedAt:iso(day),trainingLabelBefore:iso(day-calibrationDays*DAY),calibrationLabelBefore:iso(day),trainingExamples:train.length,calibrationExamples:cal.length,models});
  for(const r of test){const values={persistence:0,own:predictRelationalTemperature(models.own,r.own),relational:predictRelationalTemperature(models.relational,r.relational)};
   predictions.push({station,issuedAt:iso(r.at),validTime:iso(r.targetAt),date:iso(r.at).slice(0,10),fitBefore:iso(day),retrospective:true,anchorC:r.anchorC,truthC:r.anchorC+r.y,predictionsC:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,r.anchorC+v])),absoluteErrorsC:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,Math.abs(v-r.y)])),errorsC:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v-r.y])),crpsC:Object.fromEntries(Object.keys(values).map(k=>[k,empiricalResidualCrps(models[k].residualLaw,r.y-values[k])])),covered90:Object.fromEntries(Object.keys(values).map(k=>[k,Math.abs(values[k]-r.y)<=models[k].radius90C])),inputLastObservedAt:iso(r.inputs.lastObservedAt),witnesses:r.inputs.witnesses,truthWitnesses:r.truth.witnesses});
  }
 }
 const summaries=[];
 for(const station of [...stations,'all']){
  const rs=predictions.filter(r=>station==='all'||r.station===station);if(!rs.length)continue;
  const dates=[...new Set(rs.map(r=>r.date))].sort(),dayGains=dates.map(d=>mean(rs.filter(r=>r.date===d).map(r=>r.absoluteErrorsC.own-r.absoluteErrorsC.relational)));
  summaries.push({station,samples:rs.length,dates:dates.length,models:Object.fromEntries(['persistence','own','relational'].map(k=>[k,{maeC:mean(rs.map(r=>r.absoluteErrorsC[k])),rmseC:Math.sqrt(mean(rs.map(r=>r.errorsC[k]**2))),crpsC:mean(rs.map(r=>r.crpsC[k])),coverage90:mean(rs.map(r=>Number(r.covered90[k])))}])),meanDayMaeGainOverOwnC:mean(dayGains),pairedDayInterval:interval(dayGains),meanDayCrpsGainOverOwnC:mean(dates.map(d=>mean(rs.filter(r=>r.date===d).map(r=>r.crpsC.own-r.crpsC.relational)))),pairedDayCrpsInterval:interval(dates.map(d=>mean(rs.filter(r=>r.date===d).map(r=>r.crpsC.own-r.crpsC.relational))))});
 }
 return {carrier:'routine near-surface air temperature at station-specific report times; last report within 20 minutes of UTC boundary; next reporting-bin value, not an exact-hour instantaneous temperature or daily settlement',experimentSpec:{ridge,peerFeatures},algorithm:`fixed ridge=${ridge}, train-only standardized temporal increments, directed peer-minus-target temperature differences and peer increments, UTC diurnal reference; anchor absolute predictions on target report`,predictiveDistribution:'full discrete empirical law of signed earlier calibration residuals around each predicted increment; exact CRPS; no Gaussian shape or unobserved tail extrapolation',status:(predictions.length?'retrospective observation-archive experiment;':'no comparable held-out cases;')+' report clocks are not historical receipt clocks; no live skill or trade admission',trainingDays,calibrationDays,heldoutFrom:predictions[0]?.issuedAt??null,heldoutThrough:predictions.at(-1)?.validTime??null,stationsWithoutReports:stations.filter(s=>!reading.accepted.some(r=>r.station===s)),sourceRows:reading.marks.length,conflicts:reading.conflicts,missingReports:reading.missing.length,duplicateWitnesses:reading.duplicates,completeBins:points.filter(p=>p.complete).length,summaries,lastFits:frozen.slice(-stations.length),examples:[...predictions.slice(0,2),...predictions.slice(-2)],...(includePredictions?{predictions}:{}),...(includeFits?{fitRecords:frozen}:{}),limitations:['one season, a small airport network, limited archive quality control','up to 20 minute temporal representativeness mismatch; different site elevations and exposures retained, not presumed identical','same observational lineage as NWS; archive replay does not establish original publication latency','predictive distributions and calibration radii use earlier empirical residuals; finite support does not represent unseen extremes; serial dependence prevents an exchangeability guarantee','source evidence and skill are separate; no mapping of numeric temperature into FOUR truth values','not compared with NBM/LAMP on matched historical issuance; no daily-extreme, climate-regime, or market-profit claim']};
}
export async function collectRelationalTemperatureScience({region='nyc',now=Date.now(),fetchImpl=fetch}={}){
 if(!Object.hasOwn(RELATIONAL_REGIONS,region)||!Number.isFinite(now))throw new TypeError('known relational region and current clock required');
 // A bounded 98-day archive ending at today's UTC midnight; no current-day truth.
 const end=Math.floor(now/DAY)*DAY,start=end-98*DAY,url=new URL('https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py'),stations=RELATIONAL_REGIONS[region];
 for(const station of stations)url.searchParams.append('station',station);
 for(const [suffix,t] of [['1',start],['2',end]]){const d=new Date(t);for(const [k,v] of [['year',d.getUTCFullYear()],['month',d.getUTCMonth()+1],['day',d.getUTCDate()]])url.searchParams.set(k+suffix,String(v));}
 for(const [k,v] of Object.entries({data:'tmpf',tz:'Etc/UTC',format:'onlycomma',latlon:'yes',elev:'yes',missing:'M',trace:'T',direct:'no',report_type:'3'}))url.searchParams.set(k,v);
 const response=await fetchImpl(url,{signal:AbortSignal.timeout(50000)});if(!response.ok)throw new Error('IEM temperature archive '+response.status);
 const text=await response.text();if(Buffer.byteLength(text)>2*1024*1024)throw new Error('station archive exceeds bounded scientific scope');
 const availableAt=iso(Date.now()),sourceId=createHash('sha256').update(text).digest('hex'),source={url:String(url),availableAt,sha256:sourceId,bytes:Buffer.byteLength(text),observationFrom:iso(start),observationBefore:iso(end),archiveQuality:'IEM processed routine METAR; as-is collection, limited quality control; not an independent second sensor'};
 const reading=parseRelationalTemperatureCsv(text,{stations,availableAt,sourceId});
 return {at:availableAt,kind:'relational-temperature-science-v1',region,stations:stations.map(s=>'K'+s),source,rawSource:text,experiment:replayRelationalTemperature(reading,{stations}),orderEffect:false};
}
