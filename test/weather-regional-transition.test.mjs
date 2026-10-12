import test from 'node:test';
import assert from 'node:assert/strict';
import {regionalThermalTransition} from '../src/weather-relational-temperature.mjs';

const now='2026-10-11T20:06:00Z',atBefore='2026-10-11T19:00:00Z';
const stations=['JFK','LGA','EWR','HPN'];
const mark=(station,hour,temperatureF,availableAt=atBefore)=>({
  station,observedAt:'2026-10-11T'+String(hour).padStart(2,'0')+':45:00Z',
  availableAt,temperatureC:(temperatureF-32)*5/9,
  witnesses:[{sourceId:'iem-request',row:hour*10+stations.indexOf(station)}],
});
function reading(previous=[80,80,80,80],next=[85,84,85,83],{arrival=atBefore,conflicts=[]}={}){
 return {accepted:stations.flatMap((station,i)=>[
    mark(station,18,previous[i],arrival),mark(station,19,next[i],arrival)
 ]),conflicts};
}
const detect=(read,opts={})=>regionalThermalTransition(read,{stations,region:'nyc',now,...opts});

test('common warming is a witnessed physical event, not a market outcome proof',()=>{
 const r=detect(reading());
 assert.equal(r.status,'regional-transition-observed');
 assert.equal(r.direction,'warming');
 assert.deepEqual(r.coherentStations,['JFK','LGA','EWR','HPN']);
 assert.equal(r.stationCoverage,4);
 assert.equal(r.stationSteps.length,4);
 assert.ok(r.stationSteps.every(x=>x.witnesses.length===2));
 assert.equal(r.observedBin,'2026-10-11T20:00:00.000Z');
 assert.equal(r.previousBin,'2026-10-11T19:00:00.000Z');
 assert.equal(r.tradeEligible,false);
 assert.equal(r.orderEffect,false);
});

test('synchronous cooling is detected separately from any future daily-high ceiling',()=>{
 const r=detect(reading([88,90,89,87],[78,78,77,80]));
 assert.equal(r.direction,'cooling');
 assert.equal(r.coherentStations.length,4);
 assert.ok(r.meaning.includes('never a necessary or impossible settlement conclusion'));
});

test('discordant stations are preserved rather than smoothed into a regional mean',()=>{
 const r=detect(reading([80,80,80,80],[85,84,85,72]));
 assert.equal(r.direction,'warming');
 assert.deepEqual(r.coherentStations,['JFK','LGA','EWR']);
 assert.deepEqual(r.disagreement,['HPN']);
 assert.ok(r.stationSteps.find(x=>x.station==='HPN').deltaF<0);
});

test('a two-versus-two front is not a coherent regional direction with default quorum',()=>{
 const r=detect(reading([80,80,80,80],[87,85,75,73]));
 assert.equal(r.status,'mixed-or-below-threshold');
 assert.equal(r.direction,null);
 assert.deepEqual(r.coherentStations,[]);
 assert.equal(r.quorum,3);
});

test('one station spike cannot stand in for regional evidence',()=>{
 const r=detect(reading([80,80,80,80],[96,81,79,80]));
 assert.equal(r.status,'mixed-or-below-threshold');
 assert.equal(r.direction,null);
});

test('future-published reports are withheld from past issuance',()=>{
 const r=detect(reading([80,80,80,80],[85,85,85,85],{arrival:'2026-10-11T22:00:00Z'}));
 assert.equal(r.status,'missing-current-comparable-bin');
 assert.equal(r.stationSteps,undefined);
});

test('conflicting station report withdraws that station rather than voting both ways',()=>{
 const conflict=mark('JFK',19,92);
 const x=reading([80,80,80,80],[85,86,84,83],{conflicts:[{key:'JFK/19:45',witnesses:[conflict,{...conflict,temperatureC:5}]}]});
 const r=detect(x);
 assert.equal(r.stationCoverage,3);
 assert.deepEqual(r.excludedStations,['JFK']);
 assert.deepEqual(r.coherentStations,['LGA','EWR','HPN']);
});

test('incomplete station bins cannot be silently interpolated or counted toward quorum',()=>{
 const x=reading();
 x.accepted=x.accepted.filter(r=>!(r.station==='JFK'||r.station==='EWR')||r.observedAt.includes('18:45'));
 const r=detect(x);
 assert.equal(r.status,'insufficient-station-coverage');
 assert.equal(r.stationCoverage,2);
 assert.deepEqual(r.excludedStations,['JFK','EWR']);
});

test('old reports cannot be used as an apparent current regional front',()=>{
 const x=reading();
 const r=regionalThermalTransition(x,{stations,region:'nyc',now:'2026-10-12T02:00:00Z'});
 assert.equal(r.status,'missing-current-comparable-bin');
});

test('report order does not affect the physical signal',()=>{
 const a=reading(),b={...a,accepted:a.accepted.slice().reverse()};
 assert.deepEqual(detect(a),detect(b));
});

test('invalid reporting or quorum contract cannot emit a threshold crossing',()=>{
 assert.throws(()=>detect(reading(),{thresholdF:0}),TypeError);
 assert.throws(()=>detect(reading(),{quorum:1}),RangeError);
 assert.throws(()=>detect(reading(),{quorum:6}),RangeError);
 assert.throws(()=>detect({accepted:[]}),TypeError);
});
