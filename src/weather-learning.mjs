import { studentTCdf } from './temperature-distribution.mjs';
/** Independent unit is an event on a target date; repeating forecasts or ladder rungs cannot grow n. */
export function gradeModels(resolved, {minDates=30}={}) {
  const groups=new Map();
  for(const row of resolved) for(const model of row.models) {
    const key=`${row.family}/${row.source}/${row.station}/${row.ruleKey}/${row.stage}/${model.id}`;
    if(!groups.has(key)) groups.set(key,new Map());
    const event=`${row.eventTicker}/${row.stage}`;
    const bucket=groups.get(key);
    if(!bucket.has(event)) bucket.set(event,[]);
    bucket.get(event).push({date:row.targetDate??row.closeTime.slice(0,10),p:model.p,y:row.outcome,delta:(row.mid-row.outcome)**2-(model.p-row.outcome)**2});
  }
  const report={};
  for(const [key,events] of groups) {
    const dates=new Map();
    for(const rs of events.values()) {
      const date=rs[0].date; if(!dates.has(date)) dates.set(date,[]);
      dates.get(date).push(rs.reduce((s,r)=>s+r.delta,0)/rs.length);
    }
    const ds=[...dates.values()].map(rs=>rs.reduce((s,x)=>s+x,0)/rs.length);const n=ds.length;
    const mean=n?ds.reduce((s,x)=>s+x,0)/n:0;
    const se=n>1?Math.sqrt(ds.reduce((s,x)=>s+(x-mean)**2,0)/(n-1)/n):Infinity;
    let lo=0,hi=100; for(let i=0;i<60;i++){const x=(lo+hi)/2;if(studentTCdf(x,Math.max(1,n-1))<0.95)lo=x;else hi=x;}
    const lower=n>1?mean-hi*se:null;
    const bins=Array.from({length:10},(_,b)=>{
      const rs=[...events.values()].flatMap(v=>v.filter(r=>Math.min(9,Math.floor(r.p*10))===b));
      // Conservative: one effective trial per date, even if many cities/rungs are in this bin.
      const outcomesByDate=new Map();
      for(const r of rs){if(!outcomesByDate.has(r.date))outcomesByDate.set(r.date,[]);outcomesByDate.get(r.date).push(r.y);}
      const dailyRates=[...outcomesByDate.values()].map(xs=>xs.reduce((s,y)=>s+y,0)/xs.length);
      const count=dailyRates.length;
      const rate=count?dailyRates.reduce((s,y)=>s+y,0)/count:null;
      if(!count)return {n:0,low:0,high:1};
      const z=1.96,den=1+z*z/count,center=(rate+z*z/(2*count))/den;
      const half=z*Math.sqrt(rate*(1-rate)/count+z*z/(4*count*count))/den;
      return {n:count,rate,low:Math.max(0,center-half),high:Math.min(1,center+half)};
    });
    report[key]={dates:n,events:events.size,brierImprovement:mean,improvementLower95:lower,admitted:n>=minDates&&lower>0,bins};
  }
  return report;
}
export function probabilityBand(contract, model, grades) {
  const g=grades[`${contract.family}/${contract.source}/${contract.station}/${contract.ruleKey}/${contract.stage}/${model.id}`];
  const b=g?.bins[Math.min(9,Math.floor(model.p*10))];
  return {low:b?.low??0, high:b?.high??1,admitted:Boolean(g?.admitted)&&Boolean(b?.n>=30),grade:g??null};
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
