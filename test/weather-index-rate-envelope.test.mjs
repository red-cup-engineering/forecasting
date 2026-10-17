import test from 'node:test';
import assert from 'node:assert/strict';
import {envelopeAt,exceedsEnvelope,yesInterval,rateEnvelopeModel,SAFETY,KIND} from '../src/weather-index-rate-envelope.mjs';
import {STRUCTURAL_KINDS,structuralBounds} from '../src/forecast-surface.mjs';

const MINUTE=60000;
const envelope={window:{firstDay:'2026-09-01',lastDay:'2026-09-30'},derivedAt:'2026-10-15T00:00:00Z',horizonsMinutes:[1,5,15,30,60],
 cities:{nyc:{horizons:{1:{maxRiseF:0.5,maxFallF:0.5},5:{maxRiseF:1.5,maxFallF:1.5},15:{maxRiseF:2.5,maxFallF:3},30:{maxRiseF:4,maxFallF:4},60:{maxRiseF:7,maxFallF:6}}}}};
const target=Date.parse('2026-10-14T14:00:00Z');
const binding={city:'nyc',targetTime:new Date(target).toISOString()};
// Readings every minute up to `last`, flat at `value`.
const flat=(last,value,minutes=180)=>Array.from({length:minutes},(_,i)=>({t:last-(minutes-1-i)*MINUTE,v:value}));

test('the envelope is read at the smallest tabulated horizon at or above the time left', () => {
  assert.deepEqual(envelopeAt('nyc',3,envelope),{horizonMinutes:5,riseF:1.5,fallF:1.5});
  assert.deepEqual(envelopeAt('nyc',0.2,envelope),{horizonMinutes:1,riseF:0.5,fallF:0.5});
  assert.equal(envelopeAt('nyc',61,envelope),null);
  assert.equal(envelopeAt('chicago',5,envelope),null);
});

test('YES intervals follow the certified 0.01F rounding of each strike type', () => {
  assert.deepEqual(yesInterval({strike_type:'greater',floor_strike:80}),[80.005,Infinity]);
  assert.deepEqual(yesInterval({strike_type:'less',cap_strike:75}),[-Infinity,74.995]);
  assert.deepEqual(yesInterval({strike_type:'between',floor_strike:76,cap_strike:77}),[75.995,77.005]);
  assert.equal(yesInterval({strike_type:'greater',floor_strike:80.0001}),null);
});

test('a strike beyond reach in the time left is decided; one within reach is left open', () => {
  const now=target-10*MINUTE,anchor=now-6*MINUTE; // 16 minutes to target from the reading -> horizon 30
  const points=flat(anchor,70);
  const reach=4*SAFETY; // 6F either way
  const no=rateEnvelopeModel({strike_type:'greater',floor_strike:70+reach+0.5},binding,points,now,envelope);
  assert.equal(no.p,0);
  assert.deepEqual(no.details.structuralProbabilityBounds,{kind:KIND,low:0,high:0});
  const yes=rateEnvelopeModel({strike_type:'greater',floor_strike:70-reach-0.5},binding,points,now,envelope);
  assert.equal(yes.p,1);
  assert.equal(rateEnvelopeModel({strike_type:'greater',floor_strike:72},binding,points,now,envelope),null);
  const between=rateEnvelopeModel({strike_type:'between',floor_strike:90,cap_strike:91},binding,points,now,envelope);
  assert.equal(between.p,0);
});

test('a stale reading, a target past the reading horizon or no reading decides nothing', () => {
  const far={strike_type:'greater',floor_strike:100};
  assert.equal(rateEnvelopeModel(far,binding,flat(target-40*MINUTE,70),target-20*MINUTE,envelope),null,'reading 20 minutes old');
  assert.equal(rateEnvelopeModel(far,binding,flat(target-90*MINUTE,70),target-85*MINUTE,envelope),null,'90 minutes exceeds the envelope');
  assert.equal(rateEnvelopeModel(far,binding,[],target-5*MINUTE,envelope),null);
});

test('recent moves beyond the envelope withdraw the bound for that city', () => {
  const now=target-10*MINUTE,anchor=now-6*MINUTE,points=flat(anchor,70);
  assert.equal(exceedsEnvelope('nyc',points,envelope),false);
  // A 2F rise inside one minute exceeds the 1-minute envelope (0.5F).
  points[points.length-30]={...points[points.length-30],v:72};
  assert.equal(exceedsEnvelope('nyc',points,envelope),true);
  assert.equal(rateEnvelopeModel({strike_type:'greater',floor_strike:100},binding,points,now,envelope),null);
});

test('the surface counts the envelope as structural knowledge', () => {
  assert.ok(STRUCTURAL_KINDS.includes(KIND));
  const now=target-10*MINUTE,model=rateEnvelopeModel({strike_type:'greater',floor_strike:100},binding,flat(now-6*MINUTE,70),now,envelope);
  assert.deepEqual(structuralBounds(model),{kind:KIND,low:0,high:0});
});

test('the reachable range is the latest reading widened by the envelope and the safety margin, and told only with a fresh anchor inside the envelope', async () => {
  const {reachableRange}=await import('../src/weather-index-rate-envelope.mjs');
  const now=target-30*MINUTE,points=flat(now-MINUTE,70);
  const range=reachableRange({city:'nyc',points,now,target,envelope});
  // 31 minutes from the anchor reads the 60 minute row: rise 7, fall 6
  assert.equal(range.low,70-6*SAFETY);assert.equal(range.high,70+7*SAFETY);assert.equal(range.horizonMinutes,60);
  assert.equal(reachableRange({city:'nyc',points,now:now+20*MINUTE,target,envelope}),null,'a stale anchor tells no bound');
  assert.equal(reachableRange({city:'chicago',points,now,target,envelope}),null,'a city without a table tells no bound');
  assert.equal(reachableRange({city:'nyc',points:[...flat(now-10*MINUTE,70,170),...flat(now-MINUTE,76,10)],now,target,envelope}),null,'readings that outran the envelope tell no bound');
});
