import test from 'node:test';
import assert from 'node:assert/strict';
import {planWeatherReasoningCadence,WEATHER_REASONING_CADENCE} from '../src/weather-reasoning-cadence.mjs';

const NY='America/New_York',CHI='America/Chicago',LA='America/Los_Angeles';
const PHX='America/Phoenix',DEN='America/Denver';
const plan=(when,zones=[NY],other={})=>planWeatherReasoningCadence({now:when,timeZones:zones,...other});
const zone=(r,name)=>r.zones.find(z=>z.timeZone===name);

test('hourly baseline uses IANA local HH:00, not one globally assumed UTC hour',()=>{
 const a=plan('2026-07-15T17:00:00Z'); // 13:00 EDT
 assert.equal(a.shouldRun,true);
 assert.equal(a.zones[0].cadenceMinutes,60);
 assert.equal(a.zones[0].focused,false);
 assert.equal(a.zones[0].localTime,'13:00');
 const b=plan('2026-07-15T17:30:00Z'); // 13:30 EDT
 assert.equal(b.shouldRun,false);
 assert.equal(b.zones[0].nextDueAt,'2026-07-15T18:00:00.000Z');
});

test('peak starts at 14:30 and ends at 17:30, inclusive; the next ordinary slot is 18:00',()=>{
 const early=plan('2026-07-15T18:25:00Z');
 assert.equal(early.shouldRun,false);
 assert.equal(early.nextDueAt,'2026-07-15T18:30:00.000Z');
 const start=plan('2026-07-15T18:30:00Z');
 assert.equal(start.shouldRun,true);
 assert.equal(start.zones[0].focused,true);
 assert.equal(start.zones[0].cadenceMinutes,5);
 const middle=plan('2026-07-15T18:35:00Z');
 assert.equal(middle.shouldRun,true);
 assert.equal(middle.zones[0].localTime,'14:35');
 const finish=plan('2026-07-15T21:30:00Z');
 assert.equal(finish.shouldRun,true);
 assert.equal(finish.zones[0].localTime,'17:30');
 assert.equal(finish.nextDueAt,'2026-07-15T22:00:00.000Z');
 const later=plan('2026-07-15T21:35:00Z');
 assert.equal(later.shouldRun,false);
 assert.equal(later.zones[0].focused,false);
});

test('each local time zone enters its own peak, never switching every market together',()=>{
 const r=plan('2026-07-15T18:30:00Z',[NY,CHI,LA,PHX,DEN]);
 assert.deepEqual(r.dueTimeZones,[NY]);
 assert.equal(zone(r,NY).localTime,'14:30');
 assert.equal(zone(r,CHI).localTime,'13:30');
 assert.equal(zone(r,LA).localTime,'11:30');
 assert.equal(zone(r,DEN).localTime,'12:30');
 assert.equal(zone(r,PHX).localTime,'11:30');
 assert.equal(zone(r,CHI).cadenceMinutes,60);
 assert.equal(zone(r,LA).focused,false);
});

test('DST spring/fall transitions are handled by IANA zones, Phoenix never shifts',()=>{
 assert.equal(plan('2026-03-08T18:30:00Z').zones[0].localTime,'14:30');
 assert.equal(plan('2026-11-02T19:30:00Z').zones[0].localTime,'14:30');
 assert.equal(plan('2026-07-15T21:30:00Z',[PHX]).zones[0].localTime,'14:30');
 assert.equal(plan('2026-01-15T21:30:00Z',[PHX,DEN]).zones[0].localTime,'14:30');
 const july=plan('2026-07-15T21:30:00Z',[DEN,PHX]);
 assert.equal(zone(july,PHX).localTime,'14:30');
 assert.equal(zone(july,DEN).localTime,'15:30');
 assert.equal(zone(july,DEN).focused,true);
});

test('half-hour/quarter-hour UTC offsets still honor local slot boundaries',()=>{
 const r=plan('2026-07-15T08:45:00Z',['Asia/Kathmandu']);
 assert.equal(r.zones[0].localTime,'14:30');
 assert.equal(r.zones[0].focused,true);
 assert.equal(r.shouldRun,true);
});

test('duplicate aliases share one zone schedule but distinct named zones may be retained',()=>{
 const r=plan('2026-07-15T18:30:00Z',[NY,NY,'America/Kentucky/Louisville']);
 assert.equal(r.zones.length,2);
 assert.equal(r.dueTimeZones.length,2);
 assert.ok(r.dueTimeZones.includes('America/Kentucky/Louisville'));
});

test('a repeated cron tick is idempotent within its five-minute slot',()=>{
 const p=plan('2026-07-15T18:32:00Z',[NY]);
 assert.equal(p.slotAt,'2026-07-15T18:30:00.000Z');
 assert.equal(p.shouldRun,true);
 const q=plan('2026-07-15T18:32:00Z',[NY],{lastCompletedAt:'2026-07-15T18:30:30Z'});
 assert.equal(q.shouldRun,false);
 assert.equal(q.zones[0].alreadyCompleted,true);
 const next=plan('2026-07-15T18:35:00Z',[NY],{lastCompletedAt:'2026-07-15T18:30:30Z'});
 assert.equal(next.shouldRun,true);
});

test('a targeted zone receipt never improperly acknowledges a different zone',()=>{
 const r=plan('2026-07-15T21:32:00Z',[LA,PHX],{
  lastCompletedAt:'2026-07-15T21:30:20Z',
  lastCompletedByZone:{[LA]:'2026-07-15T21:25:00Z'},
 });
 assert.equal(zone(r,PHX).due,false); // Global collection actually included Phoenix.
 assert.equal(zone(r,LA).due,true);   // Explicit zone receipt overrides the global.
});

test('missed slots are not replayed as separate weather forecast samples',()=>{
 const p=plan('2026-07-15T19:01:00Z',[NY],{lastCompletedAt:'2026-07-14T00:00:00Z'});
 assert.equal(p.slotAt,'2026-07-15T19:00:00.000Z');
 assert.equal(p.dueTimeZones.length,1);
 assert.equal(p.zones.length,1);
 assert.equal(p.nextDueAt,'2026-07-15T19:05:00.000Z');
});

test('unrecognized time zone and misaligned or reversed windows fail closed',()=>{
 assert.throws(()=>plan('2026-07-15T18:30:00Z',['not/a/timezone']),RangeError);
 assert.throws(()=>plan('bad'),TypeError);
 assert.throws(()=>plan('2026-07-15T18:30:00Z',[]),TypeError);
 assert.throws(()=>plan('2026-07-15T18:30:00Z',[NY],{
  policy:{...WEATHER_REASONING_CADENCE,focusStart:'17:30',focusEnd:'14:30'},
 }),RangeError);
 assert.throws(()=>plan('2026-07-15T18:30:00Z',[NY],{
  policy:{...WEATHER_REASONING_CADENCE,focusStart:'14:31'},
 }),TypeError);
 assert.throws(()=>plan('2026-07-15T18:30:00Z',[NY],{
  lastCompletedAt:'2026-07-16T00:00:00Z',
 }),RangeError);
});
