/** Relational precipitation measurements and same-day daily-rain experiments.
 * Overlapping accumulation windows are witnesses, never summed into a total. */
import {climateDayWindow} from './rain-market-model.mjs';
const HOUR=3600000,QC=new Set(['qc:V','V']);
export function precipitationWitnesses(pages,{station,start,end,receivedAt,observedUntil=end}){
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||!Number.isFinite(observedUntil)||observedUntil<start||observedUntil>end||!Number.isFinite(Date.parse(receivedAt)))throw new TypeError('bounded climate interval and receipt required');
 const witnesses=[],conflicts=[],byInterval=new Map();
 for(const page of pages)for(const feature of page.packet.features??[]){
  const p=feature?.properties??{},at=Date.parse(p.timestamp),identity=feature.id??p['@id']??null;
  if(!Number.isFinite(at)||at<start||at>end||at>observedUntil||at>Date.parse(page.receivedAt))continue;
  const suppliedStation=typeof p.station==='string'?p.station.split('/').at(-1):null;
  if(suppliedStation&&suppliedStation!==station){conflicts.push({kind:'station-mismatch',featureId:identity,station:suppliedStation,pageSha256:page.sha256});continue;}
  for(const [field,hours] of [['precipitationLastHour',1],['precipitationLast3Hours',3],['precipitationLast6Hours',6]]){
   const q=p[field];if(q===undefined)continue;
   const supported=q?.unitCode==='wmoUnit:mm',valid=typeof q?.value==='number'&&Number.isFinite(q.value)&&q.value>=0&&supported&&QC.has(q.qualityControl),amountMm=valid?q.value:null;
   const w={featureId:identity,pageSha256:page.sha256,source:page.url,availableAt:page.receivedAt,station,at:new Date(at).toISOString(),intervalStart:new Date(at-hours*HOUR).toISOString(),intervalEnd:new Date(at).toISOString(),field,raw:q,status:amountMm===null?'missing-or-untrusted':amountMm>=.254?'measurable':'below-measurable-threshold',amountMm,fullyWithinClimateDay:at-hours*HOUR>=start&&at<=end,method:'reported rolling accumulation; explicit mm and validated quality only'};
   const key=at+'/'+hours,prior=byInterval.get(key);if(prior&&JSON.stringify(prior.raw)!==JSON.stringify(w.raw)){conflicts.push({kind:'contradictory-accumulation',key,witnesses:[prior,w]});prior.conflicted=true;w.conflicted=true;}byInterval.set(key,w);witnesses.push(w);
  }
  // A scheduled METAR's Prrrr accumulates since its last scheduled hourly
  // report. An enclosing two-hour interval avoids assuming minute-precise
  // gauge reset time; SPECI and malformed report clocks are not decoded.
  const raw=p.rawMessage,tokens=typeof raw==='string'?raw.trim().split(/\s+/):[],rmk=tokens.indexOf('RMK'),reportClock=/^(\d\d)(\d\d)(\d\d)Z$/.exec(tokens[tokens[0]==='METAR'?2:1]??'');
  if(tokens[0]==='SPECI'||rmk<0||!reportClock||+reportClock[1]!==new Date(at).getUTCDate()||+reportClock[2]!==new Date(at).getUTCHours()||Math.abs(+reportClock[3]-new Date(at).getUTCMinutes())>1)continue;
  const code=tokens[0]==='METAR'?tokens[1]:tokens[0];if(code!==station)continue;
  const ps=tokens.slice(rmk+1).filter(t=>/^P(?:\d{4}|\/{4})$/.test(t));if(!ps.length)continue;
  const values=new Set(ps);if(values.size>1){conflicts.push({kind:'contradictory-metar-precipitation',featureId:identity,pageSha256:page.sha256,rawMessage:raw,tokens:ps});continue;}
  if(tokens.slice(rmk+1).includes('PNO')){conflicts.push({kind:'metar-precipitation-unavailable',featureId:identity,pageSha256:page.sha256,rawMessage:raw,tokens:ps});continue;}
  const token=ps[0],hundredths=/^P\d{4}$/.test(token)?Number(token.slice(1)):null;
  const w={featureId:identity,pageSha256:page.sha256,source:page.url,availableAt:page.receivedAt,station,at:new Date(at).toISOString(),intervalStart:new Date(at-2*HOUR).toISOString(),intervalEnd:new Date(at).toISOString(),field:'METAR-Prrrr',raw:{token,rawMessage:raw},status:hundredths===null?'missing-or-untrusted':hundredths===0?'trace':'measurable',amountHundredthsInch:hundredths,fullyWithinClimateDay:at-2*HOUR>=start&&at<=end,method:'scheduled hourly METAR Prrrr; conservative enclosing 2-hour support interval; no absent-token dry inference'};
  const key=at+'/metar-P',prior=byInterval.get(key);if(prior&&prior.raw.token!==token){conflicts.push({kind:'contradictory-metar-accumulation',key,witnesses:[prior,w]});prior.conflicted=true;w.conflicted=true;}byInterval.set(key,w);witnesses.push(w);
 }
 const conflictKeys=new Set(conflicts.filter(c=>c.key).map(c=>c.key));for(const w of witnesses)if(conflictKeys.has(Date.parse(w.at)+'/'+(w.field==='METAR-Prrrr'?'metar-P':((Date.parse(w.at)-Date.parse(w.intervalStart))/HOUR))))w.conflicted=true;
 const support=witnesses.filter(w=>w.status==='measurable'&&w.fullyWithinClimateDay&&!w.conflicted);
 return {station,climateStart:new Date(start).toISOString(),climateEnd:new Date(end).toISOString(),receivedAt,observedUntil:new Date(observedUntil).toISOString(),witnesses,conflicts,measurableWitnesses:support.length,measurableObserved:support.length>0,missingIsDry:false,totalPrecipitationInches:null,overlapPolicy:'do not sum overlapping accumulations; one supported measurable interval suffices for a proxy wet witness',settlementCertified:false};
}
/** Bounds on the union of fully future hourly >=0.01-inch events. They do not
 * identify daily reported rain: subthreshold hours can accumulate, past rain
 * can be unobserved, and a partially elapsed hour cannot be conditioned from
 * a marginal probability alone. */
