import {sameDayRainEvidence} from './weather-precipitation.mjs';
import {weatherParticipationActions, reviewWeatherParticipation, readWeatherParticipationFees, verifyWeatherParticipationProposal} from './weather-participation.mjs';
import {weatherCarryAllocation} from './weather-capital.mjs';
import {collectEcmwfEnsemble} from './weather-ecmwf-ensemble.mjs';
import {collectRelationalWeatherNowcast} from './weather-relational-nowcast.mjs';
import {collectWeatherStrategyResearch} from './weather-strategy-research.mjs';
import {collectRelationalTemperatureScience} from './weather-relational-temperature.mjs';
import {deriveDailyTemperatureExtremes} from './weather-temperature-extremes.mjs';
import {INDEX_CITIES,weatherIndexContractScope,collectWeatherIndexEvidence} from './weather-index.mjs';
import {TEMPERATURE_MARKETS} from './temperature-market-model.mjs';
import {planWeatherReasoningCadence,temperatureReasoningTimeZones} from './weather-reasoning-cadence.mjs';
import { binarySettlement, marketSettlementTiming } from '@red-cup-engineering/kalshi-services-section/market-facts';
import {randomUUID,createHash} from 'node:crypto';
import {updateStationScience,readStationScience,readStationSciencePage,stationPointForecasts} from './station-weather-science.mjs';
import {admitWeatherPageWire,weatherReadPage,weatherStatusInventory} from './weather-read-page.mjs';
import {readWeatherSourceRecord} from './weather-source-record.mjs';
import { readFile, writeFile, mkdir, rename, readdir, appendFile, rm, stat, link } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createKalshiClient } from '@red-cup-engineering/kalshi-services-section/client';
import { digest, discoverWeather, weatherRuleKey, weatherContract, mapLimit } from './weather-universe.mjs';
import { collectWeatherEvidence, collectStationWeatherEvidence, weatherEstimates, forecastCell } from './weather-evidence.mjs';
import { createModelGradeAccumulator, probabilityBand, allocateWeather } from './weather-learning.mjs';
import { fuseForecast } from './forecast-surface.mjs';
import { orderFee } from './fees.mjs';
import {sourceReport} from './weather-settlement-source.mjs';
import {modalTemperatureReading} from './weather-modal-outcomes.mjs';
import { bracketSettlesYes } from './temperature-distribution.mjs';

import {settlementRoot,stateDirectory} from '@red-cup-engineering/kalshi-services-section/data-layout';
/** The weather engine's state: one object-state directory of the Kalshi settlement, data/state/weather-state. */
export const weatherRoot=(env=process.env)=>env.KALSHI_WEATHER_STATE_DIR??stateDirectory(settlementRoot(env),'weather');
export function weatherClient({fetchImpl=fetch}={}) {
  // The canonical client owns pacing, attempt timeouts and 429 backoff. Wrapping
  // its seven default attempts in another five-attempt fetch loop spent up to
  // 35 wire requests on one logical source read.
  return createKalshiClient({credentials:null,fetchImpl,minIntervalMs:400,timeoutMs:20000,retries429:4});
}
const read=async(path,fallback)=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}};
async function atomic(path,value){const tmp=`${path}.${process.pid}.tmp`;await writeFile(tmp,JSON.stringify(value)+'\n',{mode:0o600});await rename(tmp,path);}
async function processStart(pid){try{return (await readFile(`/proc/${pid}/stat`,'utf8')).split(') ')[1].split(' ')[19];}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function locked(root,fn){
  await mkdir(root,{recursive:true,mode:0o700});const lock=join(root,'cycle.lock');
  const owner={pid:process.pid,start:await processStart(process.pid),at:Date.now()};
  for(let attempt=0;attempt<3;attempt++) {
    try{await writeFile(lock,JSON.stringify(owner),{flag:'wx',mode:0o600});break;}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      let old;try{old=JSON.parse(await readFile(lock,'utf8'));}catch(error){
        if(error.code==='ENOENT')continue;
        if(!(error instanceof SyntaxError))throw error;
        if(Date.now()-(await stat(lock)).mtimeMs<60000)throw new Error('weather cycle lock is being acquired');
      }
      if(old&&(await processStart(old.pid))===old.start)throw Object.assign(new Error('weather cycle already running'),{code:'WEATHER_CYCLE_RUNNING'});
      await rm(lock,{force:true});
      if(attempt===2)throw new Error('weather cycle lock contention');
    }
  }
  try{return await fn();}finally{await rm(lock,{force:true});}
}

export async function weatherCashBudget({client=createKalshiClient(),exchangeIndex=0}={}) {
  if(!Number.isInteger(exchangeIndex)||exchangeIndex<0)throw new TypeError('weather exchange index required');
  const [balance,orders]=await Promise.all([
    client.call('GET','/portfolio/balance',{query:{exchange_index:exchangeIndex,subaccount:0}}),
    client.getOrders({status:'resting',exchange_index:exchangeIndex,subaccount:0}),
  ]);
  const capitalUsd=Number(balance.balance_dollars??(balance.balance===undefined?NaN:balance.balance/100));
  if(!Number.isFinite(capitalUsd)||capitalUsd<0)throw new Error('weather-shard cash balance cannot be read');
  let reserved=0;
  for(const o of orders){
    const count=Number(o.remaining_count_fp??o.remaining_count),yes=Number(o.yes_price_dollars??(o.yes_price===undefined?o.price:o.yes_price/100));
    const side=o.book_side??(['bid','ask'].includes(o.side)?o.side:(['yes','no'].includes(o.side)&&['buy','sell'].includes(o.action)?((o.side==='yes')===(o.action==='buy')?'bid':'ask'):null));
    if(!['bid','ask'].includes(side)||!Number.isFinite(count)||count<0||!Number.isFinite(yes)||yes<0||yes>1||o.exchange_index!==undefined&&o.exchange_index!==exchangeIndex||o.subaccount_number!==undefined&&o.subaccount_number!==0)throw new Error('resting order collateral cannot be read; cash budget remains unavailable');
    reserved+=count*(side==='bid'?yes:1-yes);
  }
  return {capitalUsd,encumberedUsd:Math.ceil(reserved*100-1e-8)/100,exchangeIndex,observedAt:new Date().toISOString(),source:'weather-shard cash minus gross resting-order commitments (conservative)',orderEffect:false};
}
async function archivePacket(path,evidence){
  const tmp=`${path}.${process.pid}.${randomUUID()}.tmp`;
  try{await writeFile(tmp,gzipSync(JSON.stringify(evidence)),{mode:0o600,flag:'wx'});try{await link(tmp,path);}catch(e){if(e.code!=='EEXIST')throw e;}}
  finally{await rm(tmp,{force:true});}
}
async function archiveWeatherEvidence(evidence,root) {
  await mkdir(join(root,'evidence'),{recursive:true,mode:0o700});
  const sourceEvidenceId=digest(evidence);await archivePacket(join(root,'evidence',`${sourceEvidenceId}.json.gz`),evidence);
  evidence.dailyExtremes=deriveDailyTemperatureExtremes(evidence,{now:Date.now()});
  try{evidence.science=await locked(join(root,'station-science'),()=>updateStationScience(evidence,{root:join(root,'station-science'),now:Date.now(),sourceEvidenceId}));}
  catch(e){if(e.code!=='WEATHER_CYCLE_RUNNING')throw e;const report=await readStationScience({root:join(root,'station-science')});evidence.science={...report,status:'another station-science update is running',forecasts:stationPointForecasts(evidence,{parameters:report.parameters}),outcomes:[]};}
  evidence.sourceEvidenceId=sourceEvidenceId;
  const evidenceId=digest(evidence);await archivePacket(join(root,'evidence',`${evidenceId}.json.gz`),evidence);return evidenceId;
}
/** Independent, empirical metrology experiment; raw archive retained by content address. */
export async function weatherRelationalScience({region='nyc',root=weatherRoot(),now=Date.now(),fetchImpl=fetch}={}) {
 const packet=await collectRelationalTemperatureScience({region,now,fetchImpl});
 await mkdir(join(root,'evidence'),{recursive:true,mode:0o700});
 const evidenceId=digest(packet);await archivePacket(join(root,'evidence',`${evidenceId}.json.gz`),packet);
 const {rawSource,...report}=packet;return {evidenceId,...report};
}
/** A generated-learner study with lossless fits/plays archived and a bounded public summary. */
export async function weatherStrategyResearch({region='nyc',root=weatherRoot(),now=Date.now(),fetchImpl=fetch}={}) {
 const packet=await collectWeatherStrategyResearch({region,now,fetchImpl});
 await mkdir(join(root,'evidence'),{recursive:true,mode:0o700});
 const evidenceId=digest(packet);await archivePacket(join(root,'evidence',`${evidenceId}.json.gz`),packet);
 const {rawSource,...report}=packet;
 return {...report,evidenceId,study:{...packet.study,generatedLearners:packet.study.generatedLearners.map(({lastFrozenFits,...learner})=>learner),game:{arena:packet.study.game.arena,semantics:packet.study.game.semantics,scope:packet.study.game.scope,admittedPlayCount:packet.study.game.strategy.plays.length}}};
}
export async function weatherRelationalNowcast({region='nyc',root=weatherRoot(),now=Date.now(),fetchImpl=fetch}={}){
 const packet=await collectRelationalWeatherNowcast({region,cacheDir:join(root,'nbm','relational'),now,fetchImpl}),evidence={at:packet.at,stations:[],local:{},observations:{},errors:[],relational:{regions:[packet]}};
 const evidenceId=await archiveWeatherEvidence(evidence,root);return {at:packet.at,region,evidenceId,source:packet.source,trainingId:packet.training.id,selection:packet.training.selection,gaps:packet.gaps,regionalTransition:packet.regionalTransition,science:evidence.science,orderEffect:false};
}
/** Independent operational AI ensemble, registered in the same prospective physical scorer. */
export async function weatherEcmwfEvidence({stations,validCount=1,root=weatherRoot(),now=Date.now(),fetchImpl=fetch,python}={}){
 if(!Array.isArray(stations)||stations.length<1||stations.length>16)throw new TypeError('provide 1..16 stations');
 const packet=await collectEcmwfEnsemble(stations,{cacheDir:join(root,'ecmwf'),validCount,now,fetchImpl,python}),evidence={at:packet.collectedAt,stations,local:{},observations:{},errors:[],ecmwfEnsemble:packet};
 const evidenceId=await archiveWeatherEvidence(evidence,root);
 const {indices,fields,stationMetadata,...summary}=packet;
 return {evidenceId,...summary,fieldCount:fields.length,indexCount:indices.length,stationMetadata:stationMetadata.map(({source,...r})=>({...r,metadataSource:source.url})),science:{at:evidence.science.at,status:evidence.science.status,forecasted:evidence.science.forecasted,scored:evidence.science.scored,forecasts:evidence.science.forecasts},orderEffect:false};
}
export function weatherStationSkill({root=weatherRoot(),station}={}){return readStationScience({root:join(root,'station-science'),station});}
export function weatherStationSkillPage({root=weatherRoot(),...request}={}){return readStationSciencePage({...request,root:join(root,'station-science')});}
export async function weatherStationEvidence({stations,root=weatherRoot(),now=Date.now(),fetchImpl=fetch}={}) {
  const evidence=await collectStationWeatherEvidence(stations,{cacheDir:join(root,'nbm'),now,fetchImpl});
  const evidenceId=await archiveWeatherEvidence(evidence,root);
  return {evidenceId,...evidence,orderEffect:false};
}
/** Original index sources are published by the existing settlement-source job.
 * The heavyweight weather cycle and desk reuse this immutable packet. A source
 * receipt never refreshes the clocks of its reused station or market inputs.
 */
