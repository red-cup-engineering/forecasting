import test from 'node:test';
import assert from 'node:assert/strict';
import {makeTemperaturePool} from '../src/weather-ensemble.mjs';
import {fixedShareFamilyWeights,adaptiveTemperaturePool,FAMILY_LEARNING_PROTOCOL} from '../src/weather-family-learning.mjs';

const close=(a,b,eps=1e-12)=>assert.ok(Math.abs(a-b)<eps,`${a} differs from ${b}`);
const day=(date,a,b)=>({date,losses:{a,b}});

test('matched-date fixed-share starts uniformly and stays on the probability simplex',()=>{
 const initial=fixedShareFamilyWeights(['a','b'],[]);
 close(initial.a,.5);close(initial.b,.5);
 const weights=fixedShareFamilyWeights(['a','b'],[day('2026-10-12',-1000,1000),day('2026-10-13',1000,-1000)]);
 close(weights.a+weights.b,1);
 assert.ok(weights.a>=FAMILY_LEARNING_PROTOCOL.uniformShare/2);
 assert.ok(weights.b>=FAMILY_LEARNING_PROTOCOL.uniformShare/2);
 assert.ok(Object.values(weights).every(Number.isFinite));
});

test('common same-day CRPS comparator subtraction never changes the weights',()=>{
 const base=[day('2026-10-12',2,4),day('2026-10-13',5,3)];
 const shifted=base.map(d=>({date:d.date,losses:{a:d.losses.a-9,b:d.losses.b-9}}));
 const a=fixedShareFamilyWeights(['a','b'],base),b=fixedShareFamilyWeights(['a','b'],shifted);
 close(a.a,b.a);close(a.b,b.b);
});

test('loss advantage changes across weather regimes without permanent weight lock-in',()=>{
 const aGood=Array.from({length:7},(_,i)=>day(`2026-10-${String(i+1).padStart(2,'0')}`,0,3));
 const bGood=Array.from({length:3},(_,i)=>day(`2026-10-${String(i+8).padStart(2,'0')}`,3,0));
 const morning=fixedShareFamilyWeights(['a','b'],aGood);
 const evening=fixedShareFamilyWeights(['a','b'],[...aGood,...bGood]);
 assert.ok(morning.a>.9);
 assert.ok(evening.b>.9);
 close(evening.a+evening.b,1);
});

test('duplicate, future-order, incomplete or nonfinite dated losses are refused',()=>{
 const input=[
  [day('2026-10-11',1,2),day('2026-10-11',2,3)],
  [day('2026-10-12',1,2),day('2026-10-11',2,3)],
  [{date:'2026-10-11',losses:{a:1}}],
  [{date:'2026-10-11',losses:{a:Infinity,b:0}}],
 ];
 for(const days of input)assert.throws(()=>fixedShareFamilyWeights(['a','b'],days),TypeError);
 assert.throws(()=>fixedShareFamilyWeights(['a','a'],[]),TypeError);
 assert.throws(()=>fixedShareFamilyWeights(['a','b'],[],{uniformShare:2}),TypeError);
});

const makeBase=()=>{
 const members=[
  {family:'a',model:'a-v1',meanF:72,scaleF:2,nu:5,issuedAt:'2026-10-14T10:00:00Z'},
  {family:'b',model:'b-v1',meanF:73,scaleF:2,nu:5,issuedAt:'2026-10-14T10:00:00Z'},
 ];
 return {...makeTemperaturePool(members),model:'station-family-pool-v1',station:'KSEA',horizon:'0-3h',
  availableAt:'2026-10-14T12:00:00Z'};
};
const pair=(base,date,family,gain,scoreAvailableAt='2026-10-13T10:00:00Z')=>({
 date,station:base.station,pool:base.model,horizon:base.horizon,composition:base.composition,
 family,component:family+'-v1',truth:'NWS station observations',configurationVersion:null,
 n:2,gainSum:gain*2,scoreAvailableAt,sourceEvidenceId:'source-'+family,
});

test('actual paired science carrier yields one source-bound, non-tradeable fixed-share forecast',()=>{
 const base=makeBase(),state={at:'2026-10-14T12:00:00Z',comparisons:{
  a:pair(base,'2026-10-12','a',2),b:pair(base,'2026-10-12','b',-2),
 }};
 const learned=adaptiveTemperaturePool(base,state,{now:Date.parse('2026-10-14T12:01:00Z')});
 assert.ok(learned);
 assert.equal(learned.model,'station-family-pool-v1/paired-family-fixed-share-v2');
 assert.equal(learned.tradeEligible,false);
 assert.equal(learned.learning.matchedDates,1);
 assert.ok(learned.learning.weights.b>learned.learning.weights.a);
 close(learned.learning.weights.a+learned.learning.weights.b,1);
 assert.ok(learned.learning.witnesses[0].components.every(c=>c.sourceEvidenceId));
});

test('future source receipt, unmatched family or duplicate paired witness grants no learnt advantage',()=>{
 const base=makeBase(),now=Date.parse('2026-10-14T12:01:00Z');
 const pending=pair(base,'2026-10-12','b',-2,'2026-10-14T12:02:00Z');
 const state={at:'2026-10-14T12:00:00Z',comparisons:{
  a:pair(base,'2026-10-12','a',2),b:pending,
 }};
 const r=adaptiveTemperaturePool(base,state,{now});
 assert.equal(r.learning.matchedDates,0);
 close(r.learning.weights.a,.5);
 close(r.learning.weights.b,.5);
 const dup=adaptiveTemperaturePool(base,{...state,comparisons:{...state.comparisons,
  b:pair(base,'2026-10-12','b',-2),duplicate:pair(base,'2026-10-12','b',-2),
 }},{now});
 assert.equal(dup.learning.matchedDates,0);
});
