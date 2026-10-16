/**
 * What Kalshi's own city temperature index can still do before an hourly contract's target minute.
 *
 * The envelope (content/config/weather-index-rate-envelope.json, derived by
 * scripts/hourly-index-rate-envelope.mjs from the original published minute series) records the
 * largest rise and fall the index ever made over each horizon. From the latest published reading
 * v0 at t0, the target reading lies in [v0 - fall(h) * SAFETY, v0 + rise(h) * SAFETY], h the
 * minutes from t0 to the target, read at the smallest tabulated horizon at or above h (moves
 * only grow with time). A bracket whose YES interval holds that whole range is decided YES; one
 * that misses it is decided NO; anything else is left to the forecasting models.
 *
 * This is an empirical physical bound, not a rule of the contract. Its falsifier is the index
 * itself: when the city's recent readings have moved further than the envelope over any
 * tabulated horizon, the city is outside the envelope's experience and no bound is told.
 */
import {readFileSync} from 'node:fs';

const MINUTE=60000;
export const ENVELOPE=JSON.parse(readFileSync(new URL('../content/config/weather-index-rate-envelope.json',import.meta.url),'utf8'));
/** Margin over the largest observed move. */
export const SAFETY=1.5;
/** The latest reading must be this fresh to anchor a bound. */
export const MAX_ANCHOR_AGE_MS=15*MINUTE;
/** How far back recent readings are checked against the envelope. */
export const FALSIFIER_WINDOW_MS=3*60*MINUTE;
export const KIND='index-rate-envelope';
export const MODEL='kalshi-index-rate-envelope-v1';

/** The envelope's largest rise and fall within `minutes`, or null beyond its longest horizon. */
export function envelopeAt(city,minutes,envelope=ENVELOPE){
 const table=envelope.cities?.[city]?.horizons;if(!table||!Number.isFinite(minutes)||minutes<0)return null;
 const h=envelope.horizonsMinutes.find(x=>x>=Math.max(1,minutes));if(h===undefined)return null;
 const row=table[h];if(!row||!Number.isFinite(row.maxRiseF)||!Number.isFinite(row.maxFallF))return null;
 return {horizonMinutes:h,riseF:row.maxRiseF,fallF:row.maxFallF};
}

/** Whether readings (sorted {t, v}) moved further than the envelope over any tabulated horizon. */
export function exceedsEnvelope(city,points,envelope=ENVELOPE){
 const table=envelope.cities?.[city]?.horizons;if(!table)return true;
 const at=new Map(points.map(p=>[p.t,p.v]));
 for(const h of envelope.horizonsMinutes){
  const row=table[h];if(!row)continue;
  for(const {t,v} of points){const later=at.get(t+h*MINUTE);if(later===undefined)continue;
   if(later-v>row.maxRiseF||v-later>row.maxFallF)return true;}
 }
 return false;
}

/** The YES interval of a bracket on the certified 0.01F index, as [low, high] in F. */
export function yesInterval(market){
 const cent=v=>Math.round(v*100)/100,precise=v=>Number.isFinite(v)&&Math.abs(v-cent(v))<1e-9;
 if(market.strike_type==='greater'&&precise(market.floor_strike))return [market.floor_strike+0.005,Infinity];
 if(market.strike_type==='less'&&precise(market.cap_strike))return [-Infinity,market.cap_strike-0.005];
 if(market.strike_type==='between'&&precise(market.floor_strike)&&precise(market.cap_strike)&&market.floor_strike<=market.cap_strike)
  return [market.floor_strike-0.005,market.cap_strike+0.005];
 return null;
}

/**
 * The decided probability of an index-at contract from the latest published readings, as a
 * structural model, or null when the readings leave it open.
 * @param market the contract (strike_type, floor_strike, cap_strike)
 * @param binding {city, targetTime}
 * @param points canonical published minute readings {t, v}, ascending
 * @param now decision clock (ms)
 */
export function rateEnvelopeModel(market,binding,points,now,envelope=ENVELOPE){
 const target=Date.parse(binding?.targetTime),interval=yesInterval(market);
 if(!Number.isFinite(target)||!interval||!Array.isArray(points)||!points.length)return null;
 const past=points.filter(p=>p.t<=now),anchor=past.at(-1);
 if(!anchor||now-anchor.t>MAX_ANCHOR_AGE_MS||anchor.t>target)return null;
 if(exceedsEnvelope(binding.city,past.filter(p=>now-p.t<=FALSIFIER_WINDOW_MS),envelope))return null;
 const reach=envelopeAt(binding.city,(target-anchor.t)/MINUTE,envelope);if(!reach)return null;
 const lowF=anchor.v-reach.fallF*SAFETY,highF=anchor.v+reach.riseF*SAFETY;
 const p=interval[0]<=lowF&&highF<=interval[1]?1:highF<interval[0]||lowF>interval[1]?0:null;
 if(p===null)return null;
 return {id:MODEL,p,details:{structuralProbabilityBounds:{kind:KIND,low:p,high:p},
  anchorValueF:anchor.v,anchorTime:new Date(anchor.t).toISOString(),targetTime:binding.targetTime,
  reachableF:[lowF,highF],horizonMinutes:reach.horizonMinutes,safety:SAFETY,
  envelope:{window:envelope.window,derivedAt:envelope.derivedAt}}};
}
