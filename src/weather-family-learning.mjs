/** Past-only forecast-family adaptation over the existing paired daily outcome carrier. */
import {createHash} from 'node:crypto';
import {NWS_REPORT_CELL_VERSION,NWS_REPORT_CELL_TRUTH} from './station-observations.mjs';
import {makeTemperaturePool} from './weather-ensemble.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const FAMILY_LEARNING_PROTOCOL=Object.freeze({id:'paired-family-ewa-v1',windowDays:14,priorDays:10,etaPerF:1,uniformShare:.1});
export const CELL_FAMILY_LEARNING_PROTOCOL=Object.freeze({...FAMILY_LEARNING_PROTOCOL,id:'paired-family-cell-ewa-v1'});
/** Uniform initialization; matched completed outcomes, including currently received partial-day means. */
export function adaptiveTemperaturePool(base,state,{now=Date.now(),reportedCells=false}={}){
 if(typeof reportedCells!=='boolean')throw new TypeError('reportedCells must be boolean');
 const protocol=reportedCells?CELL_FAMILY_LEARNING_PROTOCOL:FAMILY_LEARNING_PROTOCOL,gainField=reportedCells?'gainUpperSumF':'gainSum';
 if(reportedCells&&(!Number.isFinite(Date.parse(base.validTime))||Date.parse(base.validTime)-15*60000<=now))return null;
 const components=base.mixture?.components;
 if(!Array.isArray(components)||components.length<2||!base.composition||!base.station||!base.horizon||!base.availableAt||Date.parse(base.availableAt)>now||!Number.isFinite(Date.parse(base.availableAt)))return null;
 const families=components.map(c=>c.family);
 if(families.some(f=>!f)||new Set(families).size!==families.length)return null;
 const received=Date.parse(state.at),cutoff=new Date(now-protocol.windowDays*86400000).toISOString().slice(0,10),byDay=new Map();
 if(Number.isFinite(received)&&received<=now)for(const row of Object.values((reportedCells?state.measurementComparisons:state.comparisons)??{})){
  if(row.station!==base.station||row.pool!==base.model||row.horizon!==base.horizon||row.composition!==base.composition||row.truth!==(reportedCells?NWS_REPORT_CELL_TRUTH:(base.truth??'NWS station observations'))||(reportedCells&&row.measurementOperator!==NWS_REPORT_CELL_VERSION)||(row.configurationVersion??null)!==(base.details?.configVersion??null)||!/^\d{4}-\d{2}-\d{2}$/.test(row.date??'')||row.date<cutoff||row.date>new Date(now+86400000).toISOString().slice(0,10)||!Number.isFinite(row.n)||row.n<=0||!Number.isFinite(row[gainField]))continue;
  const c=components.find(c=>c.model===row.component&&c.family===row.family);if(!c)continue;
  const clock=Date.parse(row.scoreAvailableAt??state.at);if(!Number.isFinite(clock)||clock>now)continue;
  const day=byDay.get(row.date)??new Map();if(day.has(c.family)){day.set(c.family,null);}else day.set(c.family,row);byDay.set(row.date,day);
 }
 const matched=[...byDay].filter(([,day])=>families.every(f=>day.get(f))&&new Set(families.map(f=>day.get(f).n)).size===1).sort(([a],[b])=>a.localeCompare(b));
 const gains=Object.fromEntries(families.map(f=>[f,matched.reduce((s,[,day])=>s+day.get(f)[gainField]/day.get(f).n,0)/(protocol.priorDays+matched.length)]));
 const scores=families.map(f=>-protocol.etaPerF*gains[f]),max=Math.max(...scores),total=scores.reduce((s,x)=>s+Math.exp(x-max),0);
 const weights=Object.fromEntries(families.map((f,i)=>[f,protocol.uniformShare/families.length+(1-protocol.uniformShare)*Math.exp(scores[i]-max)/total]));
 const pool=makeTemperaturePool(components,{familyWeights:weights});if(!pool)return null;
 const witnesses=matched.map(([date,day])=>({date,samples:day.get(families[0]).n,components:families.map(f=>{const r=day.get(f);return {family:f,model:r.component,...(reportedCells?{gainLowSumF:r.gainLowSumF,gainUpperSumF:r.gainUpperSumF,measurementOperator:r.measurementOperator}:{gainSumF:r.gainSum}),scoreAvailableAt:r.scoreAvailableAt??state.at,sourceEvidenceId:r.sourceEvidenceId??null};})}));
 return {...base,...pool,model:base.model+'/'+protocol.id,...(reportedCells?{verification:'nws-report-cell-v1',truth:NWS_REPORT_CELL_TRUTH,earliestTargetObservationAt:new Date(Date.parse(base.validTime)-15*60000).toISOString()}: {}),publicationLeadBin:(Date.parse(base.validTime)-now)/60000<=15?'5-15m':(Date.parse(base.validTime)-now)/60000<=30?'15-30m':(Date.parse(base.validTime)-now)/60000<=60?'30-60m':base.horizon,tradeEligible:false,comparators:[{...base,comparators:undefined}],learning:{...protocol,...(reportedCells?{lossBasis:'upper paired component excess CRPS over one common reported-temperature cell',measurementOperator:NWS_REPORT_CELL_VERSION}:{}),weights,regularizedMeanComponentExcessCrpsF:gains,matchedDates:matched.length,matchedSamples:matched.reduce((s,[,day])=>s+day.get(families[0]).n,0),fitAvailableAt:new Date(now).toISOString(),outcomeReceiptBoundAt:Number.isFinite(received)&&received<=now?state.at:null,sourceDigest:hash(witnesses),witnesses,status:'forward experiment; partial-day updates remain one date contribution; fixed learning rate, prior and window untrained; no calibration, regret-bound, market-edge or profit claim'},details:{...base.details,...pool,mean:pool.meanF,scale:pool.scaleF,status:'past-only paired-family exponential weights; physical and market skill unproven'}};
}