export function remainingRainGuidance(guidance,{station,start,end,now}){
 const runtime=Date.parse(guidance?.runtime),source=guidance?.source??null;
 if(!Number.isFinite(runtime)||runtime>now||now-runtime>3*HOUR)return {available:false,reason:'causal hourly guidance within three hours required'};
 const rows=guidance.stations?.[station]?.rows??[],used=[],partial=[],missing=[];
 for(let hour=Math.ceil(Math.max(start,now)/HOUR)*HOUR;hour<end;hour+=HOUR){
  if(hour<now)continue;const ending=hour+HOUR;if(ending>end)continue;const row=rows.find(r=>Date.parse(r.ftime)===ending);
  if(!row||!Number.isFinite(row.p01)||row.p01<0||row.p01>100){missing.push(new Date(ending).toISOString());continue;}used.push({start:new Date(hour).toISOString(),end:new Date(ending).toISOString(),p:row.p01/100});
 }
 if(now%HOUR!==0&&now>=start&&now<end)partial.push({start:new Date(Math.floor(now/HOUR)*HOUR).toISOString(),end:new Date(Math.ceil(now/HOUR)*HOUR).toISOString(),reason:'partially elapsed hourly marginal is not a conditional remainder probability'});
 const probabilities=used.map(r=>r.p),sum=probabilities.reduce((s,p)=>s+p,0);
 return {available:used.length>0,runtime:new Date(runtime).toISOString(),source,used,missing,partial,completeFullFutureHours:missing.length===0,unionLow:probabilities.length?Math.max(...probabilities):null,unionHigh:probabilities.length?Math.min(1,sum):null,independenceScenario:probabilities.length?1-probabilities.reduce((s,p)=>s*(1-p),1):null,identifiesDailyRain:false,meaning:'Fréchet/union bounds for listed fully future hourly measurable events, conditional on treating published marginals as valid; no independence, past-dry, reporting-equivalence or calibration certificate'};
}
export function sameDayRainEvidence(c,e,now){
 const b=c.binding;if(b?.kind!=='rain'||c.seriesTicker!=='KXRAIN'||!Number.isFinite(now))return null;
 const {start,end}=climateDayWindow(b.targetDate,b.timeZone);if(now<start||now>=end)return null;
 const observed=e.observations?.[b.station+'/'+b.targetDate]?.precipitation??null;
 const causal=observed&&Date.parse(observed.receivedAt)<=now&&Date.parse(observed.climateStart)===start&&Date.parse(observed.climateEnd)===end;
 return {station:b.station,climateStart:new Date(start).toISOString(),climateEnd:new Date(end).toISOString(),observation:causal?observed:null,observationCausal:Boolean(causal),remaining:remainingRainGuidance(e.hourlyGuidance,{station:b.station,start,end,now}),pastDryCertified:false,finalReport:e.settlement?.daily?.[b.targetDate]?.data?.results?.find(r=>r.station?.icao===b.station)??null,tradeEligible:false};
}
export function sameDayRainModels(c,e,now){
 const evidence=sameDayRainEvidence(c,e,now);if(!evidence?.observation?.measurableObserved)return [];
 return [.01,.05].map(failureProbability=>({id:'nws-measurable-rain-proxy-failure-'+Math.round(failureProbability*100)+'pct-v1',p:1-failureProbability,details:{...evidence,proxyFailureProbability:failureProbability,probabilityIdentified:false,tradeEligible:false,status:'forward same-day experiment; fixed 1% or 5% NWS-to-final-TWC failure assumption, not fitted or certified; source wet witness is not final venue settlement'}}));
}