export async function readWeatherIndexSources({root=weatherRoot()}={}) {
 const pointer=await read(join(root,'index-source.json'),null);
 if(!pointer)return {cities:{},errors:[{source:'Kalshi-weather-index',error:'no settlement-source receipt published'}],surface:null};
 if(!/^[a-f0-9]{64}$/.test(pointer.evidenceId??''))throw new TypeError('original index source archive reference required');
 const {record}=await readWeatherSourceRecord({root,file:'evidence/'+pointer.evidenceId+'.json.gz'});
 if(record.kind!=='kalshi-weather-index-source')throw new TypeError('original index source packet required');
 if(pointer.surface&&pointer.surface.sourceEvidenceId!==pointer.evidenceId)throw new TypeError('hourly surface must retain its original source archive');
 return {cities:record.indices,errors:record.errors??[],surface:pointer.surface??null,evidenceId:pointer.evidenceId,at:record.at};
}
// Release the full latest/science records between reads. These are transient
// projections of the original hash-bound records, not another persisted index.
async function hourlyProjectionContext(root){
 const latest=await read(join(root,'latest.json'),{});
 return {stationEvidenceId:latest.forecasts?.find(row=>/^[a-f0-9]{64}$/.test(row.evidenceId??''))?.evidenceId??null};
}
/** Every two-minute index-source tick reads CURRENT hourly listings and rule
 * bodies from the public venue, independently of the slower station-forecast
 * cycle. The venue client is unsigned: the source job does not need account
 * credentials and never places orders. A stale listing cannot masquerade as
 * a fresh contract or market midpoint.
 */
export async function readHourlyIndexMarketCensus({client=createKalshiClient({credentials:null,timeoutMs:8000}),now=Date.now(),clock=()=>Date.now(),horizonHours=6}={}){
 if(!Number.isFinite(now)||!Number.isFinite(horizonHours)||horizonHours<=0||horizonHours>24)
   throw new TypeError('hourly index census requires a finite clock and a 0..24h close window');
 const lastClose=now+horizonHours*3600000;
 // Kalshi's public markets API forbids combining status=open with close-time
 // bounds. Filter by close-time server-side; validate active status locally.
 const contracts=[],errors=[],coverage=[];
 await mapLimit(Object.entries(INDEX_CITIES),2,async ([city,info])=>{
  try{
   const series=await client.getSeries(info.series);
   if(series?.ticker!==info.series||series.frequency!=='hourly'
     ||series.contract_terms_url!==`https://assets.kalshi.com/contract_terms/${info.terms}.pdf`)
     throw new TypeError('hourly series identity, frequency or certified methodology changed');
   const markets=await client.getMarkets({series_ticker:info.series,min_close_ts:Math.floor(now/1000),max_close_ts:Math.ceil(lastClose/1000)});
   if(!Array.isArray(markets)||markets.length>4000)
     throw new TypeError('complete bounded hourly market listing required');
   const marketObservedAt=new Date(clock()).toISOString(),received=Date.parse(marketObservedAt);
   const seen=new Set();let accepted=0,refused=0;
   for(const market of markets){
    if(!market||typeof market.ticker!=='string'||seen.has(market.ticker)){
     refused++;errors.push({source:'Kalshi-hourly-contract',city,ticker:market?.ticker??null,error:'missing or duplicate market identity'});continue;
    }
    seen.add(market.ticker);
    const close=Date.parse(market.close_time);
    if(!Number.isFinite(close)||close<=Math.max(now,received)||close>lastClose||!['active','open'].includes(market.status))continue;
    if(market.series_ticker!==undefined&&market.series_ticker!==info.series||market.market_type!=='binary'){
     refused++;errors.push({source:'Kalshi-hourly-contract',city,ticker:market.ticker,error:'wrong market series or not a binary contract'});continue;
    }
    const contract=weatherContract(market,series);
    if(contract.family!=='hourly-temperature'||contract.source!=='synoptic'
      ||contract.binding?.kind!=='index-at'||contract.binding.city!==city){
     refused++;errors.push({source:'Kalshi-hourly-contract',city,ticker:market.ticker,error:contract.blocker??'source, measurement time or methodology not bound'});continue;
    }
    accepted++;
    contracts.push({...contract,rulesHash:digest({primary:market.rules_primary,secondary:market.rules_secondary}),
      marketObservedAt,marketMid:mid(market)});
   }
   coverage.push({city,seriesTicker:info.series,receivedAt:marketObservedAt,listed:markets.length,accepted,refused});
  }catch(error){errors.push({source:'Kalshi-hourly-census',city,error:error.message});}
 });
 return {contracts,errors,coverage,orderEffect:false};
}

async function hourlyStationEvidence(root,evidenceId,indices){
 const {record:cached}=await readWeatherSourceRecord({root,file:'evidence/'+evidenceId+'.json.gz'});
 const stations=new Set(Object.values(indices).flatMap(packet=>(packet.calibrations?.calibrations??[]).flatMap(config=>(config.stations??[]).map(s=>s.station_id.slice(0,4)))));
 const selected=rows=>Object.fromEntries([...stations].filter(station=>rows?.[station]).map(station=>[station,rows[station]]));
 const guidance=packet=>packet?{runtime:packet.runtime,source:packet.source,stations:selected(packet.stations)}:null;
 const ensemble=cached.ecmwfEnsemble;
 return {indices,guidance:guidance(cached.guidance),hourlyGuidance:guidance(cached.hourlyGuidance),lamp:guidance(cached.lamp),local:selected(cached.local),
  ecmwfEnsemble:ensemble?{runtime:ensemble.runtime,availableAt:ensemble.availableAt,sourceUrl:ensemble.sourceUrl,projection:ensemble.projection,stations:selected(ensemble.stations)}:null,
  science:cached.science?{at:cached.science.at,parameters:Object.fromEntries(Object.entries(cached.science.parameters??{}).filter(([key])=>key.startsWith('index:'))),
   forecasts:(cached.science.forecasts??[]).filter(row=>row.station?.startsWith('index:'))}:null,
 };
}
export async function publishWeatherIndexSources({root=weatherRoot(),now=Date.now(),fetchImpl=fetch,marketClient}={}) {
 const previous=await readWeatherIndexSources({root});
 const fresh=await collectWeatherIndexEvidence(Object.keys(INDEX_CITIES),{now,fetchImpl,methodologies:Object.fromEntries(Object.entries(previous.cities).map(([city,packet])=>[city,packet.methodology]))});
 const context=await hourlyProjectionContext(root),stationEvidenceId=context.stationEvidenceId;
 const packet={kind:'kalshi-weather-index-source',at:new Date().toISOString(),indices:fresh.cities,errors:fresh.errors,stationEvidenceId};
 await mkdir(join(root,'evidence'),{recursive:true,mode:0o700});
 const evidenceId=digest(packet);await archivePacket(join(root,'evidence',evidenceId+'.json.gz'),packet);
 // Receive the original index sensor evidence BEFORE any optional venue
 // census or model projection. Failures cannot delay custody or backdate it.
 await atomic(join(root,'index-source.json'),{at:packet.at,evidenceId,surface:null});
 let surface=null,projectionError=null,marketCensus={contracts:[],errors:[],coverage:[],orderEffect:false};
 try{
  // Market visibility does not depend on a successful earlier heavy forecast.
  // Without station evidence this is a read-only census and no price is certified.
  marketCensus=await readHourlyIndexMarketCensus({client:marketClient??createKalshiClient({credentials:null,fetchImpl,timeoutMs:8000}),now:Date.now()});
  if(stationEvidenceId){
   const evidence=await hourlyStationEvidence(root,stationEvidenceId,packet.indices),decisionNow=Date.now(),grades=await read(join(root,'grades.json'),{}),rows=[];
  // The market list AND quote originate from the current public venue read.
  // A slow forecast cycle's old market roster is not the two-minute census.
  const contracts=marketCensus.contracts.map(c=>weatherIndexContractScope(c,evidence,decisionNow));
  for(const c of contracts){
   const s=stage(c,decisionNow);
   const midpoint=Number.isFinite(c.marketMid)&&decisionNow>=Date.parse(c.marketObservedAt)&&decisionNow-Date.parse(c.marketObservedAt)<=20*60000?c.marketMid:null;
   const models=weatherEstimates(c,evidence,decisionNow).map(m=>({...m,band:probabilityBand({...c,station:c.binding.station,stage:s},m,grades)}));
   rows.push({ticker:c.ticker,eventTicker:c.event_ticker,family:c.family,source:c.source,ruleKey:c.ruleKey,rulesHash:c.rulesHash,targetDate:c.binding.targetDate,closeTime:c.close_time,station:c.binding.station,blocker:c.blocker,evidenceId:stationEvidenceId,indexSourceEvidenceId:evidenceId,marketObservedAt:midpoint===null?null:c.marketObservedAt,models,surface:fuseForecast({mid:midpoint,models})});
  }
  surface={...forecastSurface(rows,contracts,new Date(decisionNow).toISOString()),sourceEvidenceId:evidenceId,stationEvidenceId,
   marketCensus:{coverage:marketCensus.coverage,errors:marketCensus.errors},
   projection:'current public hourly venue rules/quotes and index with previously received station guidance; original input age checks retained'};
  retainHourlyWindow(surface,previous.surface,contracts,grades,decisionNow);
  await atomic(join(root,'index-source.json'),{at:packet.at,evidenceId,surface});
  }
 }catch(error){projectionError=error.message;}
 return {at:packet.at,evidenceId,projectionError,cities:Object.keys(packet.indices),errors:[...packet.errors,...marketCensus.errors],hourlyMarketCoverage:marketCensus.coverage,hourlyMarkets:marketCensus.contracts.length,conflicts:Object.entries(packet.indices).filter(([_,p])=>p.validation?.conflicted).map(([city])=>city),surfaceContracts:surface?.contracts.length??0,orderEffect:false};
}

