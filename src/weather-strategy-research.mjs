/** Empirical learner generation and concurrent research/market strategy study.
 * Numeric learners, epistemic witnesses and economic simulations remain distinct.
 * This is a bounded learner-generating learner, not autonomous LLM code evolution. */
import {createHash} from 'node:crypto';
import {collectRelationalTemperatureScience,parseRelationalTemperatureCsv,replayRelationalTemperature,RELATIONAL_REGIONS} from './weather-relational-temperature.mjs';
const DAY=86400000,mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const key=r=>r.station+'/'+r.issuedAt;
export const WEATHER_LEARNER_SPECS=Object.freeze([
 {id:'relational-ridge-10',ridge:10,peerFeatures:'both'},
 {id:'relational-ridge-1',ridge:1,peerFeatures:'both'},
 {id:'relational-ridge-100',ridge:100,peerFeatures:'both'},
 {id:'peer-increments',ridge:10,peerFeatures:'increments'},
 {id:'peer-gradients',ridge:10,peerFeatures:'gradients'},
 {id:'own-history',ridge:10,peerFeatures:'none'},
]);
function below(sorted,x){let lo=0,hi=sorted.length;while(lo<hi){const mid=(lo+hi)>>1;if(sorted[mid]<x-1e-10)lo=mid+1;else hi=mid;}return lo;}
function expectedAbsolute(law,center,y){const a=law.sorted,s=law.prefix,k=below(a,y-center),n=a.length,z=y-center;return (z*k-s[k]+s[n]-s[k]-z*(n-k))/n;}
/** Exact cross-component distance; permits unequal calibration sample sizes. */
export function crossEmpiricalDistance(left,right){
 const a=left.law.sorted,b=right.law.sorted,prefix=right.law.prefix,n=b.length;let j=0,total=0;
 for(const v of a){const z=v+left.center-right.center;while(j<n&&b[j]<=z)j++;total+=z*j-prefix[j]+prefix[n]-prefix[j]-z*(n-j);}return total/(a.length*n);
}
function mixtureTerms(distributions,truth){
 const absolute=distributions.map(d=>expectedAbsolute(d.law,d.center,truth)),distances=distributions.map((d,i)=>distributions.map((e,j)=>i===j?2*d.law.halfPairDistance:j<i?null:crossEmpiricalDistance(d,e)));
 for(let i=0;i<distances.length;i++)for(let j=0;j<i;j++)distances[i][j]=distances[j][i];return {absolute,distances};
}
export function mixtureEmpiricalCrps(weights,terms){
 if(weights.some(w=>!Number.isFinite(w)||w<0)||Math.abs(weights.reduce((s,w)=>s+w,0)-1)>1e-9)throw new TypeError('probability weights required');
 let score=weights.reduce((s,w,i)=>s+w*terms.absolute[i],0);for(let i=0;i<weights.length;i++)for(let j=0;j<weights.length;j++)score-=.5*weights[i]*weights[j]*terms.distances[i][j];return Math.max(0,score);
}
const weighted=(weights,values)=>weights.reduce((s,w,i)=>s+w*values[i],0);
function modelDistribution(result,record){const m=result.fits.get(record.fitBefore+'/'+record.station)?.models.relational;if(!m)throw new Error('frozen component fit missing');return {center:record.predictionsC.relational,law:m.residualLaw};}
function priorDayLosses(results,day,lookback=14){
 const dates=new Map();for(const r of results[0].predictions){const target=Date.parse(r.validTime),issued=Date.parse(r.issuedAt);if(target>=day||issued<day-lookback*DAY)continue;const date=r.date;if(!dates.has(date))dates.set(date,[]);dates.get(date).push(key(r));}
 return [...dates].sort(([a],[b])=>a.localeCompare(b)).map(([date,keys])=>({date,losses:results.map(r=>mean(keys.map(k=>r.byKey.get(k).crpsC.relational)))}));
}
export function generatorWeights(losses,{kind='soft',eta=8,warmupDates=7,candidateCount=WEATHER_LEARNER_SPECS.length}={}){
 const n=losses[0]?.losses.length??candidateCount;
 if(losses.length<warmupDates)return Array.from({length:n},(_,i)=>i===0?1:0);
 const scores=Array.from({length:n},(_,i)=>mean(losses.map(d=>d.losses[i]))),best=Math.min(...scores);
 if(kind==='winner'){const i=scores.indexOf(best);return scores.map((_,j)=>j===i?1:0);}
 const masses=scores.map(v=>Math.exp(-eta*(v-best))),total=masses.reduce((a,b)=>a+b,0);return masses.map(v=>v/total);
}
/** Encoded arena accepted by the existing gaming/encoding/arena decoder.
 * Opponent/public events remain admissible independently of our compute moves.
 * Deadline arrival can precede computation; policy then refuses publication. */
