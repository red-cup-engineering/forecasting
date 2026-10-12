/** Daily-extreme pushforward of hourly marginals. No independent-error assumption. */
import {climateDayStart} from './station-observations.mjs';
import {studentTCdf,bracketBounds} from './temperature-distribution.mjs';
const HOUR=3600000,clamp=x=>Math.min(1,Math.max(0,x));
/** Bounds hold for the declared hourly marginals; they do not bound subhour peaks or station/source error. */
export function extremeCdf(x,{kind,points,observedBound=null,sourceDisagreementPrior=0.01}){
 if(!['high','low'].includes(kind)||!points?.length||points.some(p=>!Number.isFinite(p.meanF)||!Number.isFinite(p.scaleF)||p.scaleF<=0)||!Number.isFinite(sourceDisagreementPrior)||sourceDisagreementPrior<0||sourceDisagreementPrior>1||observedBound!==null&&!Number.isFinite(observedBound))throw new TypeError('valid hourly extreme distribution required');
 if(x===-Infinity)return {p:0,low:0,high:0};if(x===Infinity)return {p:1,low:1,high:1};if(!Number.isFinite(x))throw new TypeError('finite threshold or infinity required');
 const fs=points.map(r=>studentTCdf((x-r.meanF)/r.scaleF,5));
 let p,low,high;
 if(kind==='high'){p=high=Math.min(...fs);low=clamp(1-fs.reduce((s,v)=>s+1-v,0));}
 else {p=low=Math.max(...fs);high=clamp(fs.reduce((s,v)=>s+v,0));}
 // The loose NWS bound is a proxy witness, not a hard constraint on TWC settlement.
 if(observedBound!==null){
  const transform=kind==='high'?(v=>x<observedBound?sourceDisagreementPrior*v:v):(v=>x>=observedBound?1-sourceDisagreementPrior+sourceDisagreementPrior*v:v);
  p=transform(p);low=transform(low);high=transform(high);
 }
 return {p:clamp(p),low:clamp(low),high:clamp(high)};
}
export function extremeBracketProbability(bracket,distribution){
 const [lo,hi]=bracketBounds(bracket);if(Number.isNaN(lo)||Number.isNaN(hi)||hi<=lo)throw new TypeError('valid whole-degree bracket required');
 const a=extremeCdf(lo,distribution),b=extremeCdf(hi,distribution);
 const p=clamp(b.p-a.p);
 return {p,structuralProbabilityBounds:{low:Math.min(p,clamp(b.low-a.high)),high:Math.max(p,clamp(b.high-a.low)),kind:'hourly-marginal-dependence-bounds',scope:'conditional on Student-t hourly marginals, piecewise-linear hourly path and declared proxy-bound mixture; excludes subhour peaks and station/source discrepancy'}};
}
function dailyPath(e,request,targetDate,now){
 const source=e.hourlyGuidance,runtime=Date.parse(source?.runtime),start=climateDayStart(targetDate,request.timeZone).getTime(),end=start+24*HOUR,first=Math.max(now,start);
 if(first>=end)return {gap:'weather day already ended'};
 if(!Number.isFinite(runtime)||runtime>now||now-runtime>3*HOUR)return {gap:'no fresh NBH runtime'};
 if(Number.isFinite(Date.parse(e.at))&&Date.parse(e.at)>now)return {gap:'evidence is not yet available'};
 const obs=e.observations?.[`${request.station}/${targetDate}`],inDay=now>=start;
 if(inDay&&(!(obs?.count>=3)||!Number.isFinite(obs.floor)||!Number.isFinite(obs.ceiling)||!Number.isFinite(Date.parse(obs.latest))||Date.parse(obs.latest)>now||now-Date.parse(obs.latest)>90*60000))return {gap:'insufficient contemporaneous observed-day proxy'};
 const rows=source.stations?.[request.station]?.rows??[],map=new Map();
 for(const r of rows){const t=Date.parse(r.ftime);if(Number.isFinite(t)&&t>runtime&&t<=runtime+25*HOUR&&t%HOUR===0&&Number.isFinite(r.tmp)&&Number.isFinite(r.tsd)&&r.tsd>=0)map.set(t,{at:new Date(t).toISOString(),meanF:r.tmp,scaleF:Math.max(1,r.tsd*Math.sqrt(3/5))});}
 const interpolate=t=>{
  if(map.has(t))return {...map.get(t)};
  const a=map.get(Math.floor(t/HOUR)*HOUR),b=map.get(Math.ceil(t/HOUR)*HOUR);
  if(a&&b){const w=(t-Date.parse(a.at))/HOUR;return {at:new Date(t).toISOString(),meanF:a.meanF+w*(b.meanF-a.meanF),scaleF:a.scaleF+w*(b.scaleF-a.scaleF),boundary:'linear interpolation of location and Student-t scale'};}
  // First issued forecast can begin next hour: explicitly hold it back for at most one hour.
  if(t===first&&inDay&&b&&Date.parse(b.at)-t<=HOUR)return {...b,at:new Date(t).toISOString(),boundary:'first future forecast held back to availability time; uncalibrated'};
  return null;
 };
 const times=[first];for(let t=Math.floor(first/HOUR)*HOUR+HOUR;t<end;t+=HOUR)times.push(t);if(times.at(-1)!==end-1)times.push(end-1);
 const points=times.map(interpolate);if(points.some(p=>!p))return {gap:'NBH does not cover every remaining hour and the final day boundary with temperature and spread'};
 return {points,obs:inDay?obs:null,start,end,runtime:source.runtime,source:source.source};
}
/** Compile once per source packet, shared by all venue brackets and independent station research. */
export function deriveDailyTemperatureExtremes(e,{now=Date.now()}={}){
 const forecasts=[],gaps=[];
 for(const request of e.stations??[])for(const targetDate of request.targetDates??[]){
  const path=dailyPath(e,request,targetDate,now),base={station:request.station,timeZone:request.timeZone,targetDate};
  if(path.gap){gaps.push({...base,reason:path.gap});continue;}
  for(const kind of ['high','low'])forecasts.push({...base,kind,model:`nbm-nbh-comonotone-${kind}-v1`,availableAt:new Date(now).toISOString(),runtime:path.runtime,source:path.source,dayStart:new Date(path.start).toISOString(),dayEndExclusive:new Date(path.end).toISOString(),points:path.points,observedBound:path.obs?(kind==='high'?path.obs.floor:path.obs.ceiling):null,observedSource:path.obs?{source:'NWS station observations',url:path.obs.source??null,latest:path.obs.latest,count:path.obs.count,interpretation:'loose whole-degree observed-day proxy bound'}:null,sourceDisagreementPrior:0.01,distributionKind:'extreme of piecewise-linear hourly Student-t marginals with one common rank shock',uncertainty:'NBH TSD converted from standard deviation to t(5) scale, with 1 F scale floor; uncalibrated',status:'experimental daily-extreme proxy; dependence bounds conditional on declared marginals; subhour extremes and source/station mismatch are not resolved; no independent daily physical grade'});
 }
 return {forecasts,gaps};
}
export function priceDailyTemperatureExtreme(c,e,now){
 const b=c.binding;if(!b||!['high','low'].includes(b.kind))return null;
 const compiled=e.dailyExtremes??deriveDailyTemperatureExtremes(e,{now});
 const d=compiled.forecasts.find(r=>r.station===b.station&&r.targetDate===b.targetDate&&r.kind===b.kind&&r.timeZone===b.timeZone);
 if(!d||Date.parse(d.availableAt)>now||now-Date.parse(d.availableAt)>15*60000||Date.parse(d.runtime)>now||now-Date.parse(d.runtime)>3*HOUR||now>=Date.parse(d.dayEndExclusive))return null;
 const priced=extremeBracketProbability({strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike},d);
 return {id:d.model,p:priced.p,details:{...d,structuralProbabilityBounds:priced.structuralProbabilityBounds,proxy:b.proxy}};
}


