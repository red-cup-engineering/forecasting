import assert from 'node:assert/strict';
import {realpath,readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const root=process.env.HOME+'/.local/state/561-group/settlements/kalshi-services-section/weather',dir=process.env.HOME+'/.local/state/561-group/weather-same-day-rain',deadline=Date.now()+20*60000;
const house=await realpath(process.env.HOME+'/.local/share/561-group/releases/cold-red-gate.561.group/current'),{weatherNetworkSources}=await import(pathToFileURL(house+'/lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-operations-services-section/apps/group-operations/src/weather-network.mjs'));
const client=weatherNetworkSources({environment:process.env,config:{instance:{name:'same-day-rain-publication-receiver'}}})[0].client;
const cycle=await client.call('weather_cycle',{});assert(!cycle.isError,JSON.stringify(cycle));console.log(JSON.stringify({cycle,route:'existing native weather_cycle; shared house and service configuration unchanged'}));
let state;while(Date.now()<deadline){state=JSON.parse(await readFile(root+'/latest.json','utf8'));if(Date.parse(state.at)>Date.parse(cycle.startedAt??'2026-10-07T22:02:04Z'))break;await new Promise(r=>setTimeout(r,15000));}
assert(Date.parse(state.at)>Date.parse(cycle.startedAt??'2026-10-07T22:02:04Z'),'normal-cycle publication still pending');
try{
const wet=await client.call('weather_forecast',{ticker:'KXRAIN-26OCT07-MIA'}),dry=await client.call('weather_forecast',{ticker:'KXRAIN-26OCT07-ABQ'});assert(!wet.isError&&!dry.isError);assert.equal(wet.forecast.rainNowcast.observation.measurableObserved,true);assert.equal(dry.forecast.rainNowcast.observation.measurableObserved,false);
const ids=['nws-measurable-rain-proxy-failure-1pct-v1','nws-measurable-rain-proxy-failure-5pct-v1'];for(const id of ids){const m=wet.forecast.models.find(m=>m.id===id);assert(m);assert.equal(m.band.admitted,false);assert.equal(m.details.probabilityIdentified,false);}
const pending=JSON.parse(await readFile(root+'/pending.json','utf8')),p=Object.values(pending).filter(r=>r.ticker==='KXRAIN-26OCT07-MIA'&&r.models.some(m=>ids.includes(m.id)));assert(p.length);
const rows=state.forecasts.filter(r=>r.rainNowcast),modeled=rows.filter(r=>r.models.some(m=>ids.includes(m.id))),full={at:new Date().toISOString(),cycleAt:state.at,wet,dry,pending:p,orderEffect:false};await writeFile(dir+'/native-publication.json',JSON.stringify(full)+'\n',{mode:0o600});
const summary={at:full.at,cycleAt:state.at,marketCount:state.marketCount,modelled:state.modelled,sameDayRainRows:rows.length,sameDayRainModelled:modeled.length,tickers:modeled.map(r=>r.ticker),wetModels:wet.forecast.models.map(m=>({id:m.id,p:m.p,admitted:m.band.admitted})),dryModels:dry.forecast.models.length,prospectivePendingRows:p.length,sourceEvidenceId:wet.forecast.evidenceId,oldAdmissionPreserved:true,orderEffect:false};await writeFile(dir+'/native-publication-summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary));
}finally{await client.close();}
