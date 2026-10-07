/** Linear pools preserve component distributions; no source-independence claim. */
import {studentTCdf} from './temperature-distribution.mjs';
function quantile(p){let lo=-100,hi=100;for(let i=0;i<48;i++){const m=(lo+hi)/2;if(studentTCdf(m,5)<p)lo=m;else hi=m;}return (lo+hi)/2;}
const nodes=Array.from({length:41},(_,i)=>quantile((i+.5)/41));
function components(r){return r.mixture?.components??[{...r,weight:1,nu:r.nu??5}];}
function empiricalPoints(c){const a=c.empirical?.pointsF;if(!Array.isArray(a)||!a.length||a.some(x=>!Number.isFinite(x)))throw new TypeError('nonempty finite empirical atoms required');return a;}
export function temperatureCdf(r,x,{left=false}={}){return components(r).reduce((s,c)=>s+c.weight*(c.empirical?empiricalPoints(c).filter(v=>left?v<x:v<=x).length/c.empirical.pointsF.length:studentTCdf((x-c.meanF)/c.scaleF,c.nu??5)),0);}
/** Exact variance summary; the full mixture, rather than this summary, prices and scores. */
export function makeTemperaturePool(candidates,{familyWeights}={}){
 const selected=new Map();for(const c of candidates){if(!c.family||!Number.isFinite(c.meanF)||!Number.isFinite(c.scaleF)||c.scaleF<=0||(c.nu??5)!==5)continue;const old=selected.get(c.family);if(!old||(c.priority??0)>(old.priority??0))selected.set(c.family,c);}
 if(selected.size<2)return null;
 const members=[...selected.values()].sort((a,b)=>a.family.localeCompare(b.family)),weight=1/members.length;
 const total=familyWeights?members.reduce((s,c)=>s+familyWeights[c.family],0):1;
 if(familyWeights&&(!Number.isFinite(total)||total<=0||members.some(c=>!Number.isFinite(familyWeights[c.family])||familyWeights[c.family]<0)))throw new TypeError('nonnegative finite weights required for every selected forecast family');
 const cs=members.map(({family,model,meanF,scaleF,source,issuedAt,empirical})=>({family,model,weight:familyWeights?familyWeights[family]/total:weight,meanF,scaleF,nu:5,source,issuedAt,...(empirical?{empirical}:{})}));
 const meanF=cs.reduce((s,c)=>s+c.weight*c.meanF,0),withinVarianceF2=cs.reduce((s,c)=>s+c.weight*(c.empirical?empiricalPoints(c).reduce((s,x)=>s+(x-c.meanF)**2,0)/c.empirical.pointsF.length:c.scaleF**2*5/3),0),betweenVarianceF2=cs.reduce((s,c)=>s+c.weight*(c.meanF-meanF)**2,0);
 return {meanF,scaleF:Math.sqrt((withinVarianceF2+betweenVarianceF2)*3/5),nu:5,mixture:{kind:cs.some(c=>c.empirical)?'mixed-law-family-pool-v2':'student-t-family-pool-v1',components:cs},composition:cs.map(c=>c.family+':'+c.model).join('|'),withinVarianceF2,betweenVarianceF2,uncertainty:familyWeights?'learned family weights; NBH replaces NBS within NBM; full mixture preserves disagreement; calibration and forecast gain unproven':'equal weights across available forecast families; NBH replaces NBS within NBM; full mixture preserves disagreement; weights and calibration untrained'};
}
/** The affine postprocessing transform must move every component, including its separation. */
export function postprocessTemperature(r,{biasF,scaleMultiplier}){
 if(!Number.isFinite(biasF)||!Number.isFinite(scaleMultiplier)||scaleMultiplier<1)throw new TypeError('finite bias and non-narrowing spread multiplier required');
 const out={...r,meanF:r.meanF+biasF,scaleF:r.scaleF*scaleMultiplier};
 if(r.empirical)out.empirical={...r.empirical,pointsF:empiricalPoints(r).map(x=>out.meanF+(x-r.meanF)*scaleMultiplier)};
 if(r.mixture)out.mixture={...r.mixture,components:r.mixture.components.map(c=>({...c,model:c.model+'/pool-postprocess-v1',meanF:r.meanF+biasF+(c.meanF-r.meanF)*scaleMultiplier,scaleF:c.scaleF*scaleMultiplier,...(c.empirical?{empirical:{...c.empirical,pointsF:empiricalPoints(c).map(x=>out.meanF+(x-r.meanF)*scaleMultiplier)}}:{})}))};
 return out;
}
/** 41 nodes per component, sorted weighted identity: O(n log n), including cross-component distance. */
export function temperatureDistributionCrps(r,observedF){
 const points=components(r).flatMap(c=>c.empirical?empiricalPoints(c).map(x=>({x,w:c.weight/c.empirical.pointsF.length})):nodes.map(z=>({x:c.meanF+c.scaleF*z,w:c.weight/nodes.length}))).sort((a,b)=>a.x-b.x);
 let absolute=0,pairHalf=0,prefixWeight=0,prefixMoment=0;
 for(const p of points){absolute+=p.w*Math.abs(p.x-observedF);pairHalf+=p.w*(p.x*prefixWeight-prefixMoment);prefixWeight+=p.w;prefixMoment+=p.w*p.x;}
 return Math.max(0,absolute-pairHalf);
}
export function temperatureDiagnostics(r,y,{tieUniform=.5}={}){const upper=Math.max(0,Math.min(1,temperatureCdf(r,y))),discrete=components(r).some(c=>c.empirical),lower=discrete?Math.max(0,Math.min(upper,temperatureCdf(r,y,{left:true}))):upper;if(!Number.isFinite(tieUniform)||tieUniform<0||tieUniform>1)throw new TypeError('PIT tie position in [0,1] required');return {pit:lower+tieUniform*(upper-lower),...(discrete?{pitInterval:[lower,upper],pitMethod:'seeded randomized PIT within atom CDF interval; no independent-time calibration guarantee'}:{}),covered90:upper>=.05&&lower<=.95,crpsF:temperatureDistributionCrps(r,y)};}

/** Pool probabilities for a common contract, preserving non-Student-t component CDFs. */
export function makeBracketProbabilityPool(candidates){
 const selected=new Map();for(const c of candidates){if(!c.family||!Number.isFinite(c.p)||c.p<0||c.p>1)continue;const old=selected.get(c.family);if(!old||(c.priority??0)>(old.priority??0))selected.set(c.family,c);}
 if(selected.size<2)return null;const weight=1/selected.size,components=[...selected.values()].sort((a,b)=>a.family.localeCompare(b.family)).map(c=>({family:c.family,model:c.id,weight,p:c.p,details:c.details}));
 return {p:components.reduce((s,c)=>s+c.weight*c.p,0),components,composition:components.map(c=>c.family+':'+c.model).join('|'),method:'equal forecast-family linear pool; probabilities for the same contract; no independence or calibration assumption'};
}
