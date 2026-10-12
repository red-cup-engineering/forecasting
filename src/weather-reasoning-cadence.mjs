/**
 * Market/station-local cadence selection, without a second scheduler, clock
 * service, collector, weather truth, or trading authority.
 *
 * A five-minute external tick may ask which IANA time zones are due:
 * hourly at local HH:00 normally; every five minutes from 14:30 through
 * 17:30 local civil time (inclusive) for temperature-peak reasoning.
 *
 * This is a *work policy*, not an assertion that the high occurs in the
 * afternoon, that evidence changed, or that the collector can complete in
 * five minutes. The caller must retain source arrival clocks and use its
 * existing single-flight/weather-cycle custody.
 */
export const WEATHER_REASONING_CADENCE = Object.freeze({
  baselineMinutes:60,
  focusedMinutes:5,
  focusStart:'14:30',
  focusEnd:'17:30',
  clock:'IANA-local-civil-time',
});
const TICK_MS = 5*60_000;
const formatters = new Map();

function utcMs(value,label){
  const t = value instanceof Date?value.getTime():typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  if(!Number.isFinite(t))throw new TypeError(label+' must be an absolute timestamp');
  return t;
}
function formatter(tz){
  if(typeof tz!=='string'||!tz.length)throw new TypeError('IANA timeZone required');
  if(!formatters.has(tz))formatters.set(tz,new Intl.DateTimeFormat('en-US',{
    timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }));
  return formatters.get(tz);
}
function localParts(utc,tz){
  const parts=Object.fromEntries(formatter(tz).formatToParts(new Date(utc)).map(x=>[x.type,x.value]));
  const minute=Number(parts.hour)*60+Number(parts.minute);
  return {localDate:parts.year+'-'+parts.month+'-'+parts.day,
    localTime:parts.hour+':'+parts.minute,minute};
}
function timeOfDay(value){
  if(typeof value!=='string'||!/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value))throw new TypeError('HH:MM local time required');
  const [hours,mins]=value.split(':').map(Number);
  if(mins%5!==0)throw new TypeError('focus boundary must align to five-minute tick');
  return 60*hours+mins;
}
function validatePolicy(p){
  if(!p||p.clock!=='IANA-local-civil-time'||
    !Number.isInteger(p.baselineMinutes)||!Number.isInteger(p.focusedMinutes)||
    p.focusedMinutes<5||p.baselineMinutes>60||p.focusedMinutes>=p.baselineMinutes||
    60%p.focusedMinutes!==0||60%p.baselineMinutes!==0)
    throw new TypeError('aligned IANA local-time baseline/focus policy required');
  const start=timeOfDay(p.focusStart),end=timeOfDay(p.focusEnd);
  if(start>=end)throw new RangeError('focused daily interval must be nonempty and not cross midnight');
  return {start,end};
}
function slotAt(t,tz,policy,start,end){
  const local=localParts(t,tz);
  const focused=local.minute>=start&&local.minute<=end;
  const cadenceMinutes=focused?policy.focusedMinutes:policy.baselineMinutes;
  return {...local,focused,cadenceMinutes,onBoundary:local.minute%cadenceMinutes===0};
}
/**
 * Pure, replayable multi-zone selection at the most recent UTC 5-minute slot.
 *
 * lastEvidenceAt is the START of the latest successfully committed source
 * collection, not the later publication/completion clock. A cycle that began
 * before 14:30 but ended afterward must NOT satisfy the 14:30 decision slot.
 * The source collection's conservative start is used even if observations
 * arrived later within the cycle. For targeted consumers, supply the actual
 * zone evidence start via lastEvidenceByZone; a global evidence receipt is
 * never a substitute for independently captured station observations.
 *
 * Missed slots are not backfilled and are not independent validation days.
 * The function never launches a collector; a five-minute dispatcher can act
 * only when shouldRun is true.
 */
export function planWeatherReasoningCadence({
  now=Date.now(),timeZones=[],lastEvidenceAt=null,lastEvidenceByZone={},
  policy=WEATHER_REASONING_CADENCE,
}={}){
  const {start,end}=validatePolicy(policy),clock=utcMs(now,'now');
  if(!Array.isArray(timeZones)||!timeZones.length)throw new TypeError('at least one configured IANA timeZone required');
  if(!lastEvidenceByZone||typeof lastEvidenceByZone!=='object'||Array.isArray(lastEvidenceByZone))
    throw new TypeError('per-zone receipts must be a map');
  const slot=Math.floor(clock/TICK_MS)*TICK_MS,slotIso=new Date(slot).toISOString();
  const globalLast=lastEvidenceAt===null?null:utcMs(lastEvidenceAt,'lastEvidenceAt');
  if(globalLast!==null&&globalLast>clock)throw new RangeError('future source evidence is not valid evidence');
  const zones=[...new Set(timeZones)].sort();
  const rows=zones.map(timeZone=>{
    const local=slotAt(slot,timeZone,policy,start,end);
    const completed=Object.hasOwn(lastEvidenceByZone,timeZone)?
      utcMs(lastEvidenceByZone[timeZone],'lastEvidenceByZone'):globalLast;
    if(completed!==null&&completed>clock)throw new RangeError('future zone completion is not valid evidence');
    const alreadyCovered=completed!==null&&completed>=slot;
    let nextDueAt=null;
    // At least one normal hourly slot occurs in 24 hours; 36h also spans DST.
    for(let t=slot+TICK_MS;t<=slot+36*3600_000;t+=TICK_MS){
      if(slotAt(t,timeZone,policy,start,end).onBoundary){
        nextDueAt=new Date(t).toISOString();break;
      }
    }
    if(nextDueAt===null)throw new RangeError('no next local-time reasoning slot within 36 hours');
    return {timeZone,localDate:local.localDate,localTime:local.localTime,
      cadenceMinutes:local.cadenceMinutes,focused:local.focused,
      slotAt:slotIso,onBoundary:local.onBoundary,
      alreadyCovered,due:local.onBoundary&&!alreadyCovered,
      nextDueAt};
  });
  const dueTimeZones=rows.filter(x=>x.due).map(x=>x.timeZone);
  return {evaluatedAt:new Date(clock).toISOString(),slotAt:slotIso,
    policy:{...policy},zones:rows,dueTimeZones,
    nextDueAt:rows.map(x=>x.nextDueAt).sort()[0],
    shouldRun:dueTimeZones.length>0,orderEffect:false};
}


/** Derive monitored civil zones from the existing official high/low series
 * registry and its live-rule-bound market roster, not a second city map.
 * The live roster only widens coverage: a transient market discovery gap
 * cannot stop observing an already supported climate station.
 */
export function temperatureReasoningTimeZones({series=[],contracts=[]}={}){
  if(!Array.isArray(series)||!Array.isArray(contracts))throw new TypeError('weather series and contracts must be arrays');
  const zones=[
    ...series.filter(r=>['high','low'].includes(r?.kind)).map(r=>r.timeZone),
    ...contracts.filter(c=>['high','low'].includes(c?.binding?.kind)).map(c=>c.binding.timeZone),
  ].filter(x=>typeof x==='string'&&x.length>0);
  if(!zones.length)throw new TypeError('no locally zoned daily-temperature markets are configured');
  return [...new Set(zones)].sort();
}
