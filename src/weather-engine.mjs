import { readFile, writeFile, mkdir, rename, readdir, appendFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createKalshiClient } from '../../../src/client.mjs';
import { digest, discoverWeather, mapLimit } from './weather-universe.mjs';
import { collectWeatherEvidence, weatherEstimates, forecastCell } from './weather-evidence.mjs';
import { gradeModels, probabilityBand, allocateWeather } from './weather-learning.mjs';
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
      if(old&&(await processStart(old.pid))===old.start)throw new Error('weather cycle already running');
      await rm(lock,{force:true});
      if(attempt===2)throw new Error('weather cycle lock contention');
    }
  }
  try{return await fn();}finally{await rm(lock,{force:true});}
}

export async function weatherEvidence({root=weatherRoot(),evidenceId,station}={}) {
  if(!/^[a-f0-9]{64}$/.test(evidenceId??''))throw new TypeError('content-addressed evidenceId required');
  const e=JSON.parse(gunzipSync(await readFile(join(root,'evidence',`${evidenceId}.json.gz`))));
  return station?{at:e.at,station,guidance:e.guidance?.stations[station],local:e.local[station],observations:Object.fromEntries(Object.entries(e.observations).filter(([key])=>key.startsWith(station+'/'))),errors:e.errors.filter(r=>r.station===station)}:e;
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
    await mkdir(root,{recursive:true});await atomic(join(root,'last-failure.json'),{startedAt,failedAt:new Date().toISOString(),reason:e.message});
  }).catch(()=>{});
  return {status:'started',startedAt,readResultWith:'weather_status',orderEffect:false};
}