/** Public city index and station science, without requiring any market listing. */
export async function weatherIndexEvidence({cities,root=weatherRoot(),now=Date.now(),fetchImpl=fetch}={}){
 if(!Array.isArray(cities)||cities.length<1||cities.length>4||cities.some(c=>!Object.hasOwn(INDEX_CITIES,c)))throw new TypeError('provide 1..4 known city indices');
 const contracts=[...new Set(cities)].map(city=>{const z=INDEX_CITIES[city].timeZone,parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:z,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now)).map(p=>[p.type,p.value]));return {binding:{kind:'index-at',city,timeZone:z,targetDate:`${parts.year}-${parts.month}-${parts.day}`}};});
 const evidence=await collectWeatherEvidence(contracts,{cacheDir:join(root,'nbm'),now,fetchImpl});
 const evidenceId=await archiveWeatherEvidence(evidence,root);return {evidenceId,...evidence,orderEffect:false};
}
export async function weatherEvidence({root=weatherRoot(),evidenceId,station,rawFieldSha256}={}) {
  if(!/^[a-f0-9]{64}$/.test(evidenceId??''))throw new TypeError('content-addressed evidenceId required');
  const e=JSON.parse(gunzipSync(await readFile(join(root,'evidence',`${evidenceId}.json.gz`))));
  if(rawFieldSha256!==undefined){
   if(!/^[a-f0-9]{64}$/.test(rawFieldSha256)||!e.ecmwfEnsemble?.fields?.some(r=>r.sha256===rawFieldSha256))throw new TypeError('field must belong to this archived ECMWF evidence');
   const bytes=await readFile(join(root,'ecmwf','raw',rawFieldSha256));if(createHash('sha256').update(bytes).digest('hex')!==rawFieldSha256)throw new Error('immutable field hash mismatch');
   return {evidenceId,sha256:rawFieldSha256,kind:'GRIB2',bytes:bytes.length,base64:bytes.toString('base64')};
  }
  if(station?.startsWith('index:'))return {at:e.at,station,sourceEvidenceId:e.sourceEvidenceId,index:e.indices?.[station.slice(6)]??null,science:e.science?{...e.science,metrics:e.science.metrics?.filter(r=>r.station===station),comparisons:e.science.comparisons?.filter(r=>r.station===station),parameters:Object.fromEntries(Object.entries(e.science.parameters??{}).filter(([k])=>k.startsWith(station+'/'))),forecasts:e.science.forecasts?.filter(r=>r.station===station),outcomes:e.science.outcomes?.filter(r=>r.forecast.station===station)}:null};
  return station?{at:e.at,station,ecmwfEnsemble:e.ecmwfEnsemble?{runtime:e.ecmwfEnsemble.runtime,availableAt:e.ecmwfEnsemble.availableAt,projection:e.ecmwfEnsemble.projection,station:e.ecmwfEnsemble.stations[station],fields:e.ecmwfEnsemble.fields,indices:e.ecmwfEnsemble.indices}:null,sourceEvidenceId:e.sourceEvidenceId,dailyExtremes:e.dailyExtremes?{forecasts:e.dailyExtremes.forecasts.filter(r=>r.station===station),gaps:e.dailyExtremes.gaps.filter(r=>r.station===station)}:null,science:e.science?{...e.science,metrics:e.science.metrics?.filter(r=>r.station===station),comparisons:e.science.comparisons?.filter(r=>r.station===station),parameters:Object.fromEntries(Object.entries(e.science.parameters??{}).filter(([k])=>k.startsWith(station+'/'))),forecasts:e.science.forecasts?.filter(r=>r.station===station),outcomes:e.science.outcomes?.filter(r=>r.forecast.station===station)}:null,lamp:e.lamp?{runtime:e.lamp.runtime,source:e.lamp.source,extendedSource:e.lamp.extendedSource,station:e.lamp.stations[station]}:null,guidance:e.guidance?.stations[station],hourlyGuidance:e.hourlyGuidance?{runtime:e.hourlyGuidance.runtime,source:e.hourlyGuidance.source,station:e.hourlyGuidance.stations[station]}:null,quantiles:e.quantiles?{runtime:e.quantiles.runtime,source:e.quantiles.source,station:e.quantiles.stations[station]}:null,settlementReports:Object.fromEntries(Object.entries(e.settlement?.daily??{}).map(([date,r])=>[date,{source:r.source,results:r.data?.results?.filter(x=>x.station?.icao===station)}])),local:e.local[station],observations:Object.fromEntries(Object.entries(e.observations).filter(([key])=>key.startsWith(station+'/'))),errors:e.errors.filter(r=>!r.station||r.station===station)}:e;
}

const participationFields=['rows','errors','marketBatches','bookBatches','liveIndexDiscovery','evaluations','skipped','selectedActionIds','commitments','unansweredQuestions','conflictingCommitments','tradePages','trades','market','book','book.yes_dollars','book.no_dollars','feeObservations','feeObservations.eventFeePages','frozenModels','actions','actions.alternatives','actions.questions','actions.forecastModels','review','review.actions','review.tradeConflicts','review.executionAssumptions','review.publicCounterpartyEvidence','review.publicCounterpartyEvidence.trades','policy','policy.cases','proposal','proposal.commitments','proposal.unansweredQuestions'];
/** A bounded view of the existing immutable participant archive. Complete
 * library readers and source bytes remain available; no new dataset is made. */
export async function weatherParticipationEvidencePage({root=weatherRoot(),evidenceId,field,row,tradePage,offset=0,limit=100,sourceRevision}={}){
 if(!/^[a-f0-9]{64}$/u.test(evidenceId??''))throw new TypeError('content-addressed evidenceId required');
 const {record,source}=await readWeatherSourceRecord({root,file:`evidence/${evidenceId}.json.gz`,sourceRevision});
 if(!source.present||!['weather-participation-snapshot-v1','weather-participation-review-v1','weather-participation-proposal-v1','weather-carry-allocation-v1'].includes(record.kind))throw new TypeError('an original participation archive is required');
 let subject=record;
 if(row!==undefined){if(!Number.isSafeInteger(row)||row<0||!Array.isArray(record.rows)||row>=record.rows.length)throw new RangeError('an existing participant row is required');subject=record.rows[row];}
 if(tradePage!==undefined){if(row===undefined||!Number.isSafeInteger(tradePage)||tradePage<0||tradePage>=(subject.tradePages?.length??0))throw new RangeError('an existing trade page within the selected row is required');subject=subject.tradePages[tradePage].packet;}
 const metadata={evidenceId,kind:record.kind,snapshotId:record.snapshotId??null,...(row===undefined?{}:{row}),...(tradePage===undefined?{}:{tradePage}),orderEffect:false,tradeAuthority:false};
 const valueOf=path=>path.split('.').reduce((value,key)=>value?.[key],subject);
 if(field!==undefined)return weatherReadPage({[field]:valueOf(field)},{source,field,allowedFields:participationFields,offset,limit,sourceRevision,metadata});
 const collections=participationFields.map(field=>{const v=valueOf(field);return {field,count:Array.isArray(v)?v.length:v&&typeof v==='object'?Object.keys(v).length:0};}).filter(v=>v.count);
 const scalars=Object.fromEntries(['ticker','eventTicker','family','station','rulesHash','sourceEvidenceId','frozenForecastAt','contractProbabilityDerivedAt','marketReceivedAt','status','capitalUsd','encumberedUsd','availableCapitalUsd','reservedUsd','remainingUsd','cashDeficitUsd','priorityReserveUsd','carryBudgetUsd','carryReserveUsd','conditionalNetAfterHurdleLowUsd','scope','method'].filter(key=>subject[key]!==undefined).map(key=>[key,subject[key]]));
 return admitWeatherPageWire({...metadata,source,at:record.at??null,coverage:record.coverage??null,...scalars,collections});
}
/** Projection boundary for public operation transport: the full calibration population remains in
 * the SAME immutable-on-read local latest.json source, but an unbounded object cannot pass the
 * MetroPlat Infograph member limit. Never claim that the sampled keys cover every grade.
 * Source insertion order is not an observation clock. No grades are mutated or erased.
 */
