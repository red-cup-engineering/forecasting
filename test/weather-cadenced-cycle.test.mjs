import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {weatherCadencePlan,runCadencedWeatherCycle,weatherStatus,boundedWeatherStatus} from '../src/weather-engine.mjs';

const when=Date.parse('2026-07-15T18:32:00Z');
const fixture=t=>{
  const root=mkdtempSync(join(tmpdir(),'weather-cadence-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
};

test('empty research state derives local zones from the canonical temperature series roster',async t=>{
 const root=fixture(t);
 const plan=await weatherCadencePlan({root,now:when});
 assert.equal(plan.shouldRun,true);
 assert.ok(plan.dueTimeZones.includes('America/New_York'));
 assert.ok(plan.zones.some(z=>z.timeZone==='America/Phoenix'));
 assert.equal(plan.lastEvidenceAt,null);
 assert.equal(plan.orderEffect,false);
});

test('successful whole-venue cycle satisfies all zone slots without a redundant API request',async t=>{
 const root=fixture(t);
 writeFileSync(join(root,'latest.json'),JSON.stringify({
   at:'2026-07-15T18:30:40Z',collectionStartedAt:'2026-07-15T18:30:15Z',contracts:[
     {status:'active',binding:{kind:'high',timeZone:'America/New_York'}},
   ],
 }));
 const plan=await weatherCadencePlan({root,now:when});
 assert.equal(plan.shouldRun,false);
 const noNetwork={getMarkets(){throw new Error('must not make any provider request on skipped tick')}};
 const tick=await runCadencedWeatherCycle({root,now:when,client:noNetwork});
 assert.equal(tick.status,'not-due');
 assert.equal(tick.cadence.shouldRun,false);
 assert.equal(tick.orderEffect,false);
});

test('a stale whole-venue state leaves only actually due zone clocks in the decision',async t=>{
 const root=fixture(t);
 writeFileSync(join(root,'latest.json'),JSON.stringify({
   at:'2026-07-15T18:20:30Z',collectionStartedAt:'2026-07-15T18:20:00Z',
   contracts:[{binding:{kind:'high',timeZone:'America/Chicago'}}],
 }));
 const plan=await weatherCadencePlan({root,now:when});
 assert.deepEqual(plan.dueTimeZones,['America/Kentucky/Louisville','America/New_York']);
 assert.equal(plan.shouldRun,true);
 assert.equal(plan.nextDueAt,'2026-07-15T18:35:00.000Z');
});

test('the cadence planner never overwrites the stored weather forecast',async t=>{
 const root=fixture(t),name=join(root,'latest.json');
 const saved=JSON.stringify({at:'2026-07-15T18:30:40Z',collectionStartedAt:'2026-07-15T18:30:15Z',existingForecasts:[{id:'untouched'}]});
 writeFileSync(name,saved);
 await weatherCadencePlan({root,now:when});
 const {readFileSync}=await import('node:fs');
 assert.equal(readFileSync(name,'utf8'),saved);
});


test('a long collection completed after the 14:30 slot cannot retroactively satisfy it',async t=>{
 const root=fixture(t);
 writeFileSync(join(root,'latest.json'),JSON.stringify({
   at:'2026-07-15T18:31:30Z',
   collectionStartedAt:'2026-07-15T18:26:00Z',
 }));
 const r=await weatherCadencePlan({root,now:when});
 assert.equal(r.shouldRun,true);
 assert.ok(r.dueTimeZones.includes('America/New_York'));
 assert.equal(r.lastEvidenceAt,'2026-07-15T18:26:00Z');
});

test('legacy snapshot lacking source-collection start fails open for science, not a false receipt',async t=>{
 const root=fixture(t);
 writeFileSync(join(root,'latest.json'),JSON.stringify({at:'2026-07-15T18:31:30Z'}));
 const r=await weatherCadencePlan({root,now:when});
 assert.equal(r.lastEvidenceAt,null);
 assert.equal(r.shouldRun,true);
});


test('production weather-status projects oversized grades without changing source or silently claiming completeness', async t => {
  const root=fixture(t);
  const grades=Object.fromEntries(Array.from({length:4200},(_,i)=>[
    `station:${String(i).padStart(4,'0')}`,{events:1,admitted:i%2===0}
  ]));
  const original=JSON.stringify({at:'2026-10-13T17:00:00Z',collectionStartedAt:'2026-10-13T16:58:00Z',grades,contracts:[]});
  writeFileSync(join(root,'latest.json'),original);
  const status=await weatherStatus({root});
  assert.equal(Object.keys(status.grades).length,128);
  assert.deepEqual(status.gradeProjection,{
    total:4200,shown:128,omitted:4072,
    admittedPopulation:{yes:2100,no:2100,unknown:0},
    complete:false,
    selection:'last property keys in the stored source, not recency or statistical sampling',
    source:'weather-state/latest.json',
  });
  assert.equal(status.grades['station:4199'].events,1);
  assert.equal(status.grades['station:0000'],undefined);
  assert.equal(status.collectionStartedAt,'2026-10-13T16:58:00Z');
  assert.equal(readFileSync(join(root,'latest.json'),'utf8'),original);
  assert.deepEqual(Object.keys((await weatherStatus({root,maxGradeMembers:0})).grades),[]);
  assert.equal(Object.keys(boundedWeatherStatus({grades:{a:1}},128).grades).length,1);
  assert.throws(()=>boundedWeatherStatus({grades},4096),/bound/);
});