export function weatherResearchGame(){
 const moves=[['history','negative'],['market','negative'],['rival-update','negative'],['settlement','negative'],['generate','positive'],['publish','positive'],['score','positive'],['learn','positive']];
 const causality=[['history','generate'],['generate','publish'],['history','rival-update'],['market','rival-update'],['history','settlement'],['publish','score'],['settlement','score'],['generate','learn'],['settlement','learn']];
 const structure={events:moves.map(([id,polarity])=>({id,polarity})),causality,conflict:[]},symmetry=[moves.map(([id])=>[id,id])],plays=[];
 const enabled=seen=>moves.filter(([id])=>!seen.has(id)&&causality.filter(([,to])=>to===id).every(([from])=>seen.has(from)));
 const visit=history=>{plays.push({moves:history});const seen=new Set(history),available=enabled(seen),opponent=available.filter(([,p])=>p==='negative').map(([id])=>id),player=available.filter(([id,p])=>p==='positive'&&(id!=='publish'||!seen.has('settlement'))).map(([id])=>id);for(const id of [...opponent,...player.slice(0,1)])visit([...history,id]);};
 visit([]);return {arena:{structure,symmetry},strategy:{plays},semantics:{history:'measurement history with disclosed observation/receipt clocks',market:'public market evidence; scenario quotes are not observed venue quotes','rival-update':'adaptive opponent action concurrent with our learner generation','generate':'generate and fit a bounded learner family','publish':'issue a prospective prediction only before settlement arrival','settlement':'exogenous physical/venue outcome; never requires our action','score':'evaluate an earlier publication','learn':'revise learner generation from now-available outcomes'},scope:'finite sequential Player policy over concurrent Opponent events; identity symmetry only; not a Nash/confluence theorem or complete market execution arena'};
}
const GENERATORS=[{id:'fixed-relational',kind:'fixed'},{id:'slow-mixture',kind:'soft',eta:2},{id:'adaptive-mixture',kind:'soft',eta:8},{id:'sharp-mixture',kind:'soft',eta:32},{id:'prior-winner',kind:'winner'}];
function summarize(records){
 if(!records.length)return {samples:0,dates:0};const dates=[...new Set(records.map(r=>r.date))],gains=dates.map(d=>mean(records.filter(r=>r.date===d).map(r=>r.baselineCrpsC-r.crpsC)));
 return {samples:records.length,dates:dates.length,crpsC:mean(records.map(r=>r.crpsC)),baselineCrpsC:mean(records.map(r=>r.baselineCrpsC)),meanDayCrpsGainC:Math.abs(mean(gains))<1e-12?0:mean(gains),improvedDates:gains.filter(v=>v>1e-9).length,interval:null,intervalReason:'exploratory nested selection on one seasonal archive; no independent prospective confirmation or trading admission'};
}
/** Fictitious one-hour binary instrument, not a Kalshi contract or order.
 * Quotes depend on rival forecast strategy. Cash consumed at entry, returned only
 * on simulated maturity. Same-information rivals erase the model's quote edge. */
