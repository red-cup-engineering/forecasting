import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {empiricalResidualLaw,parseRelationalTemperatureCsv,RELATIONAL_REGIONS} from '../../../../src/weather-relational-temperature.mjs';
import {crossEmpiricalDistance,mixtureEmpiricalCrps,discoverWeatherLearners,simulateWeatherRivals,weatherResearchGame} from '../../../../src/weather-strategy-research.mjs';
import {weatherStrategyResearch,weatherEvidence} from '../../../../src/weather-engine.mjs';
import {decodeArena} from '../../../../../../../../../../../../../../agent-computer-system-engineering-services-section/apps/agent-organization-engine/lib/gaming/src/encoding/arena.mjs';
import {strategy,strategyReport} from '../../../../../../../../../../../../../../agent-computer-system-engineering-services-section/apps/agent-organization-engine/lib/gaming/src/structuring/concurrent-game/with-symmetry/strategizing/strategy.mjs';
const base=new URL('../',import.meta.url),fixtures=new URL('../../2026-10-07-relational-weather-metrology/fixtures/',import.meta.url);
// Correct discrete mixture scoring must include cross-component energy.
const a={law:empiricalResidualLaw([-1,1]),center:0},b={law:empiricalResidualLaw([0]),center:0};assert.equal(crossEmpiricalDistance(a,b),1);
assert.equal(mixtureEmpiricalCrps([.5,.5],{absolute:[1,0],distances:[[1,1],[1,0]]}),.125);
const game=weatherResearchGame(),report=strategyReport(strategy(decodeArena(game.arena),game.strategy.plays));assert.equal(report.wellFormed,true);
assert(game.strategy.plays.some(p=>p.moves.indexOf('rival-update')<p.moves.indexOf('generate')&&p.moves.includes('generate')));
assert(game.strategy.plays.some(p=>p.moves.indexOf('generate')<p.moves.indexOf('rival-update')&&p.moves.includes('rival-update')));
for(const p of game.strategy.plays)if(p.moves.includes('publish')&&p.moves.includes('settlement'))assert(p.moves.indexOf('publish')<p.moves.indexOf('settlement'));
// Simultaneous competing uses cannot spend the same one-dollar cash twice.
const controlled=Array.from({length:3},(_,i)=>({station:'S'+i,date:'2026-10-07',issuedAt:'2026-10-07T13:00:00Z',validTime:'2026-10-07T14:00:00Z',p:.9,eventOutcome:true,rivalProbabilities:{'own-history-follower':.5,'fixed-relational-follower':.5,'adaptive-generator-follower':.5,'same-information-copy':.9}}));
const cash=simulateWeatherRivals(controlled,{cashUsd:1});for(const r of cash.reports){assert(r.maxConcurrentCashConsumedUsd<=1);if(r.rival==='same-information-copy'){assert.equal(r.trades,0);assert.equal(r.netPnlUsd,0);}else{assert.equal(r.trades,1);assert.equal(r.unfunded,2);assert(Math.abs(r.endingCashUsd-1.48)<1e-9);}}
const summaries={};
for(const region of ['nyc','miami']){
 const source=JSON.parse(await readFile(new URL(region+'-source.json',fixtures))),raw=gunzipSync(await readFile(new URL(region+'-routine-temperature.csv.gz',fixtures))).toString(),stations=RELATIONAL_REGIONS[region],reading=parseRelationalTemperatureCsv(raw,{stations,availableAt:source.availableAt,sourceId:source.sha256});
 const study=discoverWeatherLearners(reading,{stations});assert.equal(study.generatedLearners.length,6);assert.equal(study.selectionDecisions.length,37);assert.equal(study.recursiveLearner.samples,region==='nyc'?3453:2651);
 const copy=study.competition.reports.find(r=>r.rival==='same-information-copy');assert.equal(copy.trades,0);assert.equal(copy.netPnlUsd,0);
 assert.equal(study.generators[0].summary.meanDayCrpsGainC,0);assert.equal(study.generators[0].summary.improvedDates,0);
 for(const d of study.selectionDecisions){assert.equal(d.truthAvailableBefore,d.date+'T00:00:00.000Z');assert(Math.abs(Object.values(d.selectedCandidateWeights).reduce((s,w)=>s+w,0)-1)<1e-9);}
 if(region==='nyc'){
  const later=structuredClone(reading),cutoff='2026-09-15';for(const row of later.accepted)if(row.observedAt>=cutoff)row.temperatureC+=50;
  const changed=discoverWeatherLearners(later,{stations});assert.deepEqual(changed.selectionDecisions.filter(d=>d.date<cutoff),study.selectionDecisions.filter(d=>d.date<cutoff));assert.deepEqual(changed.examples.slice(0,2),study.examples.slice(0,2));
 }
 const stateRoot=await mkdtemp(join(tmpdir(),'weather-strategy-'));let requests=0;
 try{
  const hosted=await weatherStrategyResearch({region,root:stateRoot,now:Date.parse('2026-10-07T14:00:00Z'),fetchImpl:async url=>{requests++;assert.equal(new URL(url).host,'mesonet.agron.iastate.edu');return new Response(raw);}});
  assert.equal(requests,1);assert.equal(hosted.orderEffect,false);assert.equal(hosted.rawSource,undefined);assert.equal(hosted.study.generatedLearners[0].lastFrozenFits,undefined);
  const saved=await weatherEvidence({root:stateRoot,evidenceId:hosted.evidenceId});assert.equal(saved.rawSource,raw);assert.equal(saved.source.sha256,source.sha256);assert.equal(saved.study.generatedLearners[0].lastFrozenFits.length,stations.length);assert.equal(saved.study.game.strategy.plays.length,hosted.study.game.admittedPlayCount);
  const again=strategyReport(strategy(decodeArena(saved.study.game.arena),saved.study.game.strategy.plays));assert.equal(again.wellFormed,true);
 }finally{await rm(stateRoot,{recursive:true,force:true});}
 await writeFile(new URL(region+'-result.json',base),JSON.stringify(study,null,2)+'\n');summaries[region]={recursive:study.recursiveLearner,generators:study.generators.map(g=>({id:g.id,crpsC:g.summary.crpsC})),resource:study.resourceCost,copyingRival:{trades:copy.trades,pnlUsd:copy.netPnlUsd}};
}
const receipt={at:new Date().toISOString(),checks:['exact mixture CRPS cross-energy','existing gaming arena decoder and strategy judges','both rival/generation interleavings admissible','no publication after settlement arrival','cash conserved across simultaneous uses and maturity','nested weights learned only from earlier truth clocks','future data cannot change earlier generator decisions or forecasts','identical baseline is not counted as improved dates','shared-information copy removes modeled edge','actual compact tool and lossless archive consumers; no market reads/orders'],game:{...report,plays:game.strategy.plays.length},summaries};
await writeFile(new URL('engineering-receipt.json',base),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