export function boundedWeatherStatus(snapshot, maxGradeMembers = 128) {
  if (!Number.isSafeInteger(maxGradeMembers) || maxGradeMembers < 0 || maxGradeMembers > 1024)
    throw new RangeError('weather status grade-member bound must be an integer from 0 to 1024');
  const grades = snapshot?.grades;
  if (!grades || typeof grades !== 'object' || Array.isArray(grades)) return snapshot;
  const keys = Object.keys(grades);
  if (keys.length <= maxGradeMembers) return snapshot;
  const admitted = { yes: 0, no: 0, unknown: 0 };
  for (const grade of Object.values(grades)) {
    if (grade?.admitted === true) admitted.yes += 1;
    else if (grade?.admitted === false) admitted.no += 1;
    else admitted.unknown += 1;
  }
  return {
    ...snapshot,
    grades: Object.fromEntries(keys.slice(maxGradeMembers === 0 ? keys.length : -maxGradeMembers).map((key) => [key, grades[key]])),
    gradeProjection: {
      total: keys.length, shown: maxGradeMembers, omitted: keys.length - maxGradeMembers,
      admittedPopulation: admitted, complete: false,
      selection: 'last property keys in the stored source, not recency or statistical sampling',
      source: 'weather-state/latest.json',
    },
  };
}

export async function weatherStatus({root=weatherRoot(),maxGradeMembers=128}={}) {
  const result=await read(join(root,'latest.json'),{status:'no weather cycle recorded',orderEffect:false});
  let running=null;const lock=await read(join(root,'cycle.lock'),null);
  if(lock&&await processStart(lock.pid)===lock.start)running={startedAt:new Date(lock.at).toISOString()};
  return boundedWeatherStatus({...result,running,lastFailure:await read(join(root,'last-failure.json'),null)},maxGradeMembers);
}

/** Bounded operation projection; internal consumers retain weatherStatus's full read. */
export async function weatherStatusPage({root=weatherRoot(),field,offset=0,limit=100,sourceRevision}={}){
 const {record,source}=await readWeatherSourceRecord({root,file:'latest.json',emptyRecord:{status:'no weather cycle recorded',orderEffect:false},sourceRevision});
 if(field!==undefined)return weatherReadPage(record,{source,field,allowedFields:['contracts','forecasts','grades','errors','opportunities','research','scoring'],offset,limit,sourceRevision,metadata:{orderEffect:false}});
 const lock=await read(join(root,'cycle.lock'),null);
 const running=lock&&await processStart(lock.pid)===lock.start?{startedAt:new Date(lock.at).toISOString()}:null;
 return weatherStatusInventory(record,{source,running,lastFailure:await read(join(root,'last-failure.json'),null)});
}

/** A read-only local-time plan for the next existing whole-exchange weather cycle.
 * Its station/zone roster comes from the normal temperature-market registry
 * plus any live contract bindings. No extra scheduler or source ownership.
 */
export async function weatherCadencePlan({root=weatherRoot(),now=Date.now(),policy}={}){
  const status=await weatherStatus({root});
  const timeZones=temperatureReasoningTimeZones({
    series:TEMPERATURE_MARKETS.series,contracts:status.contracts??[],
  });
  // The stored cycle-end 'at' is NOT a valid slot-coverage clock: the run
  // might have started collecting observations before the slot opened.
  const lastEvidenceAt=Number.isFinite(Date.parse(status.collectionStartedAt))?
    status.collectionStartedAt:null;
  const plan=planWeatherReasoningCadence({
    now,timeZones,lastEvidenceAt,...(policy?{policy}:{}),
  });
  return {...plan,collectorRunning:status.running??null,
    lastEvidenceAt,scope:'full-venue weather cycle; due zones only select when it runs'};
}

/** One entrypoint for an existing 5-minute host tick; choose due times in
 * each local civil zone, then REUSE the existing single-flight collector.
 * The collector still refreshes all weather contracts; this method does
 * not claim zone-scoped acquisition or real 5-minute source availability.
 * A missed/busy slot is not backfilled as independent forecast evidence.
 */
export async function runCadencedWeatherCycle({
  root=weatherRoot(),now=Date.now(),policy,...collectorOptions
}={}){
  const plan=await weatherCadencePlan({root,now,policy});
  if(!plan.shouldRun)return {status:'not-due',cadence:plan,orderEffect:false};
  if(plan.collectorRunning)return {status:'already-running',cadence:plan,orderEffect:false};
  const cadence={selectedAt:plan.evaluatedAt,slotAt:plan.slotAt,
    dueTimeZones:plan.dueTimeZones,policy:plan.policy,
    scope:'one single-flight global weather collection selected by station-local due windows',
    sourceFreshness:'separate from scheduled reasoning; preserve actual source receipt clocks'};
  const result=await runWeatherCycle({root,now,...collectorOptions,cadence});
  return {...result,status:'completed',cadence,orderEffect:false};
}

export async function triggerWeatherCycle({root=weatherRoot()}={}) {
  const state=await weatherStatus({root});
  if(state.running)return {status:'already-running',...state.running,orderEffect:false};
  const startedAt=new Date().toISOString();
  runWeatherCycle({root}).then(()=>rm(join(root,'last-failure.json'),{force:true}),async e=>{
    if(e.code==='WEATHER_CYCLE_RUNNING')return;
    await mkdir(root,{recursive:true});await atomic(join(root,'last-failure.json'),{startedAt,failedAt:new Date().toISOString(),reason:e.message});
  }).catch(()=>{});
  return {status:'started',startedAt,readResultWith:'weather_status',orderEffect:false};
}