export function simulateWeatherRivals(records,{cashUsd=100,halfSpread=.01,feePerContract=.01,minEdge=.02}={}){
 if(![cashUsd,halfSpread,feePerContract,minEdge].every(Number.isFinite)||cashUsd<1||halfSpread<0||feePerContract<0||minEdge<0)throw new TypeError('explicit finite simulation costs required');
 const rivals=['own-history-follower','fixed-relational-follower','adaptive-generator-follower','same-information-copy'],reports=[];
 for(const rival of rivals){let cash=cashUsd,trades=0,wins=0,reservedMax=0,expectedGain=0,unfunded=0;const pending=[],outcomes=[];
  const mature=t=>{for(let i=pending.length-1;i>=0;i--)if(pending[i].at<=t){cash+=pending[i].payout;outcomes.push(pending[i]);pending.splice(i,1);}};
  for(const r of [...records].sort((a,b)=>a.issuedAt.localeCompare(b.issuedAt)||a.station.localeCompare(b.station))){
   const t=Date.parse(r.issuedAt);mature(t);const p=r.p,q=r.rivalProbabilities[rival];if(![p,q].every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw new Error('rival and forecast probabilities required');
   const yesPrice=Math.ceil(Math.min(1,q+halfSpread)*100-1e-9)/100,noPrice=Math.ceil(Math.min(1,1-q+halfSpread)*100-1e-9)/100,yesCost=yesPrice+feePerContract,noCost=noPrice+feePerContract,yesEdge=p-yesCost,noEdge=1-p-noCost;
   const side=yesEdge>=noEdge?'yes':'no',edge=Math.max(yesEdge,noEdge),cost=side==='yes'?yesCost:noCost;if(edge<minEdge||cost>=1)continue;if(cost>cash+1e-9){unfunded++;continue;}
   cash-=cost;trades++;expectedGain+=edge;const payout=Number(side==='yes'?r.eventOutcome:!r.eventOutcome);wins+=payout;pending.push({at:Date.parse(r.validTime),date:r.date,payout,cost,side,pnl:payout-cost});reservedMax=Math.max(reservedMax,pending.reduce((s,p)=>s+p.cost,0));
  }
  mature(Infinity);reports.push({rival,startingCashUsd:cashUsd,endingCashUsd:cash,netPnlUsd:cash-cashUsd,trades,wins,expectedGainUnderOurModelUsd:expectedGain,maxConcurrentCashConsumedUsd:reservedMax,unfunded,dates:outcomes.length?new Set(outcomes.map(r=>r.date)).size:0,realVenue:false,quoteBasis:'rival-strategy-generated probabilities; hypothetical guaranteed displayed size, cent-rounded asks, fixed scenario spread and fee; no actual maker fill/latency model'});
 }
 return {instrument:'hypothetical next-report temperature >= current report + 1 Fahrenheit degree; same source reporting bins; not a live Kalshi contract',halfSpread,feePerContract,minEdge,reports,interpretation:'stress tests of shared-information competition; numerical simulated PnL is not evidence of executable alpha'};
}
export function discoverWeatherLearners(reading,{stations,specifications=WEATHER_LEARNER_SPECS}={}){
 if(!Array.isArray(specifications)||specifications.length<2||specifications.length>8||specifications[0].ridge!==10||specifications[0].peerFeatures!=='both'||new Set(specifications.map(s=>s.id)).size!==specifications.length)throw new TypeError('2..8 distinct learners with unchanged relational baseline first required');
 const started=performance.now(),results=[],generationCosts=[];
 for(const spec of specifications){const begin=performance.now(),report=replayRelationalTemperature(reading,{stations,...spec,includePredictions:true,includeFits:true});if(!report.predictions.length)throw new Error('no common cases to generate learners');const fits=new Map(report.fitRecords.map(r=>[r.issuedAt+'/'+r.station,r]));results.push({spec,predictions:report.predictions,byKey:new Map(report.predictions.map(r=>[key(r),r])),fits,summary:report.summaries.at(-1)});generationCosts.push({specification:spec,elapsedMs:performance.now()-begin,fitCount:report.fitRecords.length,samples:report.predictions.length});}
 const caseKeys=results[0].predictions.map(key);for(const result of results)if(result.predictions.length!==caseKeys.length||caseKeys.some(k=>!result.byKey.has(k)))throw new Error('generator comparisons require exactly paired cases');
 const casesByDay=new Map();for(const r of results[0].predictions){if(!casesByDay.has(r.date))casesByDay.set(r.date,[]);casesByDay.get(r.date).push(r);}
 const outputs=new Map(GENERATORS.map(g=>[g.id,[]])),recursive=[],decisions=[];
 for(const [date,cases] of [...casesByDay].sort(([a],[b])=>a.localeCompare(b))){
  const day=Date.parse(date+'T00:00:00Z'),past=priorDayLosses(results,day),weightSets=GENERATORS.map(g=>g.kind==='fixed'?specifications.map((_,i)=>i===0?1:0):generatorWeights(past,{...g,candidateCount:specifications.length}));
  // The meta learner can only score generator publications whose truth is earlier.
  const priorGeneratorDays=new Set(outputs.get(GENERATORS[0].id).filter(r=>Date.parse(r.validTime)<day&&Date.parse(r.issuedAt)>=day-14*DAY).map(r=>r.date));
  const generatorScores=GENERATORS.map(g=>priorGeneratorDays.size<7?Infinity:mean([...priorGeneratorDays].map(d=>mean(outputs.get(g.id).filter(r=>r.date===d&&Date.parse(r.validTime)<day).map(r=>r.crpsC)))));
  const chosen=priorGeneratorDays.size<7?0:generatorScores.indexOf(Math.min(...generatorScores));
  decisions.push({date,truthAvailableBefore:new Date(day).toISOString(),candidateValidationDates:past.length,generatorValidationDates:priorGeneratorDays.size,selectedGenerator:GENERATORS[chosen].id,selectedCandidateWeights:Object.fromEntries(specifications.map((s,i)=>[s.id,weightSets[chosen][i]])),generatorScoresC:Object.fromEntries(GENERATORS.map((g,i)=>[g.id,Number.isFinite(generatorScores[i])?generatorScores[i]:null]))});
  for(const base of cases){const componentRecords=results.map(r=>r.byKey.get(key(base))),distributions=results.map((r,i)=>modelDistribution(r,componentRecords[i])),terms=mixtureTerms(distributions,base.truthC),probabilities=distributions.map(d=>1-below(d.law.sorted,base.anchorC+5/9-d.center)/d.law.sorted.length),ownModel=results[0].fits.get(base.fitBefore+'/'+base.station).models.own,ownLaw={center:base.predictionsC.own,law:ownModel.residualLaw},ownProbability=1-below(ownLaw.law.sorted,base.anchorC+5/9-ownLaw.center)/ownLaw.law.sorted.length;
   const rows=GENERATORS.map((g,i)=>({station:base.station,date,issuedAt:base.issuedAt,validTime:base.validTime,generator:g.id,crpsC:mixtureEmpiricalCrps(weightSets[i],terms),baselineCrpsC:base.crpsC.relational,p:weighted(weightSets[i],probabilities),eventOutcome:base.truthC-base.anchorC>=5/9-1e-10}));
   for(let i=0;i<GENERATORS.length;i++)outputs.get(GENERATORS[i].id).push(rows[i]);
   const selected=rows[chosen],rivalChosen=past.length<7?0:past.at(-1).losses.indexOf(Math.min(...past.at(-1).losses));
   recursive.push({...selected,generator:'learner-generating-learner',selectedGenerator:GENERATORS[chosen].id,rivalProbabilities:{'own-history-follower':ownProbability,'fixed-relational-follower':probabilities[0],'adaptive-generator-follower':probabilities[rivalChosen],'same-information-copy':selected.p}});
  }
 }
 const game=weatherResearchGame(),full={kind:'weather-learner-strategy-space-v1',status:'retrospective learner-generation experiment plus explicitly hypothetical economic scenarios; no live skill or trade admission',specifications,generationCosts,generatedLearners:results.map(r=>({specification:r.spec,physicalSummary:r.summary,lastFrozenFits:[...r.fits.values()].slice(-stations.length)})),generators:GENERATORS.map(g=>({...g,summary:summarize(outputs.get(g.id))})),recursiveLearner:summarize(recursive),selectionDecisions:decisions,competition:simulateWeatherRivals(recursive),game,resourceCost:{elapsedMs:performance.now()-started,retainedHeapBytes:process.memoryUsage().heapUsed},examples:[...recursive.slice(0,2),...recursive.slice(-2)],limitations:['one season and airport networks; numerical learner/configuration generation only, not LLM code evolution','receipt clocks unavailable historically; all results retrospective','outer generator adaptation uses earlier outcomes; exploration and repeated inspection still require fresh prospective confirmation','economic scenarios assume a hypothetical instrument and displayed liquidity; neither real venue settlement nor actual opponents identified','shared-information copying erases simulated edge; robust worst-case profit is not established','identity-symmetry sequential Player policy is a finite CGS instance; broader symmetry/innocence/courtesy/Nash correspondences remain unproved']};
 return full;
}
export async function collectWeatherStrategyResearch({region='nyc',now=Date.now(),fetchImpl=fetch}={}){
 const sourcePacket=await collectRelationalTemperatureScience({region,now,fetchImpl}),stations=RELATIONAL_REGIONS[region],reading=parseRelationalTemperatureCsv(sourcePacket.rawSource,{stations,availableAt:sourcePacket.source.availableAt,sourceId:sourcePacket.source.sha256});
 const study=discoverWeatherLearners(reading,{stations});return {at:new Date().toISOString(),kind:study.kind,region,stations:sourcePacket.stations,source:sourcePacket.source,rawSource:sourcePacket.rawSource,study,studyId:createHash('sha256').update(JSON.stringify({source:sourcePacket.source.sha256,specifications:study.specifications,algorithm:'nested-past-only-generators-v1',competition:{halfSpread:.01,feePerContract:.01,minEdge:.02}})).digest('hex'),orderEffect:false};
}
