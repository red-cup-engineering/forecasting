#!/usr/bin/env node
/** Out-of-sample check of the hourly index rate envelope on Kalshi's own published readings.
 *
 * Usage: node hourly-index-rate-envelope-backtest.mjs <cacheDir> <fitFirst> <fitLast> <testFirst> <testLast>
 *
 * The envelope is derived from the fit window only. For every city, every whole-hour target in
 * the test window and every decision minute in the hour before it, the decision sees only
 * readings at least five minutes old (the canonical publication rule), and is asked about
 * integer `greater` strikes from 15F below to 15F above the realized target reading. A decided
 * strike is wrong when the realized reading at the target minute falls on the other side.
 */
import {cityMinutes,rateEnvelope,HORIZONS} from './hourly-index-rate-envelope.mjs';
import {rateEnvelopeModel} from '../src/weather-index-rate-envelope.mjs';
import {INDEX_CITIES} from '../src/weather-index.mjs';

const MINUTE=60000,HOUR=3600000,DAY=86400000;
const [dir,fitFirst,fitLast,testFirst,testLast]=process.argv.slice(2);
if(![fitFirst,fitLast,testFirst,testLast].every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x??'')))throw new Error('usage: <cacheDir> <fitFirst> <fitLast> <testFirst> <testLast>');
const day=x=>Date.parse(x+'T00:00:00Z');
const envelope={window:{firstDay:fitFirst,lastDay:fitLast},derivedAt:new Date().toISOString(),horizonsMinutes:HORIZONS,cities:{}};
const report={fit:{fitFirst,fitLast},test:{testFirst,testLast},cities:{}};
for(const city of Object.keys(INDEX_CITIES)){
 const fit=await cityMinutes(dir,city,day(fitFirst),day(fitLast)+DAY);
 envelope.cities[city]={horizons:rateEnvelope(fit.minutes)};
 const test=await cityMinutes(dir,city,day(testFirst)-DAY,day(testLast)+DAY);
 const sorted=[...test.minutes].map(([t,v])=>({t,v})).sort((a,b)=>a.t-b.t);
 let decisions=0,decided=0,wrong=0,byLead={};const examples=[];
 for(let target=day(testFirst);target<day(testLast)+DAY;target+=HOUR){
  const truth=test.minutes.get(target);if(truth===undefined)continue;
  const binding={city,targetTime:new Date(target).toISOString()};
  for(let lead=1;lead<=60;lead++){
   const now=target-lead*MINUTE,visible=sorted.filter(p=>p.t+5*MINUTE<=now&&now-p.t<=3*HOUR);
   for(let k=Math.floor(truth)-15;k<=Math.ceil(truth)+15;k++){
    decisions++;
    const m=rateEnvelopeModel({strike_type:'greater',floor_strike:k},binding,visible,now,envelope);if(!m)continue;
    decided++;const bucket=lead<=5?'1-5':lead<=15?'6-15':lead<=30?'16-30':'31-60';byLead[bucket]=(byLead[bucket]??0)+1;
    const actual=truth>k+0.005?1:0;
    if(actual!==m.p){wrong++;if(examples.length<5)examples.push({target:binding.targetTime,lead,strike:k,decided:m.p,truth,anchor:m.details.anchorValueF});}
   }
  }
 }
 report.cities[city]={decisions,decided,wrong,decidedByLeadMinutes:byLead,examples};
}
process.stdout.write(JSON.stringify(report,null,1)+'\n');