function stage(c,now){const h=(Date.parse(c.close_time)-now)/3600000;return h<=6?'0-6h':h<=12?'6-12h':h<=24?'12-24h':h<=48?'24-48h':'48h+';}
function mid(c){const a=Number(c.yes_ask_dollars),b=Number(c.yes_bid_dollars);return a>0&&a<=1&&b>=0&&b<a?(a+b)/2:null;}
async function* resolvedRows(root){
  try{const lines=createInterface({input:createReadStream(join(root,'resolved.jsonl')),crlfDelay:Infinity});for await(const line of lines)if(line)yield JSON.parse(line);}
  catch(e){if(e.code!=='ENOENT')throw e;}
}
/** A resolved row grades a model only when its settlement evidence is verified and it was issued before settlement. */
const gradable=r=>r.settlementEvidenceVersion===1&&Date.parse(r.at)<Date.parse(r.settlement?.settledAt);
async function gradeHistory(root){
  // Keep only the earliest timestamp per contract/horizon/model; never retain full history objects.
  const first=new Map(),key=(r,m)=>`${r.ticker}/${r.stage}/${r.ruleKey}/${m.id}`;
  for await(const r of resolvedRows(root))if(gradable(r))for(const m of r.models){const k=key(r,m),at=first.get(k);if(at===undefined||r.at.localeCompare(at)<0)first.set(k,r.at);}
  const accumulator=createModelGradeAccumulator();
  for await(const r of resolvedRows(root))if(gradable(r))for(const m of r.models){const k=key(r,m);if(first.get(k)!==r.at)continue;first.delete(k);accumulator.add({...r,models:[m]});}
  return accumulator.report();
}
async function scorePending(root,client,now) {
  const pending=await read(join(root,'pending.json'),{}),settled=[];const errors=[];
  // Query each market once. Rain can settle before close; do not wait for the nominal close time.
  const tickers=[...new Set(Object.values(pending).map(r=>r.ticker))],markets=new Map();
  if(client.getMarkets){
    for(let i=0;i<tickers.length;i+=100){
      try{for(const m of await client.getMarkets({tickers:tickers.slice(i,i+100).join(',')}))markets.set(m.ticker,m);}
      catch(e){errors.push({batch:i,error:e.message});}
    }
  } else await mapLimit(tickers,3,async ticker=>{try{markets.set(ticker,await client.getMarket(ticker));}catch(e){errors.push({ticker,error:e.message});}});
  for(const [id,r] of Object.entries(pending)){
    const m=markets.get(r.ticker);
    const settlement=binarySettlement(m);
    if(!settlement||Date.parse(settlement.settledAt)>now)continue;
    const rulesHash=digest({primary:m.rules_primary,secondary:m.rules_secondary});
    if(!r.rulesHash||r.rulesHash!==rulesHash){errors.push({id,ticker:r.ticker,error:'settlement rules do not match the issued forecast'});continue;}
    if(!Number.isFinite(Date.parse(r.at))||Date.parse(r.at)>=Date.parse(settlement.settledAt)){errors.push({id,ticker:r.ticker,error:'forecast was not issued before definitive settlement'});continue;}
    settled.push({...r,id,outcome:settlement.outcome,scoredAt:new Date(now).toISOString(),venueResult:settlement.result,settledAt:settlement.settledAt,settlement,settlementEvidenceVersion:1});delete pending[id];
  }

  // A per-record immutable score file makes recovery after interruption idempotent.
  await mkdir(join(root,'scores'),{recursive:true});
  const known=new Set();for await(const r of resolvedRows(root))known.add(r.id);
  for(const r of settled){try{await writeFile(join(root,'scores',`${r.id}.json`),JSON.stringify(r)+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}
  for(const file of await readdir(join(root,'scores'))){const r=await read(join(root,'scores',file));if(!known.has(r.id)){await appendFile(join(root,'resolved.jsonl'),JSON.stringify(r)+'\n',{mode:0o600});known.add(r.id);}}
  await atomic(join(root,'pending.json'),pending);
  const grades=await gradeHistory(root);await atomic(join(root,'grades.json'),grades);
  return {settled:settled.length,pending:Object.keys(pending).length,errors,grades};
}
export async function scoreWeather({root=weatherRoot(),client=weatherClient(),now=Date.now()}={}) {
  return locked(root,()=>scorePending(root,client,now));
}
export async function admitWeatherModel(input,{root=weatherRoot(),now=Date.now()}={}) {
  const allowed=new Set(['model','version','sourceUrl','issuedAt','validUntil','forecasts','ensembles']);
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!allowed.has(k)))throw new TypeError('weather model requires the declared experiment fields');
  if(!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.model??'')||!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(input.version??''))throw new TypeError('model and immutable version must be bounded identifiers');
  if(new URL(input.sourceUrl).protocol!=='https:')throw new TypeError('model provenance must use https');
  const issue=Date.parse(input.issuedAt),expiry=Date.parse(input.validUntil);
  if(!Number.isFinite(issue)||!Number.isFinite(expiry)||issue>now||issue<now-86400000||expiry<=now||expiry>now+16*86400000)throw new TypeError('model issue/expiry must be current, with at most 16-day validity');
  const current=await weatherStatus({root}); const contracts=new Map((current.contracts??[]).map(c=>[c.ticker,c]));
  const forecasts=input.forecasts??[],ensembles=input.ensembles??[];
  if(!Array.isArray(forecasts)||!Array.isArray(ensembles)||forecasts.length+ensembles.length<1||forecasts.length+ensembles.length>2000)throw new TypeError('provide 1..2000 forecasts or station ensembles');
  for(const r of forecasts){const c=contracts.get(r.ticker);if(!c||Date.parse(c.close_time)<=now||r.rulesHash!==c.rulesHash||typeof r.probability!=='number'||!Number.isFinite(r.probability)||r.probability<0||r.probability>1)throw new TypeError('forecast must name a current contract, exact rulesHash and unit probability');}
  if(ensembles.reduce((n,r)=>n+(r.samples?.length??0),0)>100000)throw new TypeError('experiment exceeds 100000 ensemble samples');
  for(const r of ensembles){if(!['high','low'].includes(r.kind)||r.unit!=='F'||!/^[A-Z0-9]{4}$/.test(r.station)||!/^\d{4}-\d{2}-\d{2}$/.test(r.targetDate)||!Array.isArray(r.samples)||r.samples.length<10||r.samples.length>10000||r.samples.some(v=>!Number.isFinite(v)||v< -150||v>180))throw new TypeError('station ensemble must carry 10..10000 daily extreme samples in Fahrenheit');}
  await mkdir(join(root,'model-identities'),{recursive:true,mode:0o700});
  const identity={model:input.model,version:input.version,sourceUrl:input.sourceUrl};
  const identityFile=join(root,'model-identities',digest({model:input.model,version:input.version})+'.json');
  try{await writeFile(identityFile,JSON.stringify(identity),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;if(digest(await read(identityFile))!==digest(identity))throw new TypeError('model version source identity changed; use a new version');}
  const record={...input,receivedAt:new Date(now).toISOString()};const id=digest(record);
  await mkdir(join(root,'models'),{recursive:true,mode:0o700});await atomic(join(root,'models',`${id}.json`),record);
  return {id,model:`${input.model}@${input.version}`,receivedAt:record.receivedAt,forecasts:forecasts.length,ensembles:ensembles.length,orderEffect:false};
}
async function experiments(root,contracts,now){
  const out=new Map();let files=[];try{files=await readdir(join(root,'models'));}catch(e){if(e.code!=='ENOENT')throw e;}
  const records=[];for(const file of files){const r=await read(join(root,'models',file));if(Date.parse(r.validUntil)>now&&Date.parse(r.receivedAt)<=now)records.push(r);}
  records.sort((a,b)=>a.receivedAt.localeCompare(b.receivedAt));
  for(const r of records)for(const c of contracts){
    let p=r.forecasts?.find(f=>f.ticker===c.ticker&&f.rulesHash===c.rulesHash)?.probability;const direct=p!==undefined;
    const e=r.ensembles?.find(e=>c.binding&&e.station===c.binding.station&&e.kind===c.binding.kind&&e.targetDate===c.binding.targetDate);
    if(p===undefined&&e){const b={strikeType:c.strike_type,floorStrike:c.floor_strike,capStrike:c.cap_strike};p=e.samples.filter(v=>bracketSettlesYes(b,Math.round(v))).length/e.samples.length;}
    if(p!==undefined){if(!out.has(c.ticker))out.set(c.ticker,new Map());out.get(c.ticker).set(`${r.model}@${r.version}`,{id:`${r.model}@${r.version}`,p,directContractForecast:direct,details:{recordId:digest(r),source:r.sourceUrl,issuedAt:r.issuedAt,validUntil:r.validUntil,receivedAt:r.receivedAt,ensembleMembers:e?.samples.length??null}});}
  }
  return out;
}
async function quoteWeatherContract(c,models,evidence,client,surface) {
  if(c.blocker&&!models.some(m=>m.directContractForecast))return [];
  if(!surface||(!surface.admitted.length&&!surface.structural.length))return [];
  const qualified=models.filter(m=>surface.admitted.includes(m.id)||surface.structural.includes(m.id));
  const lo=surface.low,hi=surface.high;
  // A hazard is a regime the statistical models were not fitted on; a structural bound holds in every regime.
  if(surface.admitted.length&&c.family==='hourly-temperature'&&c.binding){
    for(const row of qualified.flatMap(m=>m.details?.stationForecasts??[])){const hazards=evidence.local[row.station.slice(0,4)]?.alerts;if(!hazards||hazards.warm.length||hazards.cold.length)return [];}
  }
  if(surface.admitted.length&&c.family==='daily-temperature'&&c.binding){
    const hazards=evidence.local[c.binding.station]?.alerts;
    if(!hazards||hazards.warm.length||hazards.cold.length)return [];
  }
  const fresh=await client.getMarket(c.ticker);
  if(fresh.status!=='active'||Date.parse(fresh.close_time)<=Date.now()||digest({primary:fresh.rules_primary,secondary:fresh.rules_secondary})!==c.rulesHash||fresh.exchange_index!==c.exchange_index)return [];
  const book=await client.getOrderbook(c.ticker,10),out=[];
  for(const side of [{side:'yes',l:book?.no_dollars,p:lo},{side:'no',l:book?.yes_dollars,p:1-hi}]) {
    const levels=(side.l??[]).map(([p,n])=>({price:Number((1-Number(p)).toFixed(4)),depth:Math.floor(Number(n))})).filter(x=>x.price>0&&x.price<1&&Number.isFinite(x.depth)&&x.depth>0).sort((a,b)=>a.price-b.price);
    if(!levels.length||c.feeType!=='quadratic'||!Number.isFinite(c.feeMultiplier))continue;
    const {price,depth}=levels[0];
    // One-lot rounding overestimates aggregate fees; custody execution applies the actual live fee.
    const fee=orderFee(1,price,{multiplier:c.feeMultiplier}),edge=side.p-price-fee;
    if(edge>0)out.push({ticker:c.ticker,eventTicker:c.event_ticker,targetDate:c.binding?.targetDate,closeTime:fresh.close_time,...marketSettlementTiming(fresh),exchangeIndex:c.exchange_index,side:side.side,price,depth,fee,edge,winLower:side.p,admitted:true,modelIds:qualified.map(m=>m.id),rulesHash:c.rulesHash,observedAt:new Date().toISOString(),quoteExpiresAt:new Date(Date.now()+60000).toISOString()});
  }
  return out;
}
export async function allocateLiveWeather({root=weatherRoot(),capitalUsd,encumberedUsd=0,client=weatherClient(),portfolioClient,now=Date.now()}={}) {
  const state=await weatherStatus({root});
  if(!Number.isFinite(Date.parse(state.at))||now-Date.parse(state.at)>15*60000)throw new Error('weather evidence is older than fifteen minutes; run weather_cycle before allocating');
  const contracts=new Map((state.contracts??[]).map(c=>[c.ticker,c])),errors=[];
  const candidates=(state.forecasts??[]).filter(r=>{
    const c=contracts.get(r.ticker);
    return c&&stage(c,now)===r.stage&&Date.parse(c.close_time)>now&&r.models.some(m=>m.band.admitted);
  });
  const indices=[...new Set([...contracts.values()].map(c=>c.exchange_index))];
  if(capitalUsd===undefined&&(indices.length!==1||!Number.isInteger(indices[0])))throw new Error('weather contracts span unknown exchange shards; allocation needs a scoped cash budget');
  const budget=capitalUsd===undefined?await weatherCashBudget({...(portfolioClient?{client:portfolioClient}:{}),exchangeIndex:indices[0]}):{capitalUsd,encumberedUsd};
  let evidence={local:{}};
  if(candidates.length)evidence=await weatherEvidence({root,evidenceId:candidates[0].evidenceId});
  const quotes=(await mapLimit(candidates,3,async r=>{
    try{return await quoteWeatherContract(contracts.get(r.ticker),r.models,evidence,client);}
    catch(e){errors.push({ticker:r.ticker,error:e.message});return [];}
  })).flat().filter(q=>Date.parse(q.quoteExpiresAt)>Date.now());
  return {...allocateWeather(quotes,budget),evidenceAt:state.at,observedAt:new Date().toISOString(),budgetSource:budget.source??'explicit scenario',errors};
}

/**
 * The desk's read of the cycle: every contract whose surface the house knows better than the book (an
 * admitted model or a structural bound), in a few kilobytes instead of latest.json's megabytes.
 */
