/**
 * The weather store's retention as a consequence of the weather cycle: at the end of each cycle, under the cycle lock it
 * holds, the cycle expires the raw sources older than the retention window and reclaims what no ref reaches.
 *
 * The parameters are typed claims with their bases (content/config/weather-retention.json, read and checked here):
 *   - the window is the longest the store's measured growth lets it stay within its budget, between a minimum and the
 *     evidence design's 14 days (retentionWindow). The growth is measured by the cycle itself: the bytes the store's packs
 *     gained since the last gc finished, per day, smoothed with the earlier estimate;
 *   - a gc runs after any expiry, and whenever the store has grown by `gcAfterGrowthBytes` since the last one, so its cost is
 *     the few hours written since (a minor gc reads only the young packs; the file section's store makes every
 *     `majorEveryMs` gc a major one, which also reclaims garbage among tenured nodes). No clock decides anything here.
 *
 * What is kept is what the design keeps: derived records, outcomes and grades are never deleted by this module. A derived record
 * older than the working window is aged: its link to the station-science state revision it was derived from becomes a bare address,
 * which is what lets the revision (about 400 KB of chunks per cycle, 90% of what a derived record costs) be reclaimed while the record
 * (about 40 KB) stays.
 */
import {readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import policyFile from '../content/config/weather-retention.json' with {type:'json'};

const DAY=86400000,MIN_ELAPSED_MS=600000;

/** The policy, each claim checked to be of its type; throws when one is not. */
export function readRetentionPolicy(policy=policyFile){
  const whole=(k,min,max)=>{const v=policy[k];if(!Number.isInteger(v)||v<min||v>max)throw new RangeError(`weather retention: ${k} must be a whole number from ${min} to ${max}`);return v;};
  const checked={
    sourceRetentionMaxDays:whole('sourceRetentionMaxDays',1,3650),sourceRetentionMinDays:whole('sourceRetentionMinDays',1,3650),
    storeBudgetBytes:whole('storeBudgetBytes',1,2**50),gcAfterGrowthBytes:whole('gcAfterGrowthBytes',1,2**50),
    expiryDaysPerCycle:whole('expiryDaysPerCycle',1,60),derivedWorkingWindowDays:whole('derivedWorkingWindowDays',1,3650),derivedAgingPerCycle:whole('derivedAgingPerCycle',1,100000),derivedArchiveWindowDays:whole('derivedArchiveWindowDays',1,3650),archiveDaysPerCycle:whole('archiveDaysPerCycle',1,60),majorEveryMs:whole('majorEveryMs',1,2**40),graceMs:whole('graceMs',0,2**40),
  };
  if(checked.derivedArchiveWindowDays<checked.derivedWorkingWindowDays)throw new RangeError('weather retention: the archive window is shorter than the working window');
  if(checked.sourceRetentionMinDays>checked.sourceRetentionMaxDays)throw new RangeError('weather retention: the minimum window exceeds the maximum');
  for(const k of Object.keys(checked))if(typeof policy[`${k}Basis`]!=='string'||!policy[`${k}Basis`])throw new TypeError(`weather retention: ${k} states its basis`);
  return Object.freeze(checked);
}

/** The bytes the store's packs hold. */
export async function storeBytes(root){
  let total=0;
  try{for(const name of await readdir(join(root,'content-tree','packs')))total+=(await stat(join(root,'content-tree','packs',name))).size;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return total;
}

/**
 * The retention window in days: the longest the growth lets the store stay within its budget, between the minimum and the
 * maximum; the maximum while the growth is not yet known.
 */
export function retentionWindow({policy,growthBytesPerDay}){
  if(!Number.isFinite(growthBytesPerDay)||growthBytesPerDay<=0)return policy.sourceRetentionMaxDays;
  const fits=Math.floor(policy.storeBudgetBytes/growthBytesPerDay);
  return Math.max(policy.sourceRetentionMinDays,Math.min(policy.sourceRetentionMaxDays,fits));
}

/**
 * The cycle's upkeep. `state` is what the last upkeep left ({at, bytesAfter, growthBytesPerDay}) or null; `expire(days)`
 * drops the dated source refs of one day older than `days` and resolves {date, removed}; `gc()` reclaims and resolves its
 * report; `bytesOf()` is the store's size. Resolves {window, growthBytesPerDay, expired, gc, state} where `state` is the new state to keep.
 */
export async function upkeep({policy,state,now,bytesOf,expire,gc,age=async()=>({aged:0}),archive=async()=>({archived:0}),retentionDays}){
  const bytesNow=await bytesOf();
  let growth=state?.growthBytesPerDay??null;
  if(state&&Number.isFinite(state.bytesAfter)){
    const elapsed=now-Date.parse(state.at);
    if(elapsed>=MIN_ELAPSED_MS){
      const measured=Math.max(0,bytesNow-state.bytesAfter)/(elapsed/DAY);
      growth=Number.isFinite(growth)&&growth>0?(growth+measured)/2:measured;
    }
  }
  const window=retentionDays??retentionWindow({policy,growthBytesPerDay:growth});
  const expired={date:null,removed:0},dates=[];
  for(let i=0;i<policy.expiryDaysPerCycle;i++){
    const one=await expire(window);
    if(!one.removed)break;
    expired.date=one.date;expired.removed+=one.removed;dates.push(one.date);
  }
  const {aged}=await age();
  const archiveReport=await archive();
  const archived=archiveReport.archived??0;
  const grown=state&&Number.isFinite(state.bytesAfter)?bytesNow-state.bytesAfter:0;
  let report=null,bytesAfter=state?.bytesAfter??null,at=state?.at??new Date(now).toISOString();
  if(expired.removed>0||aged>0||archived>0||grown>=policy.gcAfterGrowthBytes||!state){
    report=await gc();
    bytesAfter=await bytesOf();at=new Date(now).toISOString();
  }
  return {window,growthBytesPerDay:growth,aged,archive:archiveReport,expired:{...expired,...(dates.length>1?{dates}:{})},gc:report,state:{at,bytesAfter,growthBytesPerDay:growth},gcRan:report!==null};
}
