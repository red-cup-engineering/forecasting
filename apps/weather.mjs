#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { weatherParticipation, weatherRoot, weatherStrategyResearch,weatherRelationalNowcast, weatherRelationalScience, runWeatherCycle, weatherCadencePlan, runCadencedWeatherCycle, scoreWeather, weatherStatus, allocateLiveWeather, admitWeatherModel } from '../src/weather-engine.mjs';
const [command,...args]=process.argv.slice(2);
const opt=(key,fallback)=>{const i=args.indexOf(`--${key}`);return i<0?fallback:args[i+1];};
const root=opt('state',weatherRoot());
try {
  let result;
  if(command==='cycle')result=await runWeatherCycle({root,capitalUsd:Number(opt('capital',0)),encumberedUsd:Number(opt('encumbered',0))}).catch(e=>{if(e.code==='WEATHER_CYCLE_RUNNING')return {status:'already-running',orderEffect:false};throw e;});
  else if(command==='cadence-plan')result=await weatherCadencePlan({root});
  else if(command==='cadence-cycle')result=await runCadencedWeatherCycle({root,capitalUsd:Number(opt('capital',0)),encumberedUsd:Number(opt('encumbered',0))}).catch(e=>{if(e.code==='WEATHER_CYCLE_RUNNING')return {status:'already-running',orderEffect:false};throw e;});
  else if(command==='score')result=await scoreWeather({root});
  else if(command==='relational-nowcast')result=await weatherRelationalNowcast({root,region:opt('region','nyc')});
  else if(command==='strategy-research')result=await weatherStrategyResearch({root,region:opt('region','nyc')});
  else if(command==='relational-science')result=await weatherRelationalScience({root,region:opt('region','nyc')});
  else if(command==='participation')result=await weatherParticipation({root,
    ...(opt('snapshot')?{snapshotId:opt('snapshot')}:{capitalUsd:Number(opt('capital')),encumberedUsd:Number(opt('encumbered',0)),contracts:Number(opt('contracts',1)),windowSeconds:Number(opt('window',60)),...(opt('tickers')?{tickers:opt('tickers').split(',')}:{})}),
    ...(opt('max-markets')?{maxMarkets:Number(opt('max-markets'))}:{}),
    ...(opt('quotes')?{quoteIntents:JSON.parse(opt('quotes'))}:{}),
    ...(opt('actions')?{proposalActionIds:JSON.parse(opt('actions'))}:{}),
    ...(opt('carry')?{carryPolicy:JSON.parse(opt('carry'))}:{})});
  else if(command==='status')result=await weatherStatus({root});
  else if(command==='model')result=await admitWeatherModel(JSON.parse(await readFile(args[0],'utf8')),{root});
  else if(command==='allocate')result=await allocateLiveWeather({root,...(args.includes('--capital')?{capitalUsd:Number(opt('capital',0)),encumberedUsd:Number(opt('encumbered',0))}:{})});
  else throw new Error('usage: weather.mjs cadence-plan|cadence-cycle|cycle|score|status|allocate [--state DIR] [--capital USD] [--encumbered USD] | participation --capital USD [--tickers LIST] | participation --snapshot ID [--actions JSON] [--carry JSON] | model FILE | relational-science|strategy-research|relational-nowcast [--region nyc|miami]');
  const output=args.includes('--full')||command==='cadence-plan'?result:{status:result.status,running:result.running,at:result.at,cadence:result.cadence,complete:result.complete,series:result.series,marketCount:result.marketCount,modelled:result.modelled,families:result.families,errors:result.errors?.slice(0,8),errorCount:result.errors?.length,scoring:result.scoring,research:result.research,opportunities:result.opportunities?.length,allocation:result.allocation??(command==='allocate'?result:undefined),...(command==='participation'||command==='model'||command==='score'||command==='relational-science'||command==='strategy-research'||command==='relational-nowcast'?result:{}),orderEffect:false};
  console.log(JSON.stringify(output,null,2));
} catch(e){console.error(e.stack??e.message);process.exitCode=1;}
