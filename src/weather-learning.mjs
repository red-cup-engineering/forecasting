import { studentTCdf } from './temperature-distribution.mjs';
/** Streaming event/date statistics; full immutable outcomes remain in the source journal. */
/** The pooled group: one model on one family and stage across every station and rule, where dates (not stations) are the independent unit. */
export const pooledGradeKey=(family,stage,modelId)=>`${family}/*/*/*/${stage}/${modelId}`;
export function createModelGradeAccumulator({minDates=30,pooledMinDates=10}={}) {
  const groups=new Map();
  function add(row){
    for(const model of row.models)for(const key of [`${row.family}/${row.source}/${row.station}/${row.ruleKey}/${row.stage}/${model.id}`,pooledGradeKey(row.family,row.stage,model.id)]){
      let g=groups.get(key);if(!g){g={events:new Map(),bins:Array.from({length:10},()=>new Map())};groups.set(key,g);}
      const event=`${row.eventTicker}/${row.stage}`,date=row.targetDate??row.closeTime.slice(0,10);
      let r=g.events.get(event);if(!r){r={date,n:0,delta:0};g.events.set(event,r);}
      r.n++;r.delta+=(row.mid-row.outcome)**2-(model.p-row.outcome)**2;
      const index=Math.min(9,Math.floor(model.p*10)),bin=g.bins[index];
      if(bin){let d=bin.get(date);if(!d){d={n:0,y:0};bin.set(date,d);}d.n++;d.y+=row.outcome;}
    }
  }
  function report(){
    const report={};
    for(const [key,g] of groups){
      const dates=new Map();for(const e of g.events.values()){let d=dates.get(e.date);if(!d){d={n:0,delta:0};dates.set(e.date,d);}d.n++;d.delta+=e.delta/e.n;}
      const ds=[...dates.values()].map(d=>d.delta/d.n),n=ds.length;
      const mean=n?ds.reduce((s,x)=>s+x,0)/n:0;
      const se=n>1?Math.sqrt(ds.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)/n):Infinity;
      let lo=0,hi=100;for(let i=0;i<60;i++){const x=(lo+hi)/2;if(studentTCdf(x,Math.max(1,n-1))<.95)lo=x;else hi=x;}
      const lower=n>1?mean-hi*se:null;
      const bins=g.bins.map(bin=>{
        const dailyRates=[...bin.values()].map(d=>d.y/d.n),count=dailyRates.length;
        if(!count)return {n:0,low:0,high:1};
        const rate=dailyRates.reduce((s,y)=>s+y,0)/count,z=1.96,den=1+z*z/count,center=(rate+z*z/(2*count))/den;
        const half=z*Math.sqrt(rate*(1-rate)/count+z*z/(4*count*count))/den;
        return {n:count,rate,low:Math.max(0,center-half),high:Math.min(1,center+half)};
      });
      const need=key.includes('/*/')?pooledMinDates:minDates;
      report[key]={dates:n,events:g.events.size,brierImprovement:mean,improvementLower95:lower,admitted:n>=need&&lower>0,minDates:need,bins};
    }
    return report;
  }
  return {add,report};
}
/** Independent unit is an event on a target date; repeating forecasts or ladder rungs cannot grow n. */
export function gradeModels(resolved,options={}){const accumulator=createModelGradeAccumulator(options);for(const row of resolved)accumulator.add(row);return accumulator.report();}
export function probabilityBand(contract, model, grades) {
  // The station's own grade when it is admitted, else the model's pooled grade on the family and stage.
  const own=grades[`${contract.family}/${contract.source}/${contract.station}/${contract.ruleKey}/${contract.stage}/${model.id}`];
  const g=own?.admitted?own:grades[pooledGradeKey(contract.family,contract.stage,model.id)]??own;
  const b=g?.bins[Math.min(9,Math.floor(model.p*10))];
  const structural=model.details?.structuralProbabilityBounds;
  const valid=!structural||(Number.isFinite(structural.low)&&Number.isFinite(structural.high)&&structural.low>=0&&structural.high<=1&&structural.low<=model.p&&structural.high>=model.p);
  return {low:valid?Math.min(b?.low??0,structural?.low??1):0, high:valid?Math.max(b?.high??1,structural?.high??0):1,admitted:valid&&Boolean(g?.admitted)&&Boolean(b?.n>=(g?.minDates??30)),grade:g??null,...(structural?{structuralProbabilityBounds:structural}: {})};
}
/** Cash is a consumable resource. Allocate it once, with same-event and same-date exposure limits. */
export function allocateWeather(rows, {capitalUsd=0,encumberedUsd=0,kellyShare=0.25,maxEventShare=0.1,maxDateShare=0.5}={}) {
  for(const [key,value] of Object.entries({capitalUsd,encumberedUsd,kellyShare,maxEventShare,maxDateShare}))if(!Number.isFinite(value)||value<0)throw new TypeError(`${key} must be nonnegative and finite`);
  if([kellyShare,maxEventShare,maxDateShare].some(x=>x>1))throw new TypeError('risk shares must be <=1');
  let cash=Math.max(0,capitalUsd-encumberedUsd); const events=new Map(),dates=new Map(),orders=[];
  for(const row of [...rows].filter(r=>r.admitted).sort((a,b)=>b.edge/b.price-a.edge/a.price)) {
    const cost=row.price+row.fee; const k=Math.max(0,(row.winLower-cost)/(1-cost))*kellyShare;
    const event=row.eventTicker,date=row.targetDate??row.closeTime.slice(0,10);
    const budget=Math.min(cash,capitalUsd*k,capitalUsd*maxEventShare-(events.get(event)??0),capitalUsd*maxDateShare-(dates.get(date)??0));
    const count=Math.min(row.depth,Math.floor(Math.max(0,budget)/cost));
    if(!count)continue;
    const debit=count*cost;cash-=debit;events.set(event,(events.get(event)??0)+debit);dates.set(date,(dates.get(date)??0)+debit);
    orders.push({...row,count,debitUsd:debit});
  }
  return {capitalUsd,encumberedUsd,reservedUsd:orders.reduce((s,r)=>s+r.debitUsd,0),remainingUsd:cash,orders,orderEffect:false};
}
