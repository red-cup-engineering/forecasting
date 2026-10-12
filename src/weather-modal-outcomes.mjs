/**
 * Kalshi's daily-temperature adapter to shared conditional settlement proof search.
 *
 * Generic deduction belongs to shared prediction-market engineering; the
 * FOUR witness carrier belongs to SignCell. This module contributes only
 * weather-specific payout bounds and source/rule qualification.
 *
 * NWS station readings are PROXIES, even for NWS-CLI settlement. TWC reports
 * can be revised; exceptional Kalshi resolutions can pay the last fair price.
 * These conditional modal readings never authorize orders.
 */
import {boundRatePathExtremum} from '@red-cup-engineering/mandate-portfolio-allocation-service/settlement-modal';
import {projectConditionalSettlementSign} from '@red-cup-engineering/mandate-portfolio-allocation-service/settlement-sign-evidence';
import {bracketBounds} from './temperature-distribution.mjs';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const validTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));

/** Integer-Fahrenheit payout set, using the existing Kalshi bracket parser. */
export function temperatureBracketOutcomeInterval(contract) {
  const b=contract?.binding;
  if(!b||!['high','low'].includes(b.kind)||!['twc','nws-cli'].includes(b.source)||
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
  const bound=b.kind==='high'?obs?.floorPrecise:obs?.ceilingPrecise;
  if(!obs?.count||!finite(bound)||!validTime(obs.latest)||
    !validTime(obs.receivedAt)||!obs.source||obs.station!==b.station||obs.date!==b.targetDate)return [];
  return [{id:'nws-proxy/'+b.kind+'/'+b.station+'/'+b.targetDate+'/'+obs.latest+'/'+obs.receivedAt,
    lower:b.kind==='high'?bound:-Infinity,upper:b.kind==='low'?bound:Infinity,
    observedAt:obs.latest,availableAt:obs.receivedAt}];
}
/**
 * Two separate information sets: source-qualified proof-premises and NWS
 * proxy counterfactuals. Never join them into a single "proved" probability.
 *
 * The normal live weather cycle supplies no verifiedSourceBounds until a
 * genuinely source-specific verifier is admitted. Merely asserting the
 * qualifier string does not authenticate an untrusted external caller.
 */

/**
 * Research-only physical reachability under hypothetical *continuous* rate
 * constraints. Unlike a market source certificate, a plausible weather-rate
 * model is not automatically true, nor must it match Kalshi's actual report.
 * Thus these witnesses are held in a separately labeled SignCell, never in
 * sourceConditional or the executable forecast surface.
 */
function rateScenarioConditional(contract,payout,at,scenario){
  if(!scenario)return null;
  const b=contract.binding;
  if(!scenario.id||scenario.kind!==b.kind||scenario.ruleKey!==contract.ruleKey||
     scenario.source!==contract.source||scenario.station!==b.station||
     scenario.targetDate!==b.targetDate||scenario.climateReport!==b.climateReport)
    return {status:'unmatched-hypothetical-rate-scenario',tradeEligible:false,orderEffect:false};
  const envelope=boundRatePathExtremum({
    kind:b.kind,at,endAt:scenario.endAt,temperature:scenario.temperature,
    achievedExtreme:scenario.achievedExtreme,segments:scenario.segments,
  });
  if(!envelope.finalExtreme)
    return {status:envelope.status,envelope,support:{for:[],against:[]},
      tradeEligible:false,orderEffect:false};
  // Deliberately *outward* round the continuous bound. Half-degree ties are
  // retained as possible on BOTH sides, with no assumption on vendor tie
  // handling. Even this implication requires the hypothesized report transform.
  const integerExtreme={lower:Math.ceil(envelope.finalExtreme.lower-0.5),
    upper:Math.floor(envelope.finalExtreme.upper+0.5)};
  const projection=projectConditionalSettlementSign({
    subject:contract.ticker,predicate:'settles-yes',
    context:{source:contract.source,rules:contract.ruleKey,extreme:b.kind,
      targetDate:b.targetDate,station:b.station,climateReport:b.climateReport,
      assumption:'hypothetical-all-time-rate-envelope-and-rounded-reported-extreme'},
    channel:'rate-counterfactual',payout,premises:[{
      id:'rate-scenario/'+scenario.id,lower:integerExtreme.lower,upper:integerExtreme.upper,
      observedAt:at,availableAt:at,
    }],at,
  });
  return {status:'conditional-hypothetical-rate-reachability',
    envelope,integerExtreme, ...projection.deduction,
    cell:projection.cell,address:projection.address,
    signEvidence:projection,
    assumptions:[...envelope.assumptions,
      'whole-Fahrenheit reported final extreme lies in the outward-rounded physical envelope',
      'sensor, official-report and fallback differences remain unverified'],
    tradeEligible:false,orderEffect:false};
}

export function modalTemperatureReading(contract,evidence,{at=new Date().toISOString(),verifiedSourceBounds=[],rateScenario=null}={}){
  const payout=temperatureBracketOutcomeInterval(contract);
  if(!payout)return {status:'unsupported-or-unbound-temperature-contract',orderEffect:false};
  const when=typeof at==='number'?new Date(at).toISOString():at;
  if(!validTime(when))throw new TypeError('issuance time required');
  const qualified=qualifiedSourcePremises(contract,verifiedSourceBounds);
  // One proven interval interpretation and one actual SignCell/SignChain
  // carrier, upstream of Kalshi: no second local FOUR construction.
  const signContext={source:contract.source,rules:contract.ruleKey,
    extreme:contract.binding.kind,targetDate:contract.binding.targetDate,
    station:contract.binding.station,climateReport:contract.binding.climateReport};
  const sourceSign=projectConditionalSettlementSign({
    subject:contract.ticker,context:{...signContext,
      assumption:'source-bound normal binary settlement'},
    channel:'source-conditional',payout,premises:qualified,at:when});
  const proxySign=projectConditionalSettlementSign({
    subject:contract.ticker,context:{...signContext,
      assumption:'NWS proxy may not be authoritative settlement source'},
    channel:'proxy-counterfactual',payout,
    premises:observedProxyPremises(contract,evidence),at:when});
  const sourceConditional=sourceSign.deduction;
  const proxyConditional=proxySign.deduction;
  const rateConditional=rateScenarioConditional(contract,payout,when,rateScenario);
  return {
    status:'conditional-modal-research',
    sourceConditional:{
      ...sourceConditional,cell:sourceSign.cell,address:sourceSign.address,
      signEvidence:sourceSign,
      assumptions:['premises describe the eventual authoritative reported '+contract.binding.kind,
        'market rule, station, source and event date match',
        'normal binary settlement without correction or fair-price fallback'],
    },
    nwsProxyConditional:{
      ...proxyConditional,cell:proxySign.cell,address:proxySign.address,
      signEvidence:proxySign,
      assumptions:['NWS proxy '+(contract.binding.kind==='high'?'floor':'ceiling')+' bounds the eventual source report',
        'no later correction reverses the lower bound',
        'proxy may not match the settlement source'],
      sourceMismatch:contract.source!=='nws-cli',
    },
    rateConditional,
    sourceBoundWitnessCount:qualified.length,
    observationBoundWitnessCount:proxyConditional.qualifiedPremises.length,
    tradeEligible:false,orderEffect:false,
  };
}


/** Backwards-compatible HIGH-only facade; new consumers use the dual high/low adapter. */
export function highBracketOutcomeInterval(contract){
  return contract?.binding?.kind==='high'?temperatureBracketOutcomeInterval(contract):null;
}
export function modalHighReading(contract,evidence,options={}){
  if(contract?.binding?.kind!=='high')
    return {status:'unsupported-or-unbound-high-contract',orderEffect:false};
  return modalTemperatureReading(contract,evidence,options);
}