/**
 * Sharp Fréchet bounds on whether a proxy-observed daily high is never
 * exceeded at any *modeled remaining hourly point*. Given the conditional
 * hourly CDFs F_i(m), the conjunction of {T_i <= m} has probability in
 *
 *   [max(0, 1 - sum_i(1 - F_i(m))), min_i F_i(m)].
 *
 * The comonotone extremal CDF used as the point estimate by extremeCdf
 * equals the UPPER bound here. It must not be presented as a conservative
 * probability that the high has passed.
 *
 * This is not a bound for the venue's settlement high: source/station
 * differences, within-hour peaks, reporting corrections, hourly-marginal
 * calibration and publication latency are intentionally unresolved.
 * No live order/quote eligibility is implied.
 */
export function lateDayHighPassageEnvelope({ observedHighF, futureHourlyPoints }) {
  if (!Number.isFinite(observedHighF)) throw new TypeError('finite proxy observed high required');
  const cdf = extremeCdf(observedHighF, {
    kind: 'high',
    points: futureHourlyPoints,
    observedBound: null,
  });
  return {
    observedHighF,
    futureHourlyCount: futureHourlyPoints.length,
    noLaterHourlyExceedance: { low: cdf.low, high: cdf.high },
    laterHourlyExceedance: { low: 1 - cdf.high, high: 1 - cdf.low },
    probabilityKind: 'sharp-frechet-bounds-given-hourly-conditional-marginals',
    scope: 'Future modeled hourly points only, not subhour peaks, settlement-source discrepancies, measurement rounding, corrections, or calibrated venue payout',
    tradeEligible: false,
  };
}
