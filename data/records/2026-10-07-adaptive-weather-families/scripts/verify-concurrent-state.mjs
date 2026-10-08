import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir,rm} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
const f=(await readFile('/tmp/weather-forecasting-root','utf8')).trim(),enginePath=f+'/src/weather-engine.mjs',probePath=f+'/src/.weather-concurrency-probe-'+process.pid+'.mjs',root=await mkdtemp('/tmp/weather-concurrent-state-');
try {
 await writeFile(probePath,(await readFile(enginePath,'utf8'))+'\nexport {archiveWeatherEvidence};\n',{flag:'wx'});
 const {archiveWeatherEvidence,weatherEvidence}=await import(pathToFileURL(probePath)),{stationPointForecasts}=await import(pathToFileURL(f+'/src/station-weather-science.mjs'));
 const evidence=JSON.parse(gunzipSync(await readFile('/tmp/weather-second-source.json.gz'))),state=JSON.parse(await readFile('/tmp/weather-paired-learning-state.json','utf8'));
 delete evidence.science;delete evidence.sourceEvidenceId;
 await mkdir(root+'/station-science');
 const original=JSON.stringify(state),lock=JSON.stringify({pid:process.pid,start:(await readFile('/proc/'+process.pid+'/stat','utf8')).split(') ')[1].split(' ')[19],at:Date.now()});
 await writeFile(root+'/station-science/state.json',original);await writeFile(root+'/station-science/cycle.lock',lock);
 const id=await archiveWeatherEvidence(evidence,root),packet=await weatherEvidence({root,evidenceId:id});
 assert.match(packet.science.status,/read-only publication/);assert.equal(packet.science.learningStateAt,state.at);assert.equal(await readFile(root+'/station-science/state.json','utf8'),original);assert.equal(await readFile(root+'/station-science/cycle.lock','utf8'),lock);
 const adaptive=packet.science.forecasts.filter(x=>x.model.endsWith('/paired-family-ewa-v1')),learned=adaptive.filter(x=>x.learning.matchedDates>0),cold=stationPointForecasts(evidence,{parameters:state.parameters??{}}).filter(x=>x.model.endsWith('/paired-family-ewa-v1'));
 assert.ok(learned.length>0);assert.ok(cold.every(x=>x.learning.matchedDates===0));assert.equal(packet.science.outcomes.length,0);
 console.log(JSON.stringify({status:packet.science.status,learningStateAt:state.at,forecastCount:packet.science.forecasts.length,adaptiveFamilies:adaptive.length,retainedLearnedFamilies:learned.length,oldFallbackLearnedFamilies:0,learningStateUnchanged:true,writerLockUnchanged:true,outcomesAppended:0,evidenceId:id,scope:'controlled live writer lock in a temporary root, using observed host evidence and last atomic learning state',orderEffect:false}));
} finally {await rm(probePath,{force:true});await rm(root,{recursive:true,force:true});}
