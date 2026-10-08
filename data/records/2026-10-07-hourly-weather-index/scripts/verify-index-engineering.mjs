import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const F=new URL('../../../../',import.meta.url).pathname;
const fixtures=new URL('../fixtures/',import.meta.url).pathname;
const index=await import(pathToFileURL(F+'/src/weather-index.mjs'));
const science=await import(pathToFileURL(F+'/src/station-weather-science.mjs'));
let replayed=0,degraded=0;
for(const city of ['miami','nyc','la-coastal']){
 const packet={calibrations:JSON.parse(await readFile(fixtures+city+'-calibrations.json','utf8')),index:JSON.parse(await readFile(fixtures+city+'-index.json','utf8'))};
 const points=index.canonicalIndexPoints(packet,city,Date.now());assert(points.length>80);
 for(const p of points){const config=index.indexConfiguration(packet,city,p.t,Date.now()),actual=index.reproduceIndex(p,config);assert(Math.abs(actual-p.v)<1e-8,`${city} ${p.t}: ${actual} vs ${p.v}`);replayed++;degraded+=p.status==='degraded'?1:0;}
}
console.log(JSON.stringify({publishedMinutesReproduced:replayed,degradedMinutes:degraded}));
const city='miami',config=JSON.parse(await readFile(fixtures+'miami-calibrations.json','utf8'));
const at=Date.parse('2026-10-07T12:00:00Z'),issue=at-30*60000,packet={calibrations:config,calibrationSource:'fixture-config',indexSource:'fixture-index',index:{city,units:'fahrenheit',timeseries:[]}};
const cfg=index.indexConfiguration(packet,city,at,issue);
const point={t:at-10*60000,status:'normal',v:60,contributors:5,stations:cfg.stations.map(s=>({station_id:s.station_id,code:'ok',received_at_ms:at-8*60000,temp_f:60}))};
packet.index.timeseries=[point];assert.equal(index.canonicalIndexPoints(packet,city,at).length,1);
for(const alteration of [{receipt_basis:'backfilled'},{status:'incomplete'},{status:'unavailable'},{t:at-60000},{contributors:6},{stations:point.stations.map(s=>({...s,received_at_ms:at+60000}))}])assert.equal(index.canonicalIndexPoints({...packet,index:{...packet.index,timeseries:[{...point,...alteration}]}},city,at).length,0);
const futureConfig={...cfg,effective_at_ms:at-60*60000,published_at_ms:issue+1,city_reference_c:cfg.city_reference_c+.1};
assert.equal(index.indexConfiguration({calibrations:{city,units:'celsius',calibrations:[futureConfig]}},city,at,issue),null);
const bracket=[{strike_type:'less',cap_strike:60},{strike_type:'between',floor_strike:60,cap_strike:60},{strike_type:'greater',floor_strike:60}],distribution={meanF:60,scaleF:2.5,nu:5};
assert(Math.abs(bracket.map(b=>index.indexBracketProbability(b,distribution)).reduce((a,b)=>a+b)-1)<1e-12);
assert(index.indexBracketProbability(bracket[1],distribution)<.002,'0.01F event is not treated as an integer-degree bin');
const e={stations:[],indices:{miami:packet},local:{},guidance:null,lamp:{runtime:new Date(issue-60000).toISOString(),source:'fixture-lamp',stations:{}},observations:{}};
for(const s of cfg.stations){e.lamp.stations[s.station_id.slice(0,4)]={rows:[{validTime:new Date(at-3600000).toISOString(),temperatureF:55},{validTime:new Date(at).toISOString(),temperatureF:57},{validTime:new Date(at+3600000).toISOString(),temperatureF:59}]};}
// The canonical point is unavailable at issuance: no hindsight anchor.
assert.equal(index.indexDistributions(city,e,at,issue).length,1);
packet.index.timeseries=[{...point,t:issue-6*60000,stations:point.stations.map(s=>({...s,received_at_ms:issue-3*60000}))}];
const models=index.indexDistributions(city,e,at,issue);assert.equal(models.length,2);assert.equal(models[0].scaleF,2.5);assert(models[1].meanF>models[0].meanF);assert.equal(models[1].scaleF,models[0].scaleF);
const root=await mkdtemp('/tmp/weather-index-science-proof-');const first=await science.updateStationScience(e,{root,now:issue,sourceEvidenceId:'prospective-source'});assert(first.forecasts.some(r=>r.station==='index:miami'));
packet.index.timeseries=[{...point,t:at-60000,v:63,stations:point.stations.map(s=>({...s,temp_f:63,received_at_ms:at+60000}))},{...point,t:at+60000,v:99,stations:point.stations.map(s=>({...s,temp_f:99,received_at_ms:at+3*60000}))}];
const second=await science.updateStationScience(e,{root,now:at+16*60000,sourceEvidenceId:'subsequent-source'});assert(second.outcomes.some(r=>r.forecast.validTime===new Date(at).toISOString()));assert(second.outcomes.every(r=>r.observation.temperatureF===63),'uses latest eligible point at/before target, never a later minute');
const retry=await science.updateStationScience(e,{root,now:at+16*60000,sourceEvidenceId:'retry'});assert.equal(retry.scored,0);
const noForecast=science.stationPointForecasts(e,{now:at+16*60000});assert(noForecast.every(r=>Date.parse(r.validTime)>at+16*60000));
console.log(JSON.stringify({precisionF:.01,receiptAndAvailabilityChecks:true,noHindsightAnchor:true,fullyCorrelatedScaleF:models[0].scaleF,properTargetMinuteFallback:true,retryIdempotent:true,physicalOutcomes:second.outcomes.length}));

const {weatherContract}=await import(pathToFileURL(F+'/src/weather-universe.mjs'));
const contracts=JSON.parse(await readFile(fixtures+'current-hourly-contracts.json','utf8'));let bindings=0,compatible=0;
for(const m of contracts){const raw=JSON.parse(await readFile(fixtures+m.seriesTicker+'-series.json','utf8')),series=raw.series??raw,c=weatherContract(m,series);assert(c.binding?.kind==='index-at');assert.equal(c.binding.targetTime,'2026-10-07T12:00:00.000Z');bindings++;const packet={calibrations:JSON.parse(await readFile(fixtures+c.binding.city+'-calibrations.json','utf8'))};if(index.indexConfiguration(packet,c.binding.city,at,issue))compatible++;}
assert.equal(bindings,40);assert.equal(compatible,30);
const chicagoPacket={calibrations:JSON.parse(await readFile(fixtures+'chicago-calibrations.json','utf8')),index:JSON.parse(await readFile(fixtures+'chicago-index.json','utf8'))};assert.equal(index.indexConfiguration(chicagoPacket,'chicago',at,issue),null);assert.equal(index.canonicalIndexPoints(chicagoPacket,'chicago',at).length,0);assert.equal(index.indexConfiguration(packet,'constructor',at,issue),null);
console.log(JSON.stringify({exactContractBindings:bindings,configurationCompatible:compatible,chicagoSourceConflictExcluded:true}));
