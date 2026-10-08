import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {adaptiveTemperaturePool,FAMILY_LEARNING_PROTOCOL} from '../../../../src/weather-family-learning.mjs';
import {makeTemperaturePool,temperatureDistributionCrps,temperatureCdf} from '../../../../src/weather-ensemble.mjs';
const issue=Date.parse('2026-10-07T18:30:00Z'),iso=t=>new Date(t).toISOString();
const atom=(family,x)=>({family,model:family+'-forecast-v1',meanF:x,scaleF:.001,nu:5,empirical:{pointsF:[x]},source:'controlled-fixture',issuedAt:iso(issue-3600000)});
const base={...makeTemperaturePool([atom('a',0),atom('b',10)]),model:'controlled-family-pool-v1',station:'TEST',horizon:'0-3h',validTime:iso(issue+1800000),availableAt:iso(issue),truth:'controlled exact scalar outcome',date:'2026-10-07'};
const row=(c,date,n=1,gain=c.family==='a'?-2.5:7.5)=>({station:base.station,pool:base.model,horizon:base.horizon,composition:base.composition,truth:base.truth,date,n,gainSum:gain*n,component:c.model,family:c.family,scoreAvailableAt:iso(issue-1000),sourceEvidenceId:'controlled-past-case'});
const state={at:iso(issue-100),comparisons:Object.fromEntries(base.mixture.components.map(c=>[c.family,row(c,'2026-10-06')]))};
const empty=adaptiveTemperaturePool(base,{}, {now:issue});assert.deepEqual(empty.learning.weights,{a:.5,b:.5});
const learned=adaptiveTemperaturePool(base,state,{now:issue});assert(learned.learning.weights.a>.5);assert(learned.learning.weights.b>=.05);assert.equal(learned.learning.matchedDates,1);assert.equal(learned.learning.matchedSamples,1);assert.equal(learned.comparators[0].model,base.model);assert.equal(learned.tradeEligible,false);
assert.equal(temperatureCdf(learned,0),learned.learning.weights.a);assert.equal(temperatureCdf(learned,-1),0);assert.equal(temperatureCdf(learned,10),1);assert.equal(learned.mixture.components[0].empirical.pointsF[0],0);assert(Math.abs(temperatureDistributionCrps(learned,0)-10*learned.learning.weights.b**2)<1e-10);assert.equal(learned.meanF,10*learned.learning.weights.b);
for(const mutation of [s=>s.at=iso(issue+1),s=>s.comparisons.b.n=2,s=>s.comparisons.b.composition='different',s=>s.comparisons.b.scoreAvailableAt=iso(issue+1),s=>s.comparisons.b.configurationVersion='different',s=>s.comparisons.b.date='invalid',s=>{for(const r of Object.values(s.comparisons))r.date='2026-08-01';}]){const s=structuredClone(state);mutation(s);assert.equal(adaptiveTemperaturePool(base,s,{now:issue}).learning.matchedDates,0);}
const repeated=structuredClone(state);for(const r of Object.values(repeated.comparisons)){r.n*=100;r.gainSum*=100;}assert.deepEqual(adaptiveTemperaturePool(base,repeated,{now:issue}).learning.weights,learned.learning.weights);
assert.throws(()=>makeTemperaturePool(base.mixture.components,{familyWeights:{a:1,b:NaN}}));assert.throws(()=>makeTemperaturePool(base.mixture.components,{familyWeights:{a:1,b:-1}}));
const simulation={at:null,comparisons:{}},losses=[];
for(let d=0;d<60;d++){
 const t=Date.parse('2026-08-01T12:00:00Z')+d*86400000,date=iso(t).slice(0,10),forecast={...base,availableAt:iso(t),validTime:iso(t+3600000),date};
 const learned=adaptiveTemperaturePool(forecast,simulation,{now:t});const y=d<30?0:10,uniformLoss=temperatureDistributionCrps(base,y),adaptiveLoss=temperatureDistributionCrps(learned,y);losses.push({date,y,uniformLoss,adaptiveLoss,weights:learned.learning.weights});
 for(const c of base.mixture.components)simulation.comparisons[c.family+'/'+date]={...row(c,date),gainSum:temperatureDistributionCrps(c,y)-uniformLoss,scoreAvailableAt:iso(t+3600000)};
 simulation.at=iso(t+3600000);
}
const uniformCrps=losses.reduce((s,r)=>s+r.uniformLoss,0)/60,adaptiveCrps=losses.reduce((s,r)=>s+r.adaptiveLoss,0)/60;assert(adaptiveCrps<uniformCrps);
const observed=JSON.parse(await readFile(new URL('../../2026-10-07-joint-weather-index/first-outcomes.json',import.meta.url),'utf8'));
const realFits=observed.outcomes.filter(o=>o.forecast.mixture).map(o=>{
 const b=o.forecast,s={at:observed.at,comparisons:Object.fromEntries(b.mixture.components.map(c=>[c.family,{station:b.station,pool:b.model,horizon:b.horizon,composition:b.composition,truth:b.truth,configurationVersion:b.details.configVersion,date:b.date,n:1,gainSum:temperatureDistributionCrps(c,o.observation.temperatureF)-o.crpsF,component:c.model,family:c.family,scoreAvailableAt:observed.at,sourceEvidenceId:observed.evidenceId}]))};
 const future={...b,availableAt:iso(issue),validTime:iso(issue+1800000)},fit=adaptiveTemperaturePool(future,s,{now:issue});
 return {station:b.station,observedTarget:b.validTime,receivedAt:observed.at,configurationVersion:b.details.configVersion,weights:fit.learning.weights,matchedDates:fit.learning.matchedDates,interpretation:'fit diagnostic from a received real case; future forecast means here are a fixture, not a published weather forecast or skill result'};
});assert.equal(realFits.length,3);assert(realFits.every(r=>r.matchedDates===1));
console.log(JSON.stringify({protocol:FAMILY_LEARNING_PROTOCOL,uniformInitialization:true,fullAtomLawPreserved:true,closedFormCrpsVerified:true,sameOutcomeMatching:true,futureReceiptsExcluded:true,configurationIsolation:true,unmatchedCountsExcluded:true,perDateWeighting:true,oldWindowExcluded:true,baselineComparatorFrozen:true,tradeEligible:false,syntheticRegimeShift:{days:60,uniformCrps,adaptiveCrps,interpretation:'controlled sequential simulation; no real forecast skill or alpha claim'},realPastCaseFitDiagnostics:realFits,orderEffect:false}));