function stage(c,now){const h=(Date.parse(c.close_time)-now)/3600000;return h<=6?'0-6h':h<=12?'6-12h':h<=24?'12-24h':h<=48?'24-48h':'48h+';}
function mid(c){const a=Number(c.yes_ask_dollars),b=Number(c.yes_bid_dollars);return a>0&&a<=1&&b>=0&&b<a?(a+b)/2:null;}
async function resolvedRows(root){
  const out=[];
  try{const lines=createInterface({input:createReadStream(join(root,'resolved.jsonl')),crlfDelay:Infinity});for await(const line of lines)if(line)out.push(JSON.parse(line));}
  catch(e){if(e.code!=='ENOENT')throw e;}
  return out;
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
    if(m?.status!=='settled'||!['yes','no'].includes(m.result))continue;
    settled.push({...r,id,outcome:m.result==='yes'?1:0,scoredAt:new Date(now).toISOString(),venueResult:m.result,settledAt:m.settlement_ts??m.expiration_time});delete pending[id];
  }

  // A per-record immutable score file makes recovery after interruption idempotent.
  await mkdir(join(root,'scores'),{recursive:true});
  const known=new Set((await resolvedRows(root)).map(r=>r.id));
  for(const r of settled){try{await writeFile(join(root,'scores',`${r.id}.json`),JSON.stringify(r)+'\n',{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}}
  for(const file of await readdir(join(root,'scores'))){const r=await read(join(root,'scores',file));if(!known.has(r.id)){await appendFile(join(root,'resolved.jsonl'),JSON.stringify(r)+'\n',{mode:0o600});known.add(r.id);}}
  await atomic(join(root,'pending.json'),pending);
  const rs=await resolvedRows(root);
  // First pre-settlement forecast per ticker, stage and model version. No repeated-look sample inflation.
  const first=new Map();
  for(const r of rs.sort((a,b)=>a.at.localeCompare(b.at)))for(const m of r.models){const key=`${r.ticker}/${r.stage}/${r.ruleKey}/${m.id}`;if(!first.has(key))first.set(key,{...r,models:[m]});}
  const grades=gradeModels([...first.values()]);await atomic(join(root,'grades.json'),grades);
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
    if(p!==undefined){if(!out.has(c.ticker))out.set(c.ticker,new Map());out.get(c.ticker).set(`${r.model}@${r.version}`,{id:`${r.model}@${r.version}`,p,directContractForecast:direct,details:{recordId:digest(r),source:r.sourceUrl,issuedAt:r.issuedAt,receivedAt:r.receivedAt,ensembleMembers:e?.samples.length??null}});}
  }
  return out;
}
export async function runWeatherCycle({root=weatherRoot(),client=weatherClient(),now=Date.now(),fetchImpl=fetch,capitalUsd=0,encumberedUsd=0}={}) {
  return locked(root,async()=>{
    const scoring=await scorePending(root,client,now);
    const universe=await discoverWeather(client);
    const evidence=await collectWeatherEvidence(universe.markets,{cacheDir:join(root,'nbm'),now,fetchImpl});
    await mkdir(join(root,'evidence'),{recursive:true});const evidenceId=digest(evidence);await writeFile(join(root,'evidence',`${evidenceId}.json.gz`),gzipSync(JSON.stringify(evidence)),{mode:0o600});
    const quoteTimes=new Map(),freshQuotes=new Map();
    const quoted=universe.markets;
    for(let i=0;i<quoted.length;i+=100){
      const batch=quoted.slice(i,i+100);
      try{for(const m of await client.getMarkets({tickers:batch.map(c=>c.ticker).join(',')})){freshQuotes.set(m.ticker,m);quoteTimes.set(m.ticker,new Date().toISOString());}}
      catch(e){evidence.errors.push({source:'fresh-market-quotes',error:e.message});}
    }
    const decisionNow=Date.now();
    const contracts=universe.markets.map(c=>{const fresh=freshQuotes.get(c.ticker);if(!fresh)return c;const changed=digest({primary:c.rules_primary,secondary:c.rules_secondary})!==digest({primary:fresh.rules_primary,secondary:fresh.rules_secondary});return {...c,...fresh,...(changed?{binding:null,blocker:'rules changed during collection; rebind next cycle'}:{})};}).map(c=>({...c,rulesHash:digest({primary:c.rules_primary,secondary:c.rules_secondary})}));
    const ex=await experiments(root,contracts,now),pending=await read(join(root,'pending.json'),{}),rows=[],opportunities=[];
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
      if(c.blocker&&!modelBands.some(m=>m.directContractForecast))return;
      const qualified=modelBands.filter(m=>m.band.admitted);
      if(!qualified.length)return;
      const lo=Math.min(...qualified.map(m=>Math.min(m.p,m.band.low))),hi=Math.max(...qualified.map(m=>Math.max(m.p,m.band.high)));
      // Model disagreement contributes uncertainty; hazards revoke experimental temperature opportunities.
      if(c.family==='daily-temperature'&&b){
        const hazards=evidence.local[b?.station]?.alerts;
        if(!hazards||hazards.warm.length||hazards.cold.length)return;
      }
      let book;try{const fresh=await client.getMarket(c.ticker);if(fresh.status!=='active'||digest({primary:fresh.rules_primary,secondary:fresh.rules_secondary})!==c.rulesHash)return;book=await client.getOrderbook(c.ticker,10);}catch(e){row.bookError=e.message;return;}
      const sides=[{side:'yes',l:book?.no_dollars,p:lo},{side:'no',l:book?.yes_dollars,p:1-hi}];
      for(const side of sides){
        const levels=(side.l??[]).map(([p,n])=>({price:1-Number(p),depth:Math.floor(Number(n))})).filter(x=>x.price>0&&x.price<1&&x.depth>0).sort((a,b)=>a.price-b.price);
        if(!levels.length)continue;
        const {price,depth}=levels[0];
        // General taker coefficient is a conservative estimate; the executor must apply live venue fees.
        if(c.feeType!=='quadratic'||!Number.isFinite(c.feeMultiplier))return;
        const fee=Math.ceil(100*0.07*c.feeMultiplier*price*(1-price))/100,edge=side.p-price-fee;
        if(edge>0)opportunities.push({ticker:c.ticker,eventTicker:c.event_ticker,targetDate:b?.targetDate,closeTime:c.close_time,side:side.side,price,depth,fee,edge,winLower:side.p,admitted:true,modelIds:qualified.map(m=>m.id),rulesHash:c.rulesHash,observedAt:new Date().toISOString(),quoteExpiresAt:new Date(Date.now()+60000).toISOString()});
      }
    });
    await atomic(join(root,'pending.json'),pending);
    const families={};for(const c of contracts){families[c.family]??={markets:0,modelled:0,volume24h:0};families[c.family].markets++;families[c.family].volume24h+=Number(c.volume_24h_fp??0);if(rows.find(r=>r.ticker===c.ticker)?.models.length)families[c.family].modelled++;}
    const research=Object.entries(families).filter(([_,v])=>v.modelled<v.markets).sort((a,b)=>b[1].volume24h-a[1].volume24h).map(([family,v])=>({family,...v,nextEffect:family==='hourly-temperature'?'bind official station/time and score short-horizon observation-conditioned forecasts':family==='precipitation'?'bind interval totals; validate probabilistic accumulation forecasts':family==='tropical'?'bind NHC event definitions and calibrate track/intensity ensembles':family==='snow'?'bind reporting station and validate snow accumulation ensembles':'bind settlement transformation and submit versioned forecasts'}));
    const result={at:new Date().toISOString(),collectionStartedAt:new Date(now).toISOString(),complete:universe.complete,series:universe.series,marketCount:contracts.length,modelled:rows.filter(r=>r.models.length).length,families,errors:[...universe.errors,...evidence.errors],scoring:{settled:scoring.settled,pending:Object.keys(pending).length,errors:scoring.errors},grades:scoring.grades,forecasts:rows,contracts,opportunities,research,allocation:allocateWeather(opportunities.filter(o=>Date.parse(o.quoteExpiresAt)>Date.now()),{capitalUsd,encumberedUsd}),orderEffect:false};
    await atomic(join(root,'latest.json'),result);return result;
  });
}
