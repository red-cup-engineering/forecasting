import {sameDayRainEvidence} from './weather-precipitation.mjs';
import {weatherCarryAllocation} from '../../../src/weather-capital.mjs';
import {weatherParticipationActions,reviewWeatherParticipation,readWeatherParticipationFees,verifyWeatherParticipationProposal} from '../../../src/weather-participation.mjs';
import {collectEcmwfEnsemble} from './weather-ecmwf-ensemble.mjs';
import {collectRelationalWeatherNowcast} from './weather-relational-nowcast.mjs';
import {collectWeatherStrategyResearch} from './weather-strategy-research.mjs';
import {collectRelationalTemperatureScience} from './weather-relational-temperature.mjs';
import {deriveDailyTemperatureExtremes} from './weather-temperature-extremes.mjs';
import {INDEX_CITIES} from './weather-index.mjs';
import { binarySettlement } from '../../../src/market-facts.mjs';
import {randomUUID,createHash} from 'node:crypto';
import {updateStationScience,readStationScience,stationPointForecasts,stationScienceReport} from './station-weather-science.mjs';
import { readFile, writeFile, mkdir, rename, readdir, appendFile, rm, stat, link } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createKalshiClient } from '../../../src/client.mjs';
import { digest, discoverWeather, weatherContract, weatherRuleKey, mapLimit } from './weather-universe.mjs';
import { collectWeatherEvidence, collectStationWeatherEvidence, weatherEstimates, forecastCell } from './weather-evidence.mjs';
import { createModelGradeAccumulator, probabilityBand, allocateWeather } from './weather-learning.mjs';
import {sourceReport} from './weather-settlement-source.mjs';
import { bracketSettlesYes } from './temperature-distribution.mjs';

