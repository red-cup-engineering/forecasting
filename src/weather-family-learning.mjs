/** Past-only matched-date switching-experts adaptation (Herbster–Warmuth fixed-share).\n * Physical forecasts remain distinct from market settlement and execution. */
import {createHash} from 'node:crypto';
import {makeTemperaturePool} from './weather-ensemble.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
/** Scientific identity: Lenticule Climate Science 2026-10-14
 * source-bound-hourly-temperature-forecast-science, section 3.
 * One matched TARGET DATE is one score update; it is never 5-minute pseudo-replication.
 */
export const FAMILY_LEARNING_PROTOCOL=Object.freeze({id:'paired-family-fixed-share-v2',windowDays:14,etaPerF:1,uniformShare:.1});
/** Fixed-share online expert update; CRPS losses may be expressed relative to
 * the same dated comparator because a common additive loss cancels.
 * 'days' must be strictly ascending, individually source-admitted matched dates.
 * This operation is a forecast learner, not a calibrated venue probability.
 */
export function fixedShareFamilyWeights(families,days,{etaPerF=FAMILY_LEARNING_PROTOCOL.etaPerF,uniformShare=FAMILY_LEARNING_PROTOCOL.uniformShare}={}){
 if(!Array.isArray(families)||families.length<2||new Set(families).size!==families.length||
    families.some(f=>typeof f!=='string'||!f)||!Array.isArray(days)||
    !Number.isFinite(etaPerF)||etaPerF<0||!Number.isFinite(uniformShare)||uniformShare<0||uniformShare>1)
   throw new TypeError('distinct forecast families, matched days, nonnegative learning rate and switching share required');
 const size=families.length,base=1/size;
 let weights=families.map(()=>base),previousDate='';
 for(const day of days){
  if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day.date??'')||day.date<=previousDate||
     !day.losses||typeof day.losses!=='object'||Object.keys(day.losses).length!==size||
     families.some(f=>!Number.isFinite(day.losses[f])||!Number.isFinite(etaPerF*day.losses[f])))
    throw new TypeError('one complete, finite, unique chronological score per family and target date required');
  previousDate=day.date;
  const logWeights=families.map((f,i)=>Math.log(weights[i])-etaPerF*day.losses[f]);
  const peak=Math.max(...logWeights),unnormalized=logWeights.map(v=>Math.exp(v-peak));
  const total=unnormalized.reduce((a,b)=>a+b,0);
  weights=unnormalized.map(v=>(1-uniformShare)*v/total+uniformShare*base);
 }
 return Object.fromEntries(families.map((f,i)=>[f,weights[i]]));
}
/** Uniform initialization; matched completed outcomes, including currently received partial-day means. */
export function adaptiveTemperaturePool(base,state,{now=Date.now()}={}){
 const components=base.mixture?.components;
 if(!Array.isArray(components)||components.length<2||!base.composition||!base.station||!base.horizon||!base.availableAt||Date.parse(base.availableAt)>now||!Number.isFinite(Date.parse(base.availableAt)))return null;
 const families=components.map(c=>c.family);
 if(families.some(f=>!f)||new Set(families).size!==families.length)return null;
 const received=Date.parse(state.at),cutoff=new Date(now-FAMILY_LEARNING_PROTOCOL.windowDays*86400000).toISOString().slice(0,10),byDay=new Map();
 if(Number.isFinite(received)&&received<=now)for(const row of Object.values(state.comparisons??{})){
  if(row.station!==base.station||row.pool!==base.model||row.horizon!==base.horizon||row.composition!==base.composition||row.truth!==(base.truth??'NWS station observations')||(row.configurationVersion??null)!==(base.details?.configVersion??null)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')||row.date<cutoff||row.date>new Date(now+86400000).toISOString().slice(0,10)||!Number.isFinite(row.n)||row.n<=0||!Number.isFinite(row.gainSum))continue;
  const c=components.find(c=>c.model===row.component&&c.family===row.family);if(!c)continue;
  const clock=Date.parse(row.scoreAvailableAt??state.at);if(!Number.isFinite(clock)||clock>now)continue;
  const day=byDay.get(row.date)??new Map();if(day.has(c.family)){day.set(c.family,null);}else day.set(c.family,row);byDay.set(row.date,day);
 }
 const matched=[...byDay].filter(([,day])=>families.every(f=>day.get(f))&&new Set(families.map(f=>day.get(f).n)).size===1).sort(([a],[b])=>a.localeCompare(b));
 const dailyLosses=matched.map(([date,day])=>({date,losses:Object.fromEntries(families.map(f=>[f,day.get(f).gainSum/day.get(f).n]))}));
 const gains=Object.fromEntries(families.map(f=>[f,dailyLosses.reduce((s,day)=>s+day.losses[f],0)/Math.max(1,dailyLosses.length)]));
 const weights=fixedShareFamilyWeights(families,dailyLosses);
 const pool=makeTemperaturePool(components,{familyWeights:weights});if(!pool)return null;
 const witnesses=matched.map(([date,day])=>({date,samples:day.get(families[0]).n,components:families.map(f=>{const r=day.get(f);return {family:f,model:r.component,gainSumF:r.gainSum,scoreAvailableAt:r.scoreAvailableAt??state.at,sourceEvidenceId:r.sourceEvidenceId??null};})}));
 return {...base,...pool,model:base.model+'/paired-family-fixed-share-v2',tradeEligible:false,comparators:[{...base,comparators:undefined}],learning:{...FAMILY_LEARNING_PROTOCOL,weights,regularizedMeanComponentExcessCrpsF:gains,matchedDates:matched.length,matchedSamples:matched.reduce((s,[,day])=>s+day.get(families[0]).n,0),fitAvailableAt:new Date(now).toISOString(),outcomeReceiptBoundAt:Number.isFinite(received)&&received<=now?state.at:null,sourceDigest:hash(witnesses),witnesses,status:'forward fixed-share experiment; matched scored dates only; eta and switching share untrained; no source, calibration, regret, market-edge or profit claim'},details:{...base.details,...pool,mean:pool.meanF,scale:pool.scaleF,status:'past-only scored-date fixed-share mixture; physical and market skill unproven'}};
}
