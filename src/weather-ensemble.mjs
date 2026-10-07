/** Linear pools preserve component distributions; no source-independence claim. */
import {studentTCdf} from './temperature-distribution.mjs';
function quantile(p){let lo=-100,hi=100;for(let i=0;i<48;i++){const m=(lo+hi)/2;if(studentTCdf(m,5)<p)lo=m;else hi=m;}return (lo+hi)/2;}
const nodes=Array.from({length:41},(_,i)=>quantile((i+.5)/41));
function components(r){return r.mixture?.components??[{weight:1,meanF:r.meanF,scaleF:r.scaleF,nu:r.nu??5}];}
export function temperatureCdf(r,x){return components(r).reduce((s,c)=>s+c.weight*studentTCdf((x-c.meanF)/c.scaleF,c.nu??5),0);}
/** Exact variance summary; the full mixture, rather than this summary, prices and scores. */
export function makeTemperaturePool(candidates){
 const selected=new Map();for(const c of candidates){if(!c.family||!Number.isFinite(c.meanF)||!Number.isFinite(c.scaleF)||c.scaleF<=0||(c.nu??5)!==5)continue;const old=selected.get(c.family);if(!old||(c.priority??0)>(old.priority??0))selected.set(c.family,c);}
 if(selected.size<2)return null;
 const members=[...selected.values()].sort((a,b)=>a.family.localeCompare(b.family)),weight=1/members.length;
 const cs=members.map(({family,model,meanF,scaleF,source,issuedAt})=>({family,model,weight,meanF,scaleF,nu:5,source,issuedAt}));
 const meanF=cs.reduce((s,c)=>s+c.weight*c.meanF,0),withinVarianceF2=cs.reduce((s,c)=>s+c.weight*c.scaleF**2*5/3,0),betweenVarianceF2=cs.reduce((s,c)=>s+c.weight*(c.meanF-meanF)**2,0);
 return {meanF,scaleF:Math.sqrt((withinVarianceF2+betweenVarianceF2)*3/5),nu:5,mixture:{kind:'student-t-family-pool-v1',components:cs},composition:cs.map(c=>c.family+':'+c.model).join('|'),withinVarianceF2,betweenVarianceF2,uncertainty:'equal weights across available forecast families; NBH replaces NBS within NBM; full mixture preserves disagreement; weights and calibration untrained'};
}
/** The affine postprocessing transform must move every component, including its separation. */
export function postprocessTemperature(r,{biasF,scaleMultiplier}){
 if(!Number.isFinite(biasF)||!Number.isFinite(scaleMultiplier)||scaleMultiplier<1)throw new TypeError('finite bias and non-narrowing spread multiplier required');
 const out={...r,meanF:r.meanF+biasF,scaleF:r.scaleF*scaleMultiplier};
 if(r.mixture)out.mixture={...r.mixture,components:r.mixture.components.map(c=>({...c,model:c.model+'/pool-postprocess-v1',meanF:r.meanF+biasF+(c.meanF-r.meanF)*scaleMultiplier,scaleF:c.scaleF*scaleMultiplier}))};
 return out;
}
/** 41 nodes per component, sorted weighted identity: O(n log n), including cross-component distance. */
export function temperatureDistributionCrps(r,observedF){
 const points=components(r).flatMap(c=>nodes.map(z=>({x:c.meanF+c.scaleF*z,w:c.weight/nodes.length}))).sort((a,b)=>a.x-b.x);
 let absolute=0,pairHalf=0,prefixWeight=0,prefixMoment=0;
 for(const p of points){absolute+=p.w*Math.abs(p.x-observedF);pairHalf+=p.w*(p.x*prefixWeight-prefixMoment);prefixWeight+=p.w;prefixMoment+=p.w*p.x;}
 return Math.max(0,absolute-pairHalf);
}
export function temperatureDiagnostics(r,y){const pit=Math.max(0,Math.min(1,temperatureCdf(r,y)));return {pit,covered90:pit>=.05&&pit<=.95,crpsF:temperatureDistributionCrps(r,y)};}

/** Pool probabilities for a common contract, preserving non-Student-t component CDFs. */
export function makeBracketProbabilityPool(candidates){
 const selected=new Map();for(const c of candidates){if(!c.family||!Number.isFinite(c.p)||c.p<0||c.p>1)continue;const old=selected.get(c.family);if(!old||(c.priority??0)>(old.priority??0))selected.set(c.family,c);}
 if(selected.size<2)return null;const weight=1/selected.size,components=[...selected.values()].sort((a,b)=>a.family.localeCompare(b.family)).map(c=>({family:c.family,model:c.id,weight,p:c.p,details:c.details}));
 return {p:components.reduce((s,c)=>s+c.weight*c.p,0),components,composition:components.map(c=>c.family+':'+c.model).join('|'),method:'equal forecast-family linear pool; probabilities for the same contract; no independence or calibration assumption'};
}