export const weatherRoot=(env=process.env)=>env.KALSHI_WEATHER_STATE_DIR??join(homedir(),'.local/state/561-group/settlements/kalshi-services-section/weather');
export function weatherClient({fetchImpl=fetch}={}) {
  let next=0;
  const paced=async(url,options)=>{
    for(let attempt=0;attempt<5;attempt++){
      const slot=Math.max(Date.now(),next);next=slot+400;
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,slot-Date.now())));
      const r=await fetchImpl(url,{...options,signal:AbortSignal.timeout(20000)});
      if(r.status!==429||attempt===4)return r;
      const delay=Math.max(1000*2**attempt,Number(r.headers.get('retry-after')??0)*1000);
      await r.arrayBuffer();await new Promise(resolve=>setTimeout(resolve,delay));
    }
  };
  return createKalshiClient({credentials:null,fetchImpl:paced});
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
  catch(e){if(e.code!=='WEATHER_CYCLE_RUNNING')throw e;const learningState=await read(join(root,'station-science','state.json'),{}),report=stationScienceReport(learningState);evidence.science={...report,status:'another station-science update is running; read-only publication from the last atomic paired outcome state',learningStateAt:learningState.at??null,forecasts:stationPointForecasts(evidence,{parameters:learningState.parameters??{},learningState}),outcomes:[]};}
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
 const evidenceId=await archiveWeatherEvidence(evidence,root);return {at:packet.at,region,evidenceId,source:packet.source,trainingId:packet.training.id,selection:packet.training.selection,gaps:packet.gaps,science:evidence.science,orderEffect:false};
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
export async function weatherStationEvidence({stations,root=weatherRoot(),now=Date.now(),fetchImpl=fetch}={}) {
  const evidence=await collectStationWeatherEvidence(stations,{cacheDir:join(root,'nbm'),now,fetchImpl});
  const evidenceId=await archiveWeatherEvidence(evidence,root);
  return {evidenceId,...evidence,orderEffect:false};
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
export async function weatherStatus({root=weatherRoot()}={}) {
  const result=await read(join(root,'latest.json'),{status:'no weather cycle recorded',orderEffect:false});
  let running=null;const lock=await read(join(root,'cycle.lock'),null);
  if(lock&&await processStart(lock.pid)===lock.start)running={startedAt:new Date(lock.at).toISOString()};
  return {...result,running,lastFailure:await read(join(root,'last-failure.json'),null)};
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
async function gradeHistory(root){
  // Keep only the earliest timestamp per contract/horizon/model; never retain full history objects.
  const first=new Map(),key=(r,m)=>`${r.ticker}/${r.stage}/${r.ruleKey}/${m.id}`;
  for await(const r of resolvedRows(root))for(const m of r.models){const k=key(r,m),at=first.get(k);if(at===undefined||r.at.localeCompare(at)<0)first.set(k,r.at);}
  const accumulator=createModelGradeAccumulator();
  for await(const r of resolvedRows(root))for(const m of r.models){const k=key(r,m);if(first.get(k)!==r.at)continue;first.delete(k);accumulator.add({...r,models:[m]});}
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
async function quoteWeatherContract(c,models,evidence,client) {
  if(c.blocker&&!models.some(m=>m.directContractForecast))return [];
  const qualified=models.filter(m=>m.band.admitted&&(!m.details?.validUntil||Date.parse(m.details.validUntil)>Date.now()));
  if(!qualified.length)return [];
  const lo=Math.min(...qualified.map(m=>Math.min(m.p,m.band.low))),hi=Math.max(...qualified.map(m=>Math.max(m.p,m.band.high)));
  if(c.family==='hourly-temperature'&&c.binding){
    for(const row of qualified.flatMap(m=>m.details?.stationForecasts??[])){const hazards=evidence.local[row.station.slice(0,4)]?.alerts;if(!hazards||hazards.warm.length||hazards.cold.length)return [];}
  }
  if(c.family==='daily-temperature'&&c.binding){
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
    const fee=Math.ceil(100*0.07*c.feeMultiplier*price*(1-price))/100,edge=side.p-price-fee;
    if(edge>0)out.push({ticker:c.ticker,eventTicker:c.event_ticker,targetDate:c.binding?.targetDate,closeTime:fresh.close_time,exchangeIndex:c.exchange_index,side:side.side,price,depth,fee,edge,winLower:side.p,admitted:true,modelIds:qualified.map(m=>m.id),rulesHash:c.rulesHash,observedAt:new Date().toISOString(),quoteExpiresAt:new Date(Date.now()+60000).toISOString()});
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

export async function runWeatherCycle({root=weatherRoot(),client=weatherClient(),now=Date.now(),fetchImpl=fetch,capitalUsd=0,encumberedUsd=0}={}) {
  return locked(root,async()=>{
    const scoring=await scorePending(root,client,now);
    const universe=await discoverWeather(client);
    const publish=async evidence=>{
    const evidenceId=await archiveWeatherEvidence(evidence,root);
    const quoteTimes=new Map(),freshQuotes=new Map();
    const quoted=universe.markets;
    for(let i=0;i<quoted.length;i+=100){
      const batch=quoted.slice(i,i+100);
      try{for(const m of await client.getMarkets({tickers:batch.map(c=>c.ticker).join(',')})){freshQuotes.set(m.ticker,m);quoteTimes.set(m.ticker,new Date().toISOString());}}
      catch(e){evidence.errors.push({source:'fresh-market-quotes',error:e.message});}
    }
    const decisionNow=Date.now();
    const contracts=universe.markets.map(c=>{const fresh=freshQuotes.get(c.ticker);if(!fresh)return c;const changed=digest({primary:c.rules_primary,secondary:c.rules_secondary})!==digest({primary:fresh.rules_primary,secondary:fresh.rules_secondary});return {...c,...fresh,...(changed?{ruleKey:weatherRuleKey(fresh,c.seriesTicker,c.source,c.stationRule),binding:null,blocker:'rules changed during collection; rebind next cycle'}:{})};}).map(c=>({...c,rulesHash:digest({primary:c.rules_primary,secondary:c.rules_secondary})}));
    for(const c of contracts)if(c.binding?.kind==='index-at'&&evidence.indices?.[c.binding.city]?.blocker)c.blocker=evidence.indices[c.binding.city].blocker;
    const ex=await experiments(root,contracts,decisionNow),pending=await read(join(root,'pending.json'),{}),rows=[],opportunities=[];
    await mapLimit(contracts,3,async c=>{
      const s=stage(c,decisionNow),models=weatherEstimates(c,evidence,decisionNow);
      models.push(...(ex.get(c.ticker)?.values()??[]));
      const midpoint=quoteTimes.has(c.ticker)?mid(c):null,b=c.binding,modelBands=models.map(m=>({...m,band:probabilityBand({...c,station:b?.station??null,stage:s},m,scoring.grades)}));
      const support=forecastCell(c,models);
      const row={ticker:c.ticker,eventTicker:c.event_ticker,title:c.title,family:c.family,source:c.source,stage:s,targetDate:b?.targetDate??null,closeTime:c.close_time,ruleKey:c.ruleKey,rulesHash:c.rulesHash,station:b?.station??null,...(b?.kind==='rain'?{rainNowcast:sameDayRainEvidence(c,evidence,decisionNow)}:{}),mid:midpoint,marketObservedAt:quoteTimes.get(c.ticker)??null,models:modelBands,evidenceId,settlementReport:sourceReport(c,evidence.settlement),...support,blocker:c.blocker};
      rows.push(row);
      if(models.length&&midpoint!==null&&c.status==='active'&&Date.parse(c.close_time)>Date.now()){
        const forecast={at:new Date().toISOString(),...row,models:models.map(m=>({id:m.id,p:m.p,details:m.details}))};
        const id=digest({ticker:c.ticker,stage:s,rules:c.rulesHash,models:models.map(m=>m.id).sort()});
        pending[id]??=forecast;
      }
      try{opportunities.push(...await quoteWeatherContract(c,modelBands,evidence,client));}catch(e){row.bookError=e.message;}

    });
    await atomic(join(root,'pending.json'),pending);
    const families={};for(const c of contracts){families[c.family]??={markets:0,modelled:0,volume24h:0};families[c.family].markets++;families[c.family].volume24h+=Number(c.volume_24h_fp??0);if(rows.find(r=>r.ticker===c.ticker)?.models.length)families[c.family].modelled++;}
    const research=Object.entries(families).filter(([_,v])=>v.modelled<v.markets).sort((a,b)=>b[1].volume24h-a[1].volume24h).map(([family,v])=>({family,...v,nextEffect:family==='hourly-temperature'?'bind official station/time and score short-horizon observation-conditioned forecasts':family==='precipitation'?'bind interval totals; validate probabilistic accumulation forecasts':family==='tropical'?'bind NHC event definitions and calibrate track/intensity ensembles':family==='snow'?'bind reporting station and validate snow accumulation ensembles':'bind settlement transformation and submit versioned forecasts'}));
    const {forecasts:physicalForecasts,outcomes:physicalOutcomes,...science}=evidence.science??{};
    const result={science,at:new Date().toISOString(),collectionStartedAt:new Date(now).toISOString(),complete:universe.complete,evidenceComplete:evidence.acquisition?.complete??true,acquisition:evidence.acquisition,series:universe.series,marketCount:contracts.length,modelled:rows.filter(r=>r.models.length).length,families,errors:[...universe.errors,...evidence.errors],scoring:{settled:scoring.settled,pending:Object.keys(pending).length,errors:scoring.errors},grades:scoring.grades,forecasts:rows,contracts,opportunities,research,allocation:allocateWeather(opportunities.filter(o=>Date.parse(o.quoteExpiresAt)>Date.now()),{capitalUsd,encumberedUsd}),orderEffect:false};
    await atomic(join(root,'latest.json'),result);return result;
    };
    const evidence=await collectWeatherEvidence(universe.markets,{cacheDir:join(root,'nbm'),now:Date.now(),fetchImpl,onEvidence:async packet=>{
      // A frozen, useful projection can reach existing consumers while slower
      // providers continue. Empty projections leave the prior publication intact.
      if(!universe.markets.some(c=>weatherEstimates(c,packet,Date.now()).length))return false;
      await publish(packet);return true;
    }});
    return publish(evidence);
  });
}

/** Market participation consumes frozen forecast evidence; it never generates
 * physical forecasts or changes their admission. Capture and review are read-only
 * venue operations, retained in the existing content-addressed evidence carrier. */
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
  if(proposalActionIds!==undefined)return {snapshotId,...verifyWeatherParticipationProposal(snapshot,{actionIds:proposalActionIds},{now})};
  const rows=await mapLimit(snapshot.rows,2,async row=>{
   const pages=[],trades=[];let cursor,error=null;const end=Math.min(now,Date.parse(row.actions.expiresAt));
   try {for(let page=0;page<3;page++){
    const packet=await client.call('GET','/markets/trades',{signed:false,query:{ticker:row.ticker,min_ts:Math.floor(Date.parse(row.actions.observedAt)/1000),max_ts:Math.ceil(end/1000),is_block_trade:false,limit:1000,cursor}});
    pages.push({receivedAt:new Date().toISOString(),packet});if(!Array.isArray(packet.trades))throw new TypeError('trade tape missing');trades.push(...packet.trades);cursor=packet.cursor;if(!cursor)break;
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
 const state=await weatherStatus({root});if(!Number.isFinite(Date.parse(state.at))||Date.parse(state.at)>now||now-Date.parse(state.at)>15*60000)throw new TypeError('weather evidence needs a causal receipt within fifteen minutes');
 const byTicker=new Map((state.contracts??[]).map(c=>[c.ticker,c]));let forecasts=(state.forecasts??[]).filter(r=>r.models?.some(m=>Number.isFinite(m.p))&&Date.parse(r.closeTime)>now),availableCapitalUsd=Math.max(0,capitalUsd-encumberedUsd);
 const liveIndexDiscovery=[],discoveryErrors=[];
 if(tickers===undefined){
  // New hourly listings can appear between physical collection cycles. Bind
  // them now against already-received weather evidence; no new weather model fit.
  const indexSeries=[...new Map([...byTicker.values()].filter(c=>c.binding?.kind==='index-at'&&['nyc','miami','la-coastal'].includes(c.binding.city)).map(c=>[c.seriesTicker,c])).values()].slice(0,3),sourceId=forecasts.find(r=>r.evidenceId)?.evidenceId;
  if(sourceId&&indexSeries.length){
   const evidence=await weatherEvidence({root,evidenceId:sourceId});
   await mapLimit(indexSeries,2,async template=>{try{
    const series=await client.getSeries(template.seriesTicker),markets=await client.getMarkets({series_ticker:template.seriesTicker,status:'open'}),receivedAt=new Date().toISOString();liveIndexDiscovery.push({series,markets,receivedAt});
    for(const market of markets){
     if(forecasts.some(r=>r.ticker===market.ticker)||Date.parse(market.close_time)<=Date.parse(receivedAt))continue;
     const c=weatherContract(market,series);c.rulesHash=digest({primary:c.rules_primary,secondary:c.rules_secondary});
     const models=weatherEstimates(c,evidence,Date.parse(receivedAt));if(!models.length)continue;
     const b=c.binding,stageValue=stage(c,Date.parse(receivedAt)),bands=models.map(m=>({...m,band:probabilityBand({...c,station:b?.station??null,stage:stageValue},m,state.grades??{})}));byTicker.set(c.ticker,c);
     forecasts.push({ticker:c.ticker,eventTicker:c.event_ticker,closeTime:c.close_time,family:c.family,station:'index:'+b.city,rulesHash:c.rulesHash,ruleKey:c.ruleKey,stage:stageValue,mid:mid(c),models:bands,evidenceId:sourceId,derivedAt:receivedAt,...forecastCell(c,models)});
    }
   }catch(e){discoveryErrors.push({series:template.seriesTicker,error:e.message});}});
  }
 }
 let selected;
 if(tickers)selected=tickers.map(t=>{const r=forecasts.find(r=>r.ticker===t);if(!r)throw new TypeError('no prospective weather probabilities for '+t);return r;});
 else {
  const sorted=[...forecasts].sort((a,b)=>Date.parse(a.closeTime)-Date.parse(b.closeTime)||Math.abs((a.mid??0)-.5)-Math.abs((b.mid??0)-.5)),groups=new Map();
  for(const r of sorted){const group=r.station??r.family;if(!groups.has(group))groups.set(group,[]);groups.get(group).push(r);}
  selected=[];const selectionLimit=maxMarkets??Infinity;while(selected.length<selectionLimit&&[...groups.values()].some(g=>g.length))for(const g of groups.values()){if(g.length&&selected.length<selectionLimit)selected.push(g.shift());}
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
 const coverage={forecastCandidates:forecasts.length,selected:selected.length,captured:rows.length,selectionLimit:maxMarkets??null,selectionTruncated:selected.length<forecasts.length,feeEvents:eventObservations.size,feeSeries:seriesObservations.size};
 const packet={kind:'weather-participation-snapshot-v1',at:new Date().toISOString(),captureStartedAt:new Date(now).toISOString(),forecastEvidenceAt:state.at,capitalUsd,encumberedUsd,availableCapitalUsd,coverage,quoteIntents:quoteIntents??[],liveIndexDiscovery,marketBatches,bookBatches,bookBatchReceivedAt,bookBatch,bookBatchAtomicity:'not guaranteed; common receipt only',rows,errors,scope:'mutually exclusive alternatives per contract side; capital feasibility is per alternative until a joint proposal is verified; existing forecast admission unchanged',orderEffect:false,tradeAuthority:false};
 await mkdir(join(root,'evidence'),{recursive:true,mode:0o700});const evidenceId=digest(packet);await archivePacket(join(root,'evidence',evidenceId+'.json.gz'),packet);return {evidenceId,...packet};
}
