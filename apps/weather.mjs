#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { weatherParticipation, weatherRoot, weatherEcmwfEvidence, weatherStrategyResearch,weatherRelationalNowcast, weatherRelationalScience, runWeatherCycle, scoreWeather, weatherStatus, allocateLiveWeather, admitWeatherModel } from '../src/weather-engine.mjs';
const [command,...args]=process.argv.slice(2);
const opt=(key,fallback)=>{const i=args.indexOf(`--${key}`);return i<0?fallback:args[i+1];};
const root=opt('state',weatherRoot());
try {
  let result;
  if(command==='cycle')result=await runWeatherCycle({root,capitalUsd:Number(opt('capital',0)),encumberedUsd:Number(opt('encumbered',0))}).catch(e=>{if(e.code==='WEATHER_CYCLE_RUNNING')return {status:'already-running',orderEffect:false};throw e;});
  else if(command==='participation')result=await weatherParticipation({root,...(opt('snapshot')?{snapshotId:opt('snapshot'),...(opt('carry')?{carryPolicy:JSON.parse(opt('carry'))}:{}),...(opt('actions')?{proposalActionIds:JSON.parse(opt('actions'))}:{})}:{...(opt('quotes')?{quoteIntents:JSON.parse(opt('quotes'))}:{}),...(opt('max-markets')?{maxMarkets:Number(opt('max-markets'))}:{}),capitalUsd:Number(opt('capital',NaN)),encumberedUsd:Number(opt('encumbered',0)),contracts:Number(opt('contracts',1)),windowSeconds:Number(opt('window',60)),...(opt('tickers')?{tickers:opt('tickers').split(',')}:{})})});
  else if(command==='score')result=await scoreWeather({root});
  else if(command==='ecmwf-evidence')result=await weatherEcmwfEvidence({root,stations:JSON.parse(await readFile(opt('stations'),'utf8')),validCount:Number(opt('valid-count',1))});
  else if(command==='relational-nowcast')result=await weatherRelationalNowcast({root,region:opt('region','nyc')});
  else if(command==='strategy-research')result=await weatherStrategyResearch({root,region:opt('region','nyc')});
  else if(command==='relational-science')result=await weatherRelationalScience({root,region:opt('region','nyc')});
  else if(command==='status')result=await weatherStatus({root});
  else if(command==='model')result=await admitWeatherModel(JSON.parse(await readFile(args[0],'utf8')),{root});
  else if(command==='allocate')result=await allocateLiveWeather({root,...(args.includes('--capital')?{capitalUsd:Number(opt('capital',0)),encumberedUsd:Number(opt('encumbered',0))}:{})});
  else throw new Error('usage: weather.mjs cycle|score|status|allocate|participation [--state DIR] [--capital USD] [--encumbered USD] | model FILE | ecmwf-evidence --stations JSON_FILE [--valid-count 1..4] | relational-science|strategy-research|relational-nowcast [--region nyc|miami]');
  const output=args.includes('--full')?result:{status:result.status,running:result.running,at:result.at,complete:result.complete,series:result.series,marketCount:result.marketCount,modelled:result.modelled,families:result.families,errors:result.errors?.slice(0,8),errorCount:result.errors?.length,scoring:result.scoring,research:result.research,opportunities:result.opportunities?.length,allocation:result.allocation??(command==='allocate'?result:undefined),...(command==='participation'||command==='model'||command==='score'||command==='relational-science'||command==='strategy-research'||command==='relational-nowcast'||command==='ecmwf-evidence'?result:{}),orderEffect:false};
  console.log(JSON.stringify(output,null,2));
} catch(e){console.error(e.stack??e.message);process.exitCode=1;}
