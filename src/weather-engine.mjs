import {INDEX_CITIES} from './weather-index.mjs';
import { binarySettlement } from '../../../src/market-facts.mjs';
import {randomUUID} from 'node:crypto';
import {updateStationScience,readStationScience,stationPointForecasts} from './station-weather-science.mjs';
import { readFile, writeFile, mkdir, rename, readdir, appendFile, rm, stat, link } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createKalshiClient } from '../../../src/client.mjs';
import { digest, discoverWeather, weatherRuleKey, mapLimit } from './weather-universe.mjs';
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
  try{evidence.science=await locked(join(root,'station-science'),()=>updateStationScience(evidence,{root:join(root,'station-science'),now:Date.now(),sourceEvidenceId}));}
  catch(e){if(e.code!=='WEATHER_CYCLE_RUNNING')throw e;const report=await readStationScience({root:join(root,'station-science')});evidence.science={...report,status:'another station-science update is running',forecasts:stationPointForecasts(evidence,{parameters:report.parameters}),outcomes:[]};}
  evidence.sourceEvidenceId=sourceEvidenceId;
  const evidenceId=digest(evidence);await archivePacket(join(root,'evidence',`${evidenceId}.json.gz`),evidence);return evidenceId;
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
export async function weatherEvidence({root=weatherRoot(),evidenceId,station}={}) {
  if(!/^[a-f0-9]{64}$/.test(evidenceId??''))throw new TypeError('content-addressed evidenceId required');
  const e=JSON.parse(gunzipSync(await readFile(join(root,'evidence',`${evidenceId}.json.gz`))));
  if(station?.startsWith('index:'))return {at:e.at,station,sourceEvidenceId:e.sourceEvidenceId,index:e.indices?.[station.slice(6)]??null,science:e.science?{...e.science,metrics:e.science.metrics?.filter(r=>r.station===station),comparisons:e.science.comparisons?.filter(r=>r.station===station),parameters:Object.fromEntries(Object.entries(e.science.parameters??{}).filter(([k])=>k.startsWith(station+'/'))),forecasts:e.science.forecasts?.filter(r=>r.station===station),outcomes:e.science.outcomes?.filter(r=>r.forecast.station===station)}:null};
  return station?{at:e.at,station,sourceEvidenceId:e.sourceEvidenceId,science:e.science?{...e.science,metrics:e.science.metrics?.filter(r=>r.station===station),comparisons:e.science.comparisons?.filter(r=>r.station===station),parameters:Object.fromEntries(Object.entries(e.science.parameters??{}).filter(([k])=>k.startsWith(station+'/'))),forecasts:e.science.forecasts?.filter(r=>r.station===station),outcomes:e.science.outcomes?.filter(r=>r.forecast.station===station)}:null,lamp:e.lamp?{runtime:e.lamp.runtime,source:e.lamp.source,extendedSource:e.lamp.extendedSource,station:e.lamp.stations[station]}:null,guidance:e.guidance?.stations[station],hourlyGuidance:e.hourlyGuidance?{runtime:e.hourlyGuidance.runtime,source:e.hourlyGuidance.source,station:e.hourlyGuidance.stations[station]}:null,quantiles:e.quantiles?{runtime:e.quantiles.runtime,source:e.quantiles.source,station:e.quantiles.stations[station]}:null,settlementReports:Object.fromEntries(Object.entries(e.settlement?.daily??{}).map(([date,r])=>[date,{source:r.source,results:r.data?.results?.filter(x=>x.station?.icao===station)}])),local:e.local[station],observations:Object.fromEntries(Object.entries(e.observations).filter(([key])=>key.startsWith(station+'/'))),errors:e.errors.filter(r=>!r.station||r.station===station)}:e;
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
  for await(const r of resolvedRows(root))if(r.settlementEvidenceVersion===1&&r.settlement&&Number.isFinite(Date.parse(r.at))&&Date.parse(r.at)<Date.parse(r.settlement.settledAt))for(const m of r.models){const k=key(r,m),at=first.get(k);if(at===undefined||r.at.localeCompare(at)<0)first.set(k,r.at);}
  const accumulator=createModelGradeAccumulator();
  for await(const r of resolvedRows(root))if(r.settlementEvidenceVersion===1&&r.settlement&&Number.isFinite(Date.parse(r.at))&&Date.parse(r.at)<Date.parse(r.settlement.settledAt))for(const m of r.models){const k=key(r,m);if(first.get(k)!==r.at)continue;first.delete(k);accumulator.add({...r,models:[m]});}
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
    const evidence=await collectWeatherEvidence(universe.markets,{cacheDir:join(root,'nbm'),now:Date.now(),fetchImpl});
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
      const row={ticker:c.ticker,eventTicker:c.event_ticker,title:c.title,family:c.family,source:c.source,stage:s,targetDate:b?.targetDate??null,closeTime:c.close_time,ruleKey:c.ruleKey,rulesHash:c.rulesHash,station:b?.station??null,mid:midpoint,marketObservedAt:quoteTimes.get(c.ticker)??null,models:modelBands,evidenceId,settlementReport:sourceReport(c,evidence.settlement),...support,blocker:c.blocker};
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
    const result={science,at:new Date().toISOString(),collectionStartedAt:new Date(now).toISOString(),complete:universe.complete,series:universe.series,marketCount:contracts.length,modelled:rows.filter(r=>r.models.length).length,families,errors:[...universe.errors,...evidence.errors],scoring:{settled:scoring.settled,pending:Object.keys(pending).length,errors:scoring.errors},grades:scoring.grades,forecasts:rows,contracts,opportunities,research,allocation:allocateWeather(opportunities.filter(o=>Date.parse(o.quoteExpiresAt)>Date.now()),{capitalUsd,encumberedUsd}),orderEffect:false};
    await atomic(join(root,'latest.json'),result);return result;
  });
}
