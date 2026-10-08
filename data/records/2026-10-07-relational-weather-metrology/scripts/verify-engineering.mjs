import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseRelationalTemperatureCsv,replayRelationalTemperature,RELATIONAL_REGIONS,empiricalResidualLaw,empiricalResidualCrps} from '../../../../src/weather-relational-temperature.mjs';
import {weatherRelationalScience,weatherEvidence} from '../../../../src/weather-engine.mjs';
assert.equal(empiricalResidualCrps(empiricalResidualLaw([-1,1]),0),.5);
assert.equal(empiricalResidualCrps(empiricalResidualLaw([0]),3),3);
const base=new URL('../',import.meta.url),reports={};
for(const region of ['nyc','miami']){
 const raw=gunzipSync(await readFile(new URL(`fixtures/${region}-routine-temperature.csv.gz`,base))).toString(),source=JSON.parse(await readFile(new URL(`fixtures/${region}-source.json`,base))),stations=RELATIONAL_REGIONS[region];
 assert.equal(createHash('sha256').update(raw).digest('hex'),source.sha256);
 const reading=parseRelationalTemperatureCsv(raw,{stations,availableAt:source.availableAt,sourceId:source.sha256}),report=replayRelationalTemperature(reading,{stations,includePredictions:true});
 assert(report.predictions.length>2000);assert.equal(report.stationsWithoutReports.length,0);
 for(const r of report.predictions){assert(r.inputLastObservedAt<=r.issuedAt);assert(r.issuedAt<r.validTime);assert(r.fitBefore<=r.issuedAt);assert(r.witnesses.length>0);assert(r.truthWitnesses.length>0);}
 // An affine change of numerical temperature coordinates must commute with learning.
 const changed=structuredClone(reading);for(const r of changed.accepted)r.temperatureC=r.temperatureC*1.8+32;
 const converted=replayRelationalTemperature(changed,{stations,includePredictions:true});
 for(let i=0;i<report.predictions.length;i++)assert(Math.abs(converted.predictions[i].predictionsC.relational-(1.8*report.predictions[i].predictionsC.relational+32))<1e-8);
 for(let i=0;i<report.predictions.length;i++)assert(Math.abs(converted.predictions[i].crpsC.relational-1.8*report.predictions[i].crpsC.relational)<1e-8);
 // Independently shifting each station's reference changes anchors, not held-out errors.
 const offsets=Object.fromEntries(stations.map((s,i)=>[s,10*(i+1)])),shifted=structuredClone(reading);for(const r of shifted.accepted)r.temperatureC+=offsets[r.station];
 const gauged=replayRelationalTemperature(shifted,{stations,includePredictions:true});
 for(let i=0;i<report.predictions.length;i++)assert(Math.abs(gauged.predictions[i].predictionsC.relational-report.predictions[i].predictionsC.relational-offsets[report.predictions[i].station])<1e-8);
 // Changing later evidence cannot change earlier issued predictions or their outcomes.
 const cutoff='2026-09-15T00:00:00.000Z',later=structuredClone(reading);for(const r of later.accepted)if(r.observedAt>=cutoff)r.temperatureC+=50;
 const altered=replayRelationalTemperature(later,{stations,includePredictions:true});
 for(let i=0;i<report.predictions.length;i++)if(report.predictions[i].validTime<cutoff)assert.deepEqual(altered.predictions[i],report.predictions[i]);
 const line=raw.split('\n')[1],duplicate=parseRelationalTemperatureCsv(raw+'\n'+line+'\n',{stations,availableAt:source.availableAt,sourceId:source.sha256});
 assert.equal(duplicate.accepted.length,reading.accepted.length);assert.equal(duplicate.duplicates,reading.duplicates+1);
 const cells=line.split(',');cells[cells.length-1]=String(Number(cells.at(-1))+10);
 const conflicted=parseRelationalTemperatureCsv(raw+'\n'+cells.join(',')+'\n',{stations,availableAt:source.availableAt,sourceId:source.sha256});
 assert.equal(conflicted.conflicts.length,reading.conflicts.length+1);assert.equal(conflicted.accepted.length,reading.accepted.length-1);
 // The public science effect archives lossless source without consulting a market.
 const root=await mkdtemp(join(tmpdir(),'relational-weather-'));let requests=0;
 try{
  const result=await weatherRelationalScience({region,root,now:Date.parse('2026-10-07T14:00:00Z'),fetchImpl:async url=>{requests++;assert.equal(new URL(url).host,'mesonet.agron.iastate.edu');return new Response(raw);}});
  assert.equal(requests,1);assert.equal(result.orderEffect,false);assert.equal(result.experiment.summaries.at(-1).samples,report.summaries.at(-1).samples);
  const archived=await weatherEvidence({root,evidenceId:result.evidenceId});assert.equal(archived.rawSource,raw);assert.equal(archived.source.sha256,source.sha256);assert.equal(result.rawSource,undefined);
  await writeFile(join(root,'universe.json'),'{}');
  const replay=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('../../../../apps/replay-station-weather-science.mjs',import.meta.url)),'--archives',join(root,'evidence'),'--universe',join(root,'universe.json'),'--output',join(root,'replay')],{encoding:'utf8'}));
  assert.equal(replay.packets,0);assert.equal(replay.skipped,1);assert.equal(replay.forecasted,0);assert.equal(replay.scored,0);
 }finally{await rm(root,{recursive:true,force:true});}
 const {predictions,...savedReport}=report;await writeFile(new URL(`${region}-result.json`,base),JSON.stringify(savedReport,null,2)+'\n');
 reports[region]={sourceRows:report.sourceRows,heldout:report.summaries.at(-1),from:report.heldoutFrom,through:report.heldoutThrough};
}
const receipt={at:new Date().toISOString(),checks:['exact discrete-law CRPS witnesses','real source hashes','chronological issuance/input/fit scopes','affine unit equivariance','independent station-reference equivariance','future evidence cannot change earlier predictions','duplicate reports add witnesses, not cases','contradictions retained and withheld','lossless archive through actual science/evidence consumers','physical station replay rejects other scientific carriers','one public archive request; no market reads or orders'],reports};
await writeFile(new URL('engineering-receipt.json',base),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
