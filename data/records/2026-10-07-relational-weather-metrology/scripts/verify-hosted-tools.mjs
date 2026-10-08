import assert from 'node:assert/strict';
import {realpath,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const release=await realpath(process.env.HOME+'/.local/share/561-group/releases/cold-red-gate.561.group/current');
const {weatherNetworkSources}=await import(pathToFileURL(release+'/lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-operations-services-section/apps/group-operations/src/weather-network.mjs'));
const client=weatherNetworkSources({environment:process.env,config:{instance:{name:'relational-metrology-demonstration'}}})[0].client;
const catalog=await client.listTools();assert.equal(catalog.tools.length,11);
for(const name of ['weather_status','weather_cycle','weather_forecast','weather_evidence','weather_station_evidence','weather_station_skill','weather_index_evidence','weather_score','weather_allocate','weather_model_admit','weather_relational_science'])assert(catalog.tools.some(t=>t.name===name));
const original=globalThis.fetch,hosts=[];globalThis.fetch=(url,...args)=>{hosts.push(new URL(url).host);return original(url,...args);};
const experiments=[];
try{
 for(const region of ['nyc','miami']){
  const r=await client.call('weather_relational_science',{region});assert.equal(r.orderEffect,false);assert(r.experiment.status.startsWith('retrospective'));assert(r.experiment.summaries.at(-1).samples>2000);
  const saved=await client.call('weather_evidence',{evidenceId:r.evidenceId});assert.equal(createHash('sha256').update(saved.rawSource).digest('hex'),r.source.sha256);assert.deepEqual(saved.experiment,r.experiment);assert.deepEqual(saved.source,r.source);
  experiments.push({region,evidenceId:r.evidenceId,source:r.source,stations:r.stations,heldout:r.experiment.summaries.at(-1),retrospective:true,archiveRoundtrip:true});
 }
 assert.equal(hosts.length,2);assert(hosts.every(h=>h==='mesonet.agron.iastate.edu'));
 const health=await original('https://cold-red-gate.561.group/healthz');assert.equal(health.status,200);
 const receipt={at:new Date().toISOString(),hostRelease:release,node:process.versions.node,tools:catalog.tools.length,previousToolsRetained:true,networkHosts:hosts,kalshiReads:0,experiments,publicHealth:health.status,orderEffect:false};
 const dir=process.env.HOME+'/.local/state/561-group/weather-relational-demonstration';await mkdir(dir,{recursive:true});await writeFile(dir+'/live-tool-receipt.json',JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{globalThis.fetch=original;await client.close();}
