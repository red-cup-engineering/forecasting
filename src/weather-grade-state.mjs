/**
 * The model grades (weather-learning.mjs createModelGradeAccumulator's, reproduced exactly) in a bounded working set.
 *
 * resolved.jsonl is the record of every settled forecast and only grows. Grading it held every key it had seen and every
 * event of every group as objects, and the cycle's working set was about 300 MB above its baseline at 19,000 rows (293 MB
 * of file), more with every day. Measured on those rows, what must be live is small: the accumulator keeps its events and bins
 * as numbers in parallel arrays under interned ids, and the whole grading holds about 50 MB of live heap, the rest of the
 * old peak being garbage the collector had not yet been made to take. The grades are the same, byte for byte
 * (test/weather-grade-state.test.mjs compares them with the old accumulator on recorded rows).
 *
 * Why the grades are regraded from the file each cycle and not added to: a row is counted only if it is the EARLIEST forecast
 * of its key (contract, horizon, rule, model), and rows are appended in the order the pending forecasts settle, which is not the
 * order they were issued. On the desk's 19,485 rows, 28 of 30 consecutive batches of 20 appended rows held a forecast earlier than
 * one already counted, so an incremental state would regrade nearly every cycle and gain nothing, and taking a counted row
 * back would change the order of the float sums and with it the grades by rounding.
 */
import {createReadStream} from 'node:fs';
import {studentTCdf} from './temperature-distribution.mjs';
import {pooledGradeKey} from './weather-learning.mjs';

const EVENT_STRIDE=2**22,DATE_STRIDE=2**16;

/** A resolved row grades a model only when its settlement evidence is verified and it was issued before settlement. */
export const gradable=r=>r.settlementEvidenceVersion===1&&Date.parse(r.at)<Date.parse(r.settlement?.settledAt);
const gradeKey=(r,m)=>`${r.ticker}/${r.stage}/${r.ruleKey}/${m.id}`;

/** The complete lines of a file from a byte offset, each with the offset after it; a last line without its newline is not yet a line. */
export async function* completeLines(path,start=0){
  let carry=Buffer.alloc(0),at=start;
  for await(const chunk of createReadStream(path,{start})){
    const buffer=carry.length?Buffer.concat([carry,chunk]):chunk;
    let from=0,newline;
    while((newline=buffer.indexOf(10,from))!==-1){
      const line=buffer.subarray(from,newline).toString('utf8');
      at+=newline+1-from;from=newline+1;
      yield {line,end:at};
    }
    carry=Buffer.from(buffer.subarray(from));
  }
}

/** Interned ids: a string is held once however many entries name it. */
function interner(){
  const ids=new Map(),names=[];
  return {names,id(name){let i=ids.get(name);if(i===undefined){i=names.length;ids.set(name,i);names.push(name);}return i;},
    load(list){names.length=0;ids.clear();for(const n of list){ids.set(n,names.length);names.push(n);}}};
}

