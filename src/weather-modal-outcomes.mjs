/**
 * Kalshi's daily-high adapter to shared conditional settlement proof search.
 *
 * Generic deduction belongs to shared prediction-market engineering; the
 * FOUR witness carrier belongs to SignCell. This module contributes only
 * weather-specific payout bounds and source/rule qualification.
 *
 * NWS station readings are PROXIES, even for NWS-CLI settlement. TWC reports
 * can be revised; exceptional Kalshi resolutions can pay the last fair price.
 * These conditional modal readings never authorize orders.
 */
import {deduceSettlementInterval} from '@red-cup-engineering/mandate-portfolio-allocation-service/settlement-modal';
import {cell,address} from '@red-cup-engineering/signcell/cell';
import {bracketBounds} from './temperature-distribution.mjs';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));

/** Integer-Fahrenheit payout set, using the existing Kalshi bracket parser. */
export function highBracketOutcomeInterval(contract) {
  const b=contract?.binding;
  if(!b||b.kind!=='high'||!['twc','nws-cli'].includes(b.source)||
    b.source!==contract.source||!contract.ruleKey||!b.station||!b.targetDate||
    !['less','between','greater'].includes(contract.strike_type))return null;
  const {floor_strike:floorStrike,cap_strike:capStrike}=contract;
  if((contract.strike_type==='less'&&!finite(capStrike))||
    (contract.strike_type==='greater'&&!finite(floorStrike))||
    (contract.strike_type==='between'&&(!finite(floorStrike)||!finite(capStrike))))return null;
  const [lo,hi]=bracketBounds({strikeType:contract.strike_type,floorStrike,capStrike});
  const lower=lo===-Infinity?-Infinity:Math.ceil(lo),upper=hi===Infinity?Infinity:Math.floor(hi);
  return lower<=upper?{lower,upper}:null;
}
function qualifiedSourcePremises(contract,bounds) {
  const b=contract.binding;
  return (bounds??[]).filter(x=>
    x?.qualification==='verified-settlement-source-bound'&&
    x.ruleKey===contract.ruleKey&&x.source===contract.source&&
    x.station===b.station&&x.targetDate===b.targetDate&&
    x.climateReport===b.climateReport&&typeof x.id==='string'&&x.id.length>0
  ).map(x=>({id:x.id,lower:x.lower,upper:x.upper,observedAt:x.observedAt,availableAt:x.availableAt}));
}
/** Counterfactual: IF the NWS proxy floor is a sound bound on the eventual source report. */
function observedProxyPremises(contract,evidence) {
  const b=contract.binding,obs=evidence?.observations?.[b.station+'/'+b.targetDate];
  if(!obs?.count||!finite(obs.floorPrecise)||!validTime(obs.latest)||
    !validTime(obs.receivedAt)||!obs.source||obs.station!==b.station||obs.date!==b.targetDate)return [];
  return [{id:'nws-proxy/'+b.station+'/'+b.targetDate+'/'+obs.latest+'/'+obs.receivedAt,
    lower:obs.floorPrecise,upper:Infinity,observedAt:obs.latest,availableAt:obs.receivedAt}];
}
/**
 * Two separate information sets: source-qualified proof-premises and NWS
 * proxy counterfactuals. Never join them into a single "proved" probability.
 *
 * The normal live weather cycle supplies no verifiedSourceBounds until a
 * genuinely source-specific verifier is admitted. Merely asserting the
 * qualifier string does not authenticate an untrusted external caller.
 */
export function modalHighReading(contract,evidence,{at=new Date().toISOString(),verifiedSourceBounds=[]}={}){
  const payout=highBracketOutcomeInterval(contract);
  if(!payout)return {status:'unsupported-or-unbound-high-contract',orderEffect:false};
  const when=typeof at==='number'?new Date(at).toISOString():at;
  if(!validTime(when))throw new TypeError('issuance time required');
  const qualified=qualifiedSourcePremises(contract,verifiedSourceBounds);
  const sourceConditional=deduceSettlementInterval({payout,premises:qualified,at:when});
  const proxyConditional=deduceSettlementInterval({payout,premises:observedProxyPremises(contract,evidence),at:when});
  const proofCell=cell(contract.ticker,'settles-yes',
    {source:contract.source,rules:contract.ruleKey,assumption:'source-bound normal binary settlement'},
    sourceConditional.support);
  return {
    status:'conditional-modal-research',
    sourceConditional:{
      ...sourceConditional,cell:proofCell,address:address(proofCell),
      assumptions:['premises describe the eventual authoritative reported high',
        'market rule, station, source and event date match',
        'normal binary settlement without correction or fair-price fallback'],
    },
    nwsProxyConditional:{
      ...proxyConditional,
      assumptions:['NWS observation floor is a bound on the eventual source report',
        'no later correction reverses the lower bound',
        'proxy may not match the settlement source'],
      sourceMismatch:contract.source!=='nws-cli',
    },
    sourceBoundWitnessCount:qualified.length,
    observationBoundWitnessCount:proxyConditional.qualifiedPremises.length,
    tradeEligible:false,orderEffect:false,
  };
}
