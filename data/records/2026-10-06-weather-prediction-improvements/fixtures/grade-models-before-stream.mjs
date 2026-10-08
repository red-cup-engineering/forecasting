import { studentTCdf } from '../../../../src/temperature-distribution.mjs';
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