export function forecastSurface(rows,contracts,at){
  const byTicker=new Map(contracts.map(c=>[c.ticker,c]));
  return {type:'KalshiForecastSurface',version:SURFACE_VERSION,at,contracts:rows.filter(r=>r.surface&&(r.surface.admitted.length||r.surface.structural.length)&&!r.blocker).map(r=>{const c=byTicker.get(r.ticker);
    return {ticker:r.ticker,eventTicker:r.eventTicker,seriesTicker:c?.seriesTicker??r.ticker.split('-')[0],family:r.family,settlementSource:r.source,ruleKey:r.ruleKey,targetDate:r.targetDate,closeTime:r.closeTime,...marketSettlementTiming(c),rulesHash:r.rulesHash,feeMultiplier:c?.feeMultiplier??1,feeType:c?.feeType??'quadratic',station:r.station,...r.surface,...(c?.binding?.kind==='index-at'?{
      targetTime:c.binding.targetTime,indexLaw:c.indexLaw,sourceSurfaceAt:at,modelEvidenceId:r.evidenceId??null,indexSourceEvidenceId:r.indexSourceEvidenceId??r.evidenceId??null,marketObservedAt:r.marketObservedAt??null,
      modelSources:(r.models??[]).filter(m=>r.surface.admitted.includes(m.id)).map(m=>({id:m.id,p:m.p,source:m.source??null,issuedAt:m.issuedAt??m.details?.issuedAt??null,sourceAvailableAt:m.details?.sourceAvailableAt??m.details?.receivedAt??null,sourceRuntime:m.details?.sourceRuntime??null,validUntil:m.details?.validUntil??null})),
    }:{})};})};
}
/** The measurement closes forecasting, not the still-open contract. Preserve
 * original qualified knowledge on its original clock; never turn a pending
 * index into canonical truth or relabel a changed contract/calibration. */
function retainHourlyWindow(surface,previous,contracts,grades,now){
  if(previous?.version!==SURFACE_VERSION)return;
  const fresh=new Set(surface.contracts.map(row=>row.ticker));
  const scope=new Map(contracts.map(contract=>[contract.ticker,contract]));
  for(const original of previous.contracts??[]){
    const c=scope.get(original.ticker);
    const target=Date.parse(c?.binding?.targetTime),close=Date.parse(c?.close_time),sourceAt=Date.parse(original.sourceSurfaceAt);
    if(fresh.has(original.ticker)||!c||c.blocker||c.binding?.kind!=='index-at'
      ||!Number.isFinite(target)||!Number.isFinite(close)||now<target||now>=close||close>target+5*60000
      ||!Number.isFinite(sourceAt)||sourceAt>target||now<sourceAt||now-sourceAt>20*60000
      ||original.ruleKey!==c.ruleKey||original.rulesHash!==c.rulesHash||original.closeTime!==c.close_time||original.targetTime!==c.binding.targetTime
      ||!c.indexLaw?.id||original.indexLaw?.id!==c.indexLaw.id||original.indexLaw.methodologyBodyNI!==c.indexLaw.methodologyBodyNI
      ||original.indexLaw.configurationVersion!==c.indexLaw.configurationVersion||!original.admitted?.length||original.structural?.length||!original.modelSources?.length)continue;
    // Grading may have changed while the frozen prediction remained valid.
    // Requalify those same model probabilities in the same rule/source cohort.
    const models=original.modelSources.filter(m=>m.validUntil==null||Number.isFinite(Date.parse(m.validUntil))&&now<Date.parse(m.validUntil))
      .map(m=>({...m,band:probabilityBand({...c,station:c.binding.station,stage:stage(c,now)},m,grades)}));
    const marketAt=Date.parse(original.marketObservedAt);
    const midpoint=Number.isFinite(marketAt)&&now>=marketAt&&now-marketAt<=20*60000?original.mid:null;
    const qualified=fuseForecast({mid:midpoint,models});
    if(!qualified?.admitted.length)continue;
    surface.contracts.push({...original,...qualified,...marketSettlementTiming(c),feeMultiplier:c.feeMultiplier??1,feeType:c.feeType??'quadratic',retainedPreTarget:true,qualificationCheckedAt:new Date(now).toISOString(),retainedAgainstEvidenceId:surface.sourceEvidenceId});
  }
}
/** Version 2: structural bounds are observation-derived only (forecast-surface STRUCTURAL_KINDS). */
export const SURFACE_VERSION=2;
/** The latest surface, or null when it is older than `maxAgeMs` or of another version. */
export async function readForecastSurface({root=weatherRoot(),now=Date.now(),maxAgeMs=20*60000}={}){
  const s=await read(join(root,'surface.json'),null),index=(await readWeatherIndexSources({root})).surface;
  const eligible=value=>value&&value.version===SURFACE_VERSION&&now>=Date.parse(value.at)&&now-Date.parse(value.at)<=maxAgeMs;
  if(!eligible(index))return eligible(s)?s:null;
  const daily=eligible(s)?s.contracts.filter(row=>row.family!=='hourly-temperature'):[];
  const hourly=index.contracts.filter(row=>!row.retainedPreTarget||(now>=Date.parse(row.sourceSurfaceAt)&&now-Date.parse(row.sourceSurfaceAt)<=maxAgeMs&&now<Date.parse(row.closeTime)
    &&row.modelSources.filter(model=>row.admitted.includes(model.id)).every(model=>model.validUntil==null||now<Date.parse(model.validUntil))));
  return {...index,contracts:[...daily,...hourly]};
}
/** A run killed mid-write leaves `<file>.<pid>.tmp` behind; remove those whose writer is gone. */
async function removeDeadTemporaries(root){
  for(const dir of [root,join(root,'station-science')]){
    let names=[];try{names=await readdir(dir);}catch(e){if(e.code!=='ENOENT')throw e;}
    for(const name of names){const m=/\.(\d+)\.tmp$/.exec(name);if(m&&Number(m[1])!==process.pid&&await processStart(Number(m[1]))===null)await rm(join(dir,name),{force:true});}
  }
}
/**
 * The desk trades surface.json, so the cycle fuses it from the grades already learned and writes it before
 * scoring: an overrun then costs scoring time, never the desk's surface. Scoring resumes next cycle (score files
 * make it idempotent).
 */
export async function runWeatherCycle({root=weatherRoot(),client=weatherClient(),now=Date.now(),fetchImpl=fetch,capitalUsd=0,encumberedUsd=0,cadence=null}={}) {
  return locked(root,async()=>{
    await removeDeadTemporaries(root);
    const grades=await read(join(root,'grades.json'),{});
    const universe=await discoverWeather(client);
    const indexEvidence=await readWeatherIndexSources({root});
    const evidence=await collectWeatherEvidence(universe.markets,{cacheDir:join(root,'nbm'),now:Date.now(),fetchImpl,indexEvidence});
    const evidenceId=await archiveWeatherEvidence(evidence,root);
    const quoteTimes=new Map(),freshQuotes=new Map();
    const quoted=universe.markets;
    for(let i=0;i<quoted.length;i+=100){
      const batch=quoted.slice(i,i+100);
      try{for(const m of await client.getMarkets({tickers:batch.map(c=>c.ticker).join(',')})){freshQuotes.set(m.ticker,m);quoteTimes.set(m.ticker,new Date().toISOString());}}
      catch(e){evidence.errors.push({source:'fresh-market-quotes',error:e.message});}
    }
    const decisionNow=Date.now();
    const contracts=universe.markets.map(c=>{const fresh=freshQuotes.get(c.ticker);if(!fresh)return c;const changed=digest({primary:c.rules_primary,secondary:c.rules_secondary})!==digest({primary:fresh.rules_primary,secondary:fresh.rules_secondary});return {...c,...fresh,...(changed?{ruleKey:weatherRuleKey(fresh,c.seriesTicker,c.source,c.stationRule),binding:null,blocker:'rules changed during collection; rebind next cycle'}:{})};}).map(c=>weatherIndexContractScope({...c,rulesHash:digest({primary:c.rules_primary,secondary:c.rules_secondary})},evidence,decisionNow));
    for(const c of contracts)if(c.binding?.kind==='index-at'&&evidence.indices?.[c.binding.city]?.blocker)c.blocker=evidence.indices[c.binding.city].blocker;
    const ex=await experiments(root,contracts,decisionNow),pending=await read(join(root,'pending.json'),{}),rows=[],opportunities=[];
    await mapLimit(contracts,3,async c=>{
      const s=stage(c,decisionNow),models=weatherEstimates(c,evidence,decisionNow);
      models.push(...(ex.get(c.ticker)?.values()??[]));
      const midpoint=quoteTimes.has(c.ticker)?mid(c):null,b=c.binding,modelBands=models.map(m=>({...m,band:probabilityBand({...c,station:b?.station??null,stage:s},m,grades)}));
      const surface=fuseForecast({mid:midpoint,models:modelBands});
      const support=forecastCell(c,models);
      const row={ticker:c.ticker,eventTicker:c.event_ticker,title:c.title,family:c.family,source:c.source,stage:s,targetDate:b?.targetDate??null,closeTime:c.close_time,...marketSettlementTiming(c),ruleKey:c.ruleKey,rulesHash:c.rulesHash,station:b?.station??null,...(b?.kind==='rain'?{rainNowcast:sameDayRainEvidence(c,evidence,decisionNow)}:{}),mid:midpoint,marketObservedAt:quoteTimes.get(c.ticker)??null,models:modelBands,evidenceId,settlementReport:sourceReport(c,evidence.settlement),...support,modal:['high','low'].includes(b?.kind)?modalTemperatureReading(c,evidence,{at:new Date().toISOString()}):null,blocker:c.blocker,surface};
      rows.push(row);
      if(models.length&&midpoint!==null&&c.status==='active'&&Date.parse(c.close_time)>Date.now()){
        // The surface is graded like any model: house-surface-v1 against the mid is the house's own skill.
        const graded=[...models.map(m=>({id:m.id,p:m.p,details:m.details})),...(surface?[{id:'house-surface-v1',p:surface.p,details:{admitted:surface.admitted,structural:surface.structural,low:surface.low,high:surface.high}}]:[])];
        const forecast={at:new Date().toISOString(),...row,models:graded};
        const id=digest({ticker:c.ticker,stage:s,rules:c.rulesHash,models:graded.map(m=>m.id).sort()});
        pending[id]??=forecast;
      }
      try{opportunities.push(...await quoteWeatherContract(c,modelBands,evidence,client,surface));}catch(e){row.bookError=e.message;}

    });
    const at=new Date().toISOString();
    await atomic(join(root,'surface.json'),forecastSurface(rows,contracts,at));
    await atomic(join(root,'pending.json'),pending);
    const scoring=await scorePending(root,client,Date.now());
    const families={};for(const c of contracts){families[c.family]??={markets:0,modelled:0,volume24h:0};families[c.family].markets++;families[c.family].volume24h+=Number(c.volume_24h_fp??0);if(rows.find(r=>r.ticker===c.ticker)?.models.length)families[c.family].modelled++;}
    const research=Object.entries(families).filter(([_,v])=>v.modelled<v.markets).sort((a,b)=>b[1].volume24h-a[1].volume24h).map(([family,v])=>({family,...v,nextEffect:family==='hourly-temperature'?'bind official station/time and score short-horizon observation-conditioned forecasts':family==='precipitation'?'bind interval totals; validate probabilistic accumulation forecasts':family==='tropical'?'bind NHC event definitions and calibrate track/intensity ensembles':family==='snow'?'bind reporting station and validate snow accumulation ensembles':'bind settlement transformation and submit versioned forecasts'}));
    const {forecasts:physicalForecasts,outcomes:physicalOutcomes,...science}=evidence.science??{};
    const regionalTransitions=(evidence.relational?.regions??[]).filter(r=>r.regionalTransition).map(r=>({region:r.region,...r.regionalTransition}));
    const result={science,regionalTransitions,...(cadence?{cadence}:{}),at,collectionStartedAt:new Date(now).toISOString(),complete:universe.complete,series:universe.series,marketCount:contracts.length,modelled:rows.filter(r=>r.models.length).length,families,errors:[...universe.errors,...evidence.errors],scoring:{settled:scoring.settled,pending:scoring.pending,errors:scoring.errors},grades:scoring.grades,forecasts:rows,contracts,opportunities,research,allocation:allocateWeather(opportunities.filter(o=>Date.parse(o.quoteExpiresAt)>Date.now()),{capitalUsd,encumberedUsd}),orderEffect:false};
    await atomic(join(root,'latest.json'),result);
    return result;
  });
}


