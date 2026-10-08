import assert from 'node:assert/strict';
import {realpath,readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const house=await realpath(process.env.HOME+'/.local/share/561-group/releases/cold-red-gate.561.group/current');
const modulePath=house+'/lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-operations-services-section/apps/group-operations/src/weather-network.mjs';
const {weatherNetworkSources,weatherRuntime}=await import(pathToFileURL(modulePath));
const runtime=await realpath(process.env.HOME+'/.local/share/561-group/weather-research/current'),manifest=JSON.parse(await readFile(join(runtime,'manifest.json'),'utf8'));
const entry=join(runtime,manifest.entry),engine=await weatherRuntime(),{weatherEstimates}=await import(pathToFileURL(join(dirname(entry),'weather-evidence.mjs'))),{sameDayRainEvidence}=await import(pathToFileURL(join(dirname(entry),'weather-precipitation.mjs')));
const dir=process.env.HOME+'/.local/state/561-group/weather-same-day-rain';await mkdir(dir,{recursive:true,mode:0o700});
const client=weatherNetworkSources({environment:process.env,config:{instance:{name:'same-day-rain-receiver'}}})[0].client;
const begun=Date.now(),cpu=process.cpuUsage();
try{
 const catalog=await client.listTools();assert(catalog.tools.some(t=>t.name==='weather_station_evidence'));
 const evidence=await client.call('weather_station_evidence',{stations:[{station:'KMIA',timeZone:'America/New_York',targetDates:['2026-10-07']},{station:'KABQ',timeZone:'America/Denver',targetDates:['2026-10-07']}]});assert(!evidence.isError,JSON.stringify(evidence));
 await writeFile(dir+'/native-evidence.json',JSON.stringify(evidence)+'\n',{mode:0o600});
 const archived=await client.call('weather_evidence',{evidenceId:evidence.evidenceId});assert.deepEqual(archived.observations,evidence.observations);
 const state=await engine.weatherStatus(),vc=engine.weatherClient(),tickers=['KXRAIN-26OCT07-MIA','KXRAIN-26OCT07-ABQ'];
 const markets=await vc.getMarkets({tickers:tickers.join(',')});const rows=[];
 for(const ticker of tickers){
  const c=state.contracts.find(c=>c.ticker===ticker),m=markets.find(m=>m.ticker===ticker);assert(c&&m);
  const rulesHash=createHash('sha256').update(JSON.stringify({primary:m.rules_primary,secondary:m.rules_secondary})).digest('hex');assert.equal(rulesHash,c.rulesHash);
  const now=Date.now(),models=weatherEstimates(c,evidence,now),nowcast=sameDayRainEvidence(c,evidence,now),obs=evidence.observations[c.binding.station+'/2026-10-07'];
  const pages=obs?.rawPages??[];for(const page of pages){const bytes=gunzipSync(Buffer.from(page.body,'base64'));assert.equal(createHash('sha256').update(bytes).digest('hex'),page.sha256);}
  rows.push({ticker,marketReceivedAt:new Date(now).toISOString(),market:m,contract:c,models,nowcast,rawPagesVerified:pages.length});
 }
 const full={at:new Date().toISOString(),runtime,house,evidenceId:evidence.evidenceId,rows,orderEffect:false};await writeFile(dir+'/native-projection.json',JSON.stringify(full)+'\n',{mode:0o600});
 const used=process.cpuUsage(cpu),summary={at:full.at,runtime,evidenceId:evidence.evidenceId,evidenceRoundTrip:true,sourceErrors:evidence.errors,rows:rows.map(r=>({ticker:r.ticker,status:r.market.status,bid:r.market.yes_bid_dollars,ask:r.market.yes_ask_dollars,rawPagesVerified:r.rawPagesVerified,witnesses:r.nowcast?.observation?.witnesses.length??0,measurableWitnesses:r.nowcast?.observation?.measurableWitnesses??0,conflicts:r.nowcast?.observation?.conflicts.length??0,models:r.models.map(m=>({id:m.id,p:m.p,probabilityIdentified:m.details.probabilityIdentified,tradeEligible:m.details.tradeEligible})),remaining:r.nowcast?.remaining})),elapsedSeconds:(Date.now()-begun)/1000,cpuSeconds:(used.user+used.system)/1e6,maxRssMiB:process.resourceUsage().maxRSS/1024,evidenceJsonBytes:Buffer.byteLength(JSON.stringify(evidence)),orderEffect:false};await writeFile(dir+'/native-summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(summary));
}finally{await client.close();}
