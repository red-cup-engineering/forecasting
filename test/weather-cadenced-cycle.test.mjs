import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {weatherCadencePlan,runCadencedWeatherCycle} from '../src/weather-engine.mjs';

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
 assert.equal(plan.lastCompletedAt,null);
 assert.equal(plan.orderEffect,false);
});

test('successful whole-venue cycle satisfies all zone slots without a redundant API request',async t=>{
 const root=fixture(t);
 writeFileSync(join(root,'latest.json'),JSON.stringify({
   at:'2026-07-15T18:30:15Z',contracts:[
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
   at:'2026-07-15T18:20:00Z',
   contracts:[{binding:{kind:'high',timeZone:'America/Chicago'}}],
 }));
 const plan=await weatherCadencePlan({root,now:when});
 assert.deepEqual(plan.dueTimeZones,['America/Kentucky/Louisville','America/New_York']);
 assert.equal(plan.shouldRun,true);
 assert.equal(plan.nextDueAt,'2026-07-15T18:35:00.000Z');
});

test('the cadence planner never overwrites the stored weather forecast',async t=>{
 const root=fixture(t),name=join(root,'latest.json');
 const saved=JSON.stringify({at:'2026-07-15T18:30:15Z',existingForecasts:[{id:'untouched'}]});
 writeFileSync(name,saved);
 await weatherCadencePlan({root,now:when});
 const {readFileSync}=await import('node:fs');
 assert.equal(readFileSync(name,'utf8'),saved);
});
