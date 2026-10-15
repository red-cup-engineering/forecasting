import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fitInnovation,fitHourlyBias,fitSpread,innovationWeight,innovationMean} from '../src/weather-index-innovation.mjs';
const HOUR=3600000;
// Deterministic pseudo-random sequence so the fit is reproducible.
function rng(seed){let s=seed;return()=>{s=(s*1664525+1013904223)>>>0;return s/2**32-.5;};}
test('v1 is the point gain 1, decay 3 h of the family',()=>{
 assert.equal(innovationWeight(0,{gain:1,decayHours:3}),1);
 assert.ok(Math.abs(innovationWeight(3*HOUR,{gain:1,decayHours:3})-Math.exp(-1))<1e-12);
});
test('fit recovers the gain and decay of an error process that follows them',()=>{
 const r=rng(7),rows=[];
 for(let i=0;i<4000;i++){
  const lagMs=(1+(i%12))*HOUR,innovationF=8*r(),baseMeanF=70+5*r();
  rows.push({lagMs,innovationF,baseMeanF,localHour:i%24,truthF:baseMeanF+.8*Math.exp(-lagMs/(6*HOUR))*innovationF+.3*r()});
 }
 const fit=fitInnovation(rows);
 assert.equal(fit.decayHours,6);
 assert.ok(Math.abs(fit.gain-.8)<.02,String(fit.gain));
});
test('fit never amplifies noise: zero signal gives gain near zero',()=>{
 const r=rng(11),rows=Array.from({length:2000},(_,i)=>({lagMs:(1+i%12)*HOUR,innovationF:5*r(),baseMeanF:60,localHour:0,truthF:60+r()}));
 assert.ok(Math.abs(fitInnovation(rows).gain)<.05);
});
test('fit needs at least two rows',()=>{assert.equal(fitInnovation([]),null);});
test('hourly bias is shrunk toward zero and keyed by local hour',()=>{
 const rows=Array.from({length:10},()=>({lagMs:HOUR,innovationF:0,baseMeanF:60,localHour:5,truthF:62}));
 const bias=fitHourlyBias(rows,{gain:0,decayHours:3},{priorRows:10});
 assert.equal(bias[5],1);
 assert.equal(bias[6],0);
 assert.equal(innovationMean(rows[0],{gain:0,decayHours:3},bias),61);
});
test('spread multiplier minimizes the supplied loss',()=>{
 const crps=(m,s,y)=>(s-1.5)**2;
 const fit=fitSpread([{meanF:0,scaleF:1,truthF:0}],crps);
 assert.equal(fit.multiplier,1.5);
});
test('shipped per-city fit lies inside the searched family',()=>{
 const fit=JSON.parse(readFileSync(new URL('../src/weather-index-innovation-fit.json',import.meta.url),'utf8'));
 for(const [city,c] of Object.entries(fit.cities)){
  assert.ok(c.gain>=0&&c.gain<=1.2,city);
  assert.ok([.5,1,1.5,2,3,4,6,8,12].includes(c.decayHours),city);
  assert.ok(c.rows>1000,city);
 }
 assert.deepEqual(Object.keys(fit.cities).sort(),['chicago','la-coastal','miami','nyc']);
});