export function createCompactGradeAccumulator() {
  const groups=interner(),events=interner(),dates=interner();
  // An event of a group (n forecasts, the sum of their Brier differences, the date it was first seen on), in the order first seen.
  const eventSlot=new Map();let ev;
  // A date of one probability bin of a group (n forecasts, y outcomes), in the order first seen.
  const binSlot=new Map();let bin;
  ev={group:[],event:[],n:[],delta:[],date:[]};bin={group:[],index:[],date:[],n:[],y:[]};
  function add(row){
    if(!Number.isFinite(row.mid)||row.mid<0||row.mid>1||![0,1].includes(row.outcome))return;
    for(const model of row.models.filter(m=>Number.isFinite(m.p)&&m.p>=0&&m.p<=1))for(const key of [`${row.family}/${row.source}/${row.station}/${row.ruleKey}/${row.stage}/${model.id}`,pooledGradeKey(row.family,row.stage,model.id,row)].filter(Boolean)){
      const g=groups.id(key),event=events.id(`${row.eventTicker}/${row.stage}`),date=dates.id(row.targetDate??row.closeTime.slice(0,10));
      const slotKey=g*EVENT_STRIDE+event;let slot=eventSlot.get(slotKey);
      if(slot===undefined){slot=ev.n.length;eventSlot.set(slotKey,slot);ev.group.push(g);ev.event.push(event);ev.n.push(0);ev.delta.push(0);ev.date.push(date);}
      ev.n[slot]++;ev.delta[slot]+=(row.mid-row.outcome)**2-(model.p-row.outcome)**2;
      const index=Math.min(9,Math.floor(model.p*10)),binKey=(g*10+index)*DATE_STRIDE+date;let b=binSlot.get(binKey);
      if(b===undefined){b=bin.n.length;binSlot.set(binKey,b);bin.group.push(g);bin.index.push(index);bin.date.push(date);bin.n.push(0);bin.y.push(0);}
      bin.n[b]++;bin.y[b]+=row.outcome;
    }
  }
  function report(){
    const byGroup=groups.names.map(()=>({events:[],bins:Array.from({length:10},()=>[])}));
    for(let s=0;s<ev.n.length;s++)byGroup[ev.group[s]].events.push(s);
    for(let s=0;s<bin.n.length;s++)byGroup[bin.group[s]].bins[bin.index[s]].push(s);
    const out={};
    groups.names.forEach((key,g)=>{
      const perDate=new Map();
      for(const s of byGroup[g].events){let d=perDate.get(ev.date[s]);if(!d){d={n:0,delta:0};perDate.set(ev.date[s],d);}d.n++;d.delta+=ev.delta[s]/ev.n[s];}
      const ds=[...perDate.values()].map(d=>d.delta/d.n),n=ds.length;
      const mean=n?ds.reduce((s,x)=>s+x,0)/n:0;
      const se=n>1?Math.sqrt(ds.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)/n):Infinity;
      let lo=0,hi=100;for(let i=0;i<60;i++){const x=(lo+hi)/2;if(studentTCdf(x,Math.max(1,n-1))<.95)lo=x;else hi=x;}
      const lower=n>1?mean-hi*se:null;
      const bins=byGroup[g].bins.map(slots=>{
        const dailyRates=slots.map(s=>bin.y[s]/bin.n[s]),count=dailyRates.length;
        if(!count)return {n:0,low:0,high:1};
        const rate=dailyRates.reduce((s,y)=>s+y,0)/count,z=1.96,den=1+z*z/count,center=(rate+z*z/(2*count))/den;
        const half=z*Math.sqrt(rate*(1-rate)/count+z*z/(4*count*count))/den;
        return {n:count,rate,low:Math.max(0,center-half),high:Math.min(1,center+half)};
      });
      const admitted=Number.isFinite(lower)&&lower>0;
      const weight=admitted?Math.min(1,lower/mean):0;
      out[key]={version:2,dates:n,events:byGroup[g].events.length,brierImprovement:mean,improvementLower95:lower,admitted,weight,admission:'positive date-clustered one-sided 95% Brier improvement; weight lower/mean',bins};
    });
    return out;
  }
  return {add,report};
}

/** Grade the whole file: the earliest time per key first, then count the first row at that time. */
export async function gradeHistory({path}){
  const first=new Map();let offset=0;
  try{
    for await(const {line,end} of completeLines(path)){
      offset=end;if(!line)continue;
      const r=JSON.parse(line);
      if(gradable(r))for(const m of r.models){const k=gradeKey(r,m),was=first.get(k);if(was===undefined||r.at.localeCompare(was)<0)first.set(k,r.at);}
    }
  }catch(error){if(error.code!=='ENOENT')throw error;return {};}
  const accumulator=createCompactGradeAccumulator(),counted=new Set();
  for await(const {line,end} of completeLines(path)){
    if(end>offset)break;
    if(!line)continue;
    const r=JSON.parse(line);
    if(gradable(r))for(const m of r.models){const k=gradeKey(r,m);if(first.get(k)!==r.at||counted.has(k))continue;counted.add(k);accumulator.add({...r,models:[m]});}
  }
  return accumulator.report();
}