export async function weatherParticipation({root=weatherRoot(),client=weatherClient(),tickers,maxMarkets,quoteIntents,capitalUsd,encumberedUsd=0,contracts=1,windowSeconds=60,snapshotId,proposalActionIds,carryPolicy,now=Date.now()}={}){
 if(snapshotId!==undefined){
  if(tickers!==undefined||maxMarkets!==undefined||quoteIntents!==undefined||capitalUsd!==undefined||encumberedUsd!==0||contracts!==1||windowSeconds!==60)throw new TypeError('review uses only snapshotId and optional proposalActionIds or carryPolicy');
  const snapshot=await weatherEvidence({root,evidenceId:snapshotId});if(digest(snapshot)!==snapshotId)throw new TypeError('participation snapshot hash mismatch');if(snapshot.kind!=='weather-participation-snapshot-v1')throw new TypeError('market participation snapshot required');
  if(carryPolicy!==undefined){
   if(proposalActionIds!==undefined)throw new TypeError('choose carryPolicy or proposalActionIds');
   const evaluatedAt=Date.now(),allocation=weatherCarryAllocation(snapshot,carryPolicy,{now:evaluatedAt});
   const proposal=allocation.selectedActionIds.length?verifyWeatherParticipationProposal({...snapshot,availableCapitalUsd:allocation.carryBudgetUsd},{actionIds:allocation.selectedActionIds},{now:evaluatedAt}):null;
   const packet={...allocation,snapshotId,policy:carryPolicy,proposal};const evidenceId=digest(packet);await archivePacket(join(root,'evidence',evidenceId+'.json.gz'),packet);return {evidenceId,...packet};
  }
  if(proposalActionIds!==undefined){
   const packet={kind:'weather-participation-proposal-v1',at:new Date().toISOString(),snapshotId,...verifyWeatherParticipationProposal(snapshot,{actionIds:proposalActionIds},{now:Date.now()})};
   const evidenceId=digest(packet);await archivePacket(join(root,'evidence',evidenceId+'.json.gz'),packet);return {evidenceId,...packet};
  }
  const rows=await mapLimit(snapshot.rows,2,async row=>{
   const pages=[],trades=[],seenCursors=new Set();let cursor,error=null;const end=Math.min(now,Date.parse(row.actions.expiresAt));
   try {for(let page=0;page<3;page++){
    const packet=await client.call('GET','/markets/trades',{signed:false,query:{ticker:row.ticker,min_ts:Math.floor(Date.parse(row.actions.observedAt)/1000),max_ts:Math.ceil(end/1000),is_block_trade:false,limit:1000,cursor}});
    pages.push({receivedAt:new Date().toISOString(),packet});if(!Array.isArray(packet.trades)||packet.trades.some(t=>t?.ticker!==row.ticker))throw new TypeError('scoped trade tape missing or mismatched');trades.push(...packet.trades);
    cursor=packet.cursor??'';if(typeof cursor!=='string'||cursor&&seenCursors.has(cursor))throw new TypeError('trade cursor invalid or nonadvancing');if(!cursor)break;seenCursors.add(cursor);
   }}catch(e){error=e.message;}
   const market=await client.getMarket(row.ticker),receivedAt=new Date().toISOString(),rulesMatch=digest({primary:market.rules_primary,secondary:market.rules_secondary})===row.rulesHash;
   const label=binarySettlement(market),outcome=label&&rulesMatch&&Date.parse(label.settledAt)>=Date.parse(row.actions.observedAt)&&Date.parse(label.settledAt)<=Date.parse(receivedAt)?label:null;
   const review=reviewWeatherParticipation(row.actions,{trades,complete:!error&&!cursor,reviewedAt:new Date(Math.min(now,Date.parse(receivedAt))).toISOString(),outcome,marketType:row.market.market_type,notionalValueUsd:Number(row.market.notional_value_dollars)});
   return {ticker:row.ticker,tradePages:pages,market,marketReceivedAt:receivedAt,rulesMatch,errors:error?[error]:[],review};
  });
  const packet={kind:'weather-participation-review-v1',at:new Date().toISOString(),snapshotId,rows,orderEffect:false,tradeAuthority:false};const evidenceId=digest(packet);await archivePacket(join(root,'evidence',evidenceId+'.json.gz'),packet);return {evidenceId,...packet};
 }
 if(proposalActionIds!==undefined||carryPolicy!==undefined)throw new TypeError('proposal or carry policy needs a captured snapshotId');
 if(!Number.isFinite(capitalUsd)||capitalUsd<0||!Number.isFinite(encumberedUsd)||encumberedUsd<0||!Number.isInteger(contracts)||contracts<1||contracts>10000||!Number.isInteger(windowSeconds)||windowSeconds<5||windowSeconds>300)throw new TypeError('explicit scenario capital, whole contracts and 5..300-second window required');
 if(tickers!==undefined&&(!Array.isArray(tickers)||tickers.length<1||tickers.length>2000||new Set(tickers).size!==tickers.length||tickers.some(t=>typeof t!=='string'||t.length>120)))throw new TypeError('1..2000 distinct weather tickers required');
 if(quoteIntents!==undefined&&(!Array.isArray(quoteIntents)||quoteIntents.length<1||quoteIntents.length>4000||quoteIntents.some(q=>!q||typeof q.ticker!=='string'||q.ticker.length>120||!['yes','no'].includes(q.side)||!Number.isFinite(q.price)||q.price<=0||q.price>=1||(q.quantity!==undefined&&(!Number.isInteger(q.quantity)||q.quantity<1||q.quantity>10000)))))throw new TypeError('scoped quote intents require a ticker, side, finite price and optional whole quantity');
 if(maxMarkets!==undefined&&(!Number.isInteger(maxMarkets)||maxMarkets<1||maxMarkets>2000||tickers!==undefined))throw new TypeError('maxMarkets must be 1..2000 for automatic selection');
 const {record:state}=await readWeatherSourceRecord({root,file:'latest.json',emptyRecord:{status:'no weather cycle recorded'}});if(!Number.isFinite(Date.parse(state.at))||Date.parse(state.at)>now||now-Date.parse(state.at)>15*60000)throw new TypeError('weather evidence needs a causal receipt within fifteen minutes');
 const byTicker=new Map((state.contracts??[]).map(c=>[c.ticker,c]));let forecasts=(state.forecasts??[]).filter(r=>r.models?.some(m=>Number.isFinite(m.p))&&Date.parse(r.closeTime)>now),availableCapitalUsd=Math.max(0,capitalUsd-encumberedUsd);
 const liveIndexDiscovery=[],discoveryErrors=[];
 if(tickers===undefined){
  // New hourly listings can appear between physical collection cycles. Bind
  // them now against already-received weather evidence; no new weather model fit.
  const indexSeries=[...new Map([...byTicker.values()].filter(c=>c.binding?.kind==='index-at'&&['nyc','miami','la-coastal'].includes(c.binding.city)).map(c=>[c.seriesTicker,c])).values()].slice(0,3),sourceId=forecasts.find(r=>r.evidenceId)?.evidenceId;
  if(sourceId&&indexSeries.length){
   const evidence=await weatherEvidence({root,evidenceId:sourceId});
   await mapLimit(indexSeries,2,async template=>{try{
    const series=await client.getSeries(template.seriesTicker),markets=[],pages=[],seen=new Set();let cursor;
    // The existing 2,000-contract selection envelope also bounds new listing
    // discovery. Retain incomplete coverage rather than silently paging forever.
    for(let page=0;page<Math.ceil((maxMarkets??2000)/1000);page++){
     const packet=await client.call('GET','/markets',{signed:false,query:{series_ticker:template.seriesTicker,status:'open',limit:1000,cursor}}),receivedAt=new Date().toISOString();pages.push({receivedAt,packet});
     if(!Array.isArray(packet.markets)||packet.markets.some(m=>m?.series_ticker!==undefined&&m.series_ticker!==template.seriesTicker))throw new TypeError('scoped live index markets required');markets.push(...packet.markets);
     cursor=packet.cursor??'';if(typeof cursor!=='string'||cursor&&seen.has(cursor))throw new TypeError('live index cursor invalid or nonadvancing');if(!cursor)break;seen.add(cursor);
    }
    const receivedAt=pages.at(-1)?.receivedAt??new Date().toISOString();liveIndexDiscovery.push({series,markets,pages,receivedAt,complete:!cursor});
    if(cursor)discoveryErrors.push({series:template.seriesTicker,error:'live listing discovery reached the selected contract envelope; coverage incomplete'});
    for(const market of markets){
     if(forecasts.some(r=>r.ticker===market.ticker)||Date.parse(market.close_time)<=Date.parse(receivedAt))continue;
     const c=weatherIndexContractScope(weatherContract(market,series),evidence,Date.parse(receivedAt));c.rulesHash=digest({primary:c.rules_primary,secondary:c.rules_secondary});
     const models=weatherEstimates(c,evidence,Date.parse(receivedAt));if(!models.length)continue;
     const b=c.binding,stageValue=stage(c,Date.parse(receivedAt)),bands=models.map(m=>({...m,band:probabilityBand({...c,station:b?.station??null,stage:stageValue},m,state.grades??{})}));byTicker.set(c.ticker,c);
     forecasts.push({ticker:c.ticker,eventTicker:c.event_ticker,closeTime:c.close_time,...marketSettlementTiming(c),family:c.family,station:'index:'+b.city,rulesHash:c.rulesHash,ruleKey:c.ruleKey,stage:stageValue,mid:mid(c),models:bands,evidenceId:sourceId,derivedAt:receivedAt,...forecastCell(c,models)});
    }
   }catch(e){discoveryErrors.push({series:template.seriesTicker,error:e.message});}});
  }
 }
 let selected;
 if(tickers)selected=tickers.map(t=>{const r=forecasts.find(r=>r.ticker===t);if(!r)throw new TypeError('no prospective weather probabilities for '+t);return r;});
 else {
  const sorted=[...forecasts].sort((a,b)=>Date.parse(a.closeTime)-Date.parse(b.closeTime)||Math.abs((a.mid??0)-.5)-Math.abs((b.mid??0)-.5)),groups=new Map();
  for(const r of sorted){const group=r.station??r.family;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(r);}
  selected=[];const selectionLimit=maxMarkets??2000;while(selected.length<selectionLimit&&[...groups.values()].some(g=>g.length))for(const g of groups.values()){if(g.length&&selected.length<selectionLimit)selected.push(g.shift());}
 }
 if(quoteIntents?.some(q=>!selected.some(r=>r.ticker===q.ticker)))throw new TypeError('proposed quote ticker is outside the selected capture');
 const errors=[...discoveryErrors],marketBatches=[],marketObservations=new Map(),seriesObservations=new Map(),eventObservations=new Map();
 const chunks=rows=>Array.from({length:Math.ceil(rows.length/100)},(_,i)=>rows.slice(i*100,(i+1)*100));
 await mapLimit(chunks(selected),2,async batch=>{try{
  const packet=await client.call('GET','/markets',{signed:false,query:{tickers:batch.map(r=>r.ticker).join(','),limit:1000}}),receivedAt=new Date().toISOString(),requested=new Set(batch.map(r=>r.ticker));
  marketBatches.push({requestedTickers:[...requested],receivedAt,packet});
  if(!Array.isArray(packet.markets)||packet.cursor||new Set(packet.markets.map(m=>m.ticker)).size!==packet.markets.length||packet.markets.some(m=>!requested.has(m.ticker)))throw new TypeError('complete unique scoped market metadata required');
  for(const market of packet.markets)marketObservations.set(market.ticker,{market,receivedAt});
 }catch(e){errors.push({source:'batch-markets',tickers:batch.map(r=>r.ticker),error:e.message});}});
 const scoped=[];for(const r of selected){try{
  const c=byTicker.get(r.ticker);if(!c||c.rulesHash!==r.rulesHash)throw new TypeError('forecast rules scope missing');
  const observation=marketObservations.get(r.ticker);if(!observation)throw new TypeError('requested market missing from metadata receipt');
  const {market,receivedAt:marketReceivedAt}=observation;if(digest({primary:market.rules_primary,secondary:market.rules_secondary})!==r.rulesHash||market.event_ticker!==c.event_ticker||market.exchange_index!==c.exchange_index)throw new TypeError('fresh market changed rules, event or exchange');
  const existing=eventObservations.get(c.event_ticker);if(existing&&existing.contract.seriesTicker!==c.seriesTicker)throw new TypeError('event has conflicting series fee scope');
  if(!existing)eventObservations.set(c.event_ticker,{contract:c});scoped.push({r,c,market,marketReceivedAt});
 }catch(e){errors.push({ticker:r.ticker,error:e.message});}}
 await mapLimit([...eventObservations.values()],2,async observation=>{try{
  observation.terms=await readWeatherParticipationFees(client,observation.contract,{seriesObservations});
 }catch(e){observation.error=e.message;}});
 const prepared=scoped.filter(({r,c})=>{const observation=eventObservations.get(c.event_ticker);if(observation.error){errors.push({ticker:r.ticker,error:observation.error});return false;}return true;});
 const bookBatches=[],rows=[];
 await mapLimit(chunks(prepared),2,async batch=>{try{
  // Metadata/fees precede fresh books. Every batch keeps its own actual receipt;
  // neither concurrent requests nor a common receipt imply exchange atomicity.
  const packet=await client.call('GET','/markets/orderbooks',{signed:false,query:new URLSearchParams(batch.map(({r})=>['tickers',r.ticker]))}),receivedAt=new Date().toISOString(),requested=new Set(batch.map(({r})=>r.ticker));
  bookBatches.push({requestedTickers:[...requested],receivedAt,packet});
  if(!Array.isArray(packet.orderbooks)||new Set(packet.orderbooks.map(b=>b.ticker)).size!==packet.orderbooks.length||packet.orderbooks.some(b=>!requested.has(b.ticker)))throw new TypeError('unique scoped batch books required');
  const books=new Map(packet.orderbooks.map(b=>[b.ticker,b.orderbook_fp]));
  for(const {r,c,market,marketReceivedAt} of batch){try{
   const book=books.get(r.ticker),observedAt=receivedAt,terms=eventObservations.get(c.event_ticker).terms;
   if(!book)throw new TypeError('requested market missing from batch book receipt');
   if(Date.parse(observedAt)-Date.parse(state.at)>15*60000)throw new TypeError('forecast receipt expired during market preparation');
   const models=r.models.filter(m=>Number.isFinite(m.p)&&m.p>=0&&m.p<=1&&(!m.details?.validUntil||Date.parse(m.details.validUntil)>Date.parse(observedAt)));
   const expiresAt=new Date(Math.min(Date.parse(observedAt)+windowSeconds*1000,Date.parse(market.close_time),terms.nextFeeChangeAt?Date.parse(terms.nextFeeChangeAt):Infinity)).toISOString();
   const actions=weatherParticipationActions({market,book,series:terms.effective,models,capitalUsd:availableCapitalUsd,contracts,observedAt,expiresAt,quoteIntents:quoteIntents?.filter(q=>q.ticker===r.ticker)});
   rows.push({ticker:r.ticker,eventTicker:r.eventTicker,family:r.family,station:r.station,rulesHash:r.rulesHash,sourceEvidenceId:r.evidenceId,frozenForecastAt:state.at,contractProbabilityDerivedAt:r.derivedAt??state.at,marketReceivedAt,market,book,feeObservations:terms,frozenModels:models,actions});
  }catch(e){errors.push({ticker:r.ticker,error:e.message});}}
 }catch(e){errors.push({source:'batch-orderbooks',tickers:batch.map(({r})=>r.ticker),error:e.message});}});
 // Keep deterministic selection order without rewriting individual receipt clocks.
 const positions=new Map(selected.map((r,i)=>[r.ticker,i]));rows.sort((a,b)=>positions.get(a.ticker)-positions.get(b.ticker));
 const bookBatch=bookBatches.length===1?bookBatches[0].packet:null,bookBatchReceivedAt=bookBatches.length===1?bookBatches[0].receivedAt:null;
 const coverage={forecastCandidates:forecasts.length,selected:selected.length,captured:rows.length,selectionLimit:tickers?tickers.length:maxMarkets??2000,selectionTruncated:selected.length<forecasts.length,feeEvents:eventObservations.size,feeSeries:seriesObservations.size};
 const packet={kind:'weather-participation-snapshot-v1',at:new Date().toISOString(),captureStartedAt:new Date(now).toISOString(),forecastEvidenceAt:state.at,capitalUsd,encumberedUsd,availableCapitalUsd,coverage,quoteIntents:quoteIntents??[],liveIndexDiscovery,marketBatches,bookBatches,bookBatchReceivedAt,bookBatch,bookBatchAtomicity:'not guaranteed; common receipt only',rows,errors,scope:'mutually exclusive alternatives per contract side; capital feasibility is per alternative until a joint proposal is verified; existing forecast admission unchanged',orderEffect:false,tradeAuthority:false};
 await mkdir(join(root,'evidence'),{recursive:true,mode:0o700});const evidenceId=digest(packet);await archivePacket(join(root,'evidence',evidenceId+'.json.gz'),packet);return {evidenceId,...packet};
}
