/**
 * Read-only bridge from Kalshi's EXISTING AAA event/book/rule/fee readers
 * to the shared binary-prediction-market participation decision menu.
 *
 * No new price model, no second fee implementation, no new orderbook
 * or order actuator. The same shared scenario forecast produces ALL
 * nested-threshold probabilities. A separate, before-decision calibration
 * witness must supply an interval that contains its selected rung's
 * scenario probability; a gas settlement guess is not an admitted edge.
 *
 * Maker fill models are likewise independent, scope-bound research inputs.
 * The old gas/diesel historical aggregate lacks event and series identity
 * and MUST NOT be passed as such an AAA-only model.
 *
 * Structural LP opportunities may be listed only as conditional; without
 * a joint-fill and partial-execution loss model they cannot be ranked.
 * Reward scenarios are never converted into assured LIP dollars.
 */
import {compareBinaryParticipationMenu}
 from '@red-cup-engineering/mandate-portfolio-allocation-service/binary-participation-menu';
import {evaluateMarketInformationValue,conditionMarketForecastOnSignal}
 from '@red-cup-engineering/mandate-portfolio-allocation-service/market-information-value';
import {bindScreenedOutcomeFillResearch}
 from '@red-cup-engineering/mandate-portfolio-allocation-service/binary-fill-calibration';
import {projectObservedScenarioConditioningSign}
 from '@red-cup-engineering/mandate-portfolio-allocation-service/settlement-sign-evidence';
import {analyzeAaaGasMarketGame,projectAaaGasScenarioLadder} from './aaa-gas-market-game.mjs';
import {orderFeeCentsOfFills} from '@red-cup-engineering/forecasting/fees';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const centPrice=p=>finite(p)&&p>0&&p<1&&Math.abs(p*100-Math.round(p*100))<1e-8;
const validTime=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const scopedId=(event,population)=>event.event_ticker+'|AAA:regular-gasoline|'+population;
function reportGap(event,at,status,details) {
 return {kind:'aaa-gas-participation-research-v1',status,at,
  eventTicker:event?.event_ticker??null,details,menu:null,
  tradeEligible:false,orderEffect:false};
}
const fee=(price,series,maker)=>{
 // Existing fee implementation accepts *whole-cent* purchase prices.
 // Do NOT price sub-cent fills as free by silently rounding/omitting them.
 const p=Math.round(price*100);
 return orderFeeCentsOfFills([{count:1,priceCents:p}],
  {feeType:series.fee_type,multiplier:Number(series.fee_multiplier??1),maker})/100;
}

/**
 * A source-calibrated, fee/read-receipt-aware candidate comparison.
 * Only one exact target ticker is scored per decision; the joint scenario
 * projection includes all rungs for coherent correlation.
 *
 * settlementBand must cite an independently established, earlier calibration
 * record and the same exact scope. The code checks consistency/timestamps;
 * it cannot independently certify that an external model is good.
 */
export function compareAaaGasParticipation({
 event,series,at,ticker,scenarioForecast,settlementBand,
 makerQuotes=[],signalStudy=null,signalObservation=null,maxBookAgeMs=60_000,
}={}){
 if(!validTime(at)||!Array.isArray(makerQuotes)||makerQuotes.length>128)
  throw new TypeError('point-in-time AAA participation inputs required');
 const base=analyzeAaaGasMarketGame({event,series,at,scenarioForecast,maxBookAgeMs});
 if(base.status!=='read-only-research'||!base.scenarioProjection)
  return reportGap(event,at,'unbound-event-or-joint-scenario',base.gaps??[]);
 const scope=scopedId(event,base.sourceScope);
 // The EVSI research interface describes a signal worth buying. This is the
 // distinct actual RECEIPT interface: after observation, update the WHOLE
 // joint scenario distribution and reproject every nested AAA threshold.
 // No individual rung is independently nudged and no news item is silently
 // interpreted as a likelihood.
 let conditionedSignal=null,scenarioProjection=base.scenarioProjection;
 if(signalObservation!==null){
  if(!signalStudy||signalStudy.scope!==scope)
   return reportGap(event,at,'unbound-conditional-source-signal',
    'observed signal requires the preissued AAA source-scoped emission model');
  try{
   conditionedSignal=conditionMarketForecastOnSignal({
    forecast:scenarioForecast,signalModel:signalStudy.model,
    observation:signalObservation,at,
   });
   if(conditionedSignal.status!=='conditional-research-posterior')
    return reportGap(event,at,conditionedSignal.status,
     'received signal is impossible under the precommitted joint scenario likelihood');
   scenarioProjection=projectAaaGasScenarioLadder({
    event,forecast:conditionedSignal.forecast,at,
   });
  }catch(error){
   return reportGap(event,at,'unqualified-conditional-source-signal',error.message);
  }
 }
 const market=event.markets.find(m=>m.ticker===ticker),p=scenarioProjection.marketProbabilities
   .find(row=>row.ticker===ticker)?.probabilityYes;
 if(!market||!finite(p))
  return reportGap(event,at,'missing-exact-target-rung','no sourced scenario probability for selected ticker');
 let signProjection=null;
 if(conditionedSignal!==null){
  try{
   signProjection=projectObservedScenarioConditioningSign({
    forecast:scenarioForecast,signalModel:signalStudy.model,
    observation:signalObservation,at,
    context:{
     source:'AAA',rules:market.rules_primary,
     scope:base.sourceScope,targetDate:scenarioForecast.targetDate,
     assumption:'source-conditioned frozen likelihood, not authenticated AAA settlement',
    },
   });
  }catch(error){
   return reportGap(event,at,'unqualified-conditional-sign-projection',error.message);
  }
 }
 if(!settlementBand||settlementBand.scope!==scope||
   !validTime(settlementBand.availableAt)||Date.parse(settlementBand.availableAt)>Date.parse(at)||
   typeof settlementBand.modelId!=='string'||!settlementBand.modelId||
   typeof settlementBand.calibrationRecordId!=='string'||!settlementBand.calibrationRecordId||
   !Array.isArray(settlementBand.evidenceIds)||!settlementBand.evidenceIds.length||
   !finite(settlementBand.low)||!finite(settlementBand.high)||
   settlementBand.low<0||settlementBand.high>1||
   settlementBand.low>settlementBand.high||
   p<settlementBand.low-1e-9||p>settlementBand.high+1e-9||
   (conditionedSignal!==null&&
      settlementBand.forecastId!==conditionedSignal.forecast.id))
  return reportGap(event,at,'missing-consistent-source-calibration',
   'timestamped, exact-source, score-qualified interval enclosing projected scenario probability required');
 const atMs=Date.parse(at);
 const evidence={id:settlementBand.modelId,scope,
  availableAt:settlementBand.availableAt,
  evidenceIds:[...settlementBand.evidenceIds,settlementBand.calibrationRecordId],
 };
 const takers=[],makers=[],gaps=[];
 const yesBid=Number(market.yes_bid_dollars),yesAsk=Number(market.yes_ask_dollars);
 for(const side of ['yes','no']){
  const price=side==='yes'?yesAsk:1-yesBid;
  const depth=Number(side==='yes'?market.yes_ask_size_fp:market.yes_bid_size_fp);
  if(!centPrice(price)||!finite(depth)||depth<1){
   gaps.push({side,kind:'taker',reason:'no valid whole-cent one-lot executable top of book'});
   continue;
  }
  takers.push({id:'take-'+side,side,priceUsd:price,
   feeUsd:fee(price,series,false),depthContracts:depth,
   quoteObservedAt:market.marketObservedAt,closeAt:market.close_time});
 }
 for(const q of makerQuotes){
  if(q?.ticker!==ticker||!['yes','no'].includes(q.side)||
     !centPrice(q.priceUsd)){
   gaps.push({kind:'maker',id:q?.id??null,reason:'one-lot whole-cent resting quote must bind target ticker/side'});continue;
  }
  const yesSidePrice=q.side==='yes'?q.priceUsd:1-q.priceUsd;
  if(!finite(yesBid)||!finite(yesAsk)||yesBid>=yesAsk||
    !(q.side==='yes'?yesSidePrice>=yesBid&&yesSidePrice<yesAsk:
       yesSidePrice>yesBid&&yesSidePrice<=yesAsk)){
   gaps.push({kind:'maker',id:q.id,reason:'resting quote crosses or is off the current displayed touch'});continue;
  }
  // A source-identified frozen fit and its independent heldout receiving
  // belong to the UPSTREAM hazard calibrator. Never reinterpret a pooled
  // retrospective histogram as an AAA-exclusive producer.
  let fillEvidence=q.fillEvidence;
  let fillGivenWin=q.probabilityFillGivenWin;
  let fillGivenLoss=q.probabilityFillGivenLoss;
  if(q.fillStudy){
   if(q.fillEvidence||q.probabilityFill||q.probabilityFillGivenWin||
      q.probabilityFillGivenLoss){
    gaps.push({kind:'maker',id:q.id,
     reason:'select the received training/heldout fill study OR an exploratory manual model, never combine both'});
    continue;
   }
   try{
    const bound=bindScreenedOutcomeFillResearch({
     training:q.fillStudy.training,holdout:q.fillStudy.holdout,
     holdoutPublishedAt:q.fillStudy.holdoutPublishedAt,
     at,familyScope:scope,quoteRegime:q.fillStudy.quoteRegime,side:q.side,
    });
    if(bound.status!=='exploratory-heldout-screened'){
     gaps.push({kind:'maker',id:q.id,reason:'upstream fill study not heldout-improved: '+bound.status});
     continue;
    }
    fillEvidence=bound.fillEvidence;
    fillGivenWin=bound.probabilityFillGivenWin;
    fillGivenLoss=bound.probabilityFillGivenLoss;
   }catch(error){
    gaps.push({kind:'maker',id:q.id,reason:'upstream fill evidence mismatch: '+error.message});
    continue;
   }
  }
  makers.push({
   id:q.id,ticker,side:q.side,priceUsd:q.priceUsd,
   feeUsd:fee(q.priceUsd,series,true),
   quoteObservedAt:market.marketObservedAt,closeAt:market.close_time,
   fillEvidence,
   ...(fillEvidence?.kind==='outcome-conditioned'?{
     probabilityFillGivenWin:fillGivenWin,
     probabilityFillGivenLoss:fillGivenLoss,
   }:{probabilityFill:q.probabilityFill}),
   ...(q.incentiveScenario?{incentiveScenario:q.incentiveScenario}:{}),
   carryUsd:q.carryUsd??0,
  });
 }
 const structural=[];
 const conditionalLP=base.coherence[0]?.portfolio;
 if(conditionalLP&&finite(conditionalLP.guaranteed)&&conditionalLP.guaranteed>0){
  // Conditional guarantee from the existing LP is only a full-fill
  // portfolio, not executable evidence about its partial legs.
  structural.push({id:'conditional-coherence-lp',
    allLegsGuaranteedPnlUsd:conditionalLP.guaranteed});
 }
 const menu=compareBinaryParticipationMenu({
   at,scope,settlementProbabilityYes:{low:settlementBand.low,high:settlementBand.high},
   settlementEvidence:evidence,takerCandidates:takers,makerCandidates:makers,
   structuralCandidates:structural,maxQuoteAgeMs:maxBookAgeMs,
 });
 let informationValue=null,observedSignalDecision=null;const informationGaps=[];
 if(signalStudy!==null){
  try{
   if(signalStudy.scope!==scope)
    throw new TypeError('information model scope does not match AAA event/source');
   if(!finite(signalStudy.computeCostUsd)||signalStudy.computeCostUsd<0||
      !finite(signalStudy.repricingCostBoundUsd)||signalStudy.repricingCostBoundUsd<0)
    throw new TypeError('explicit source/compute cost and opponent repricing budget required');
   if(!takers.length)
    throw new TypeError('no executable one-lot taker actions available for the value-of-information comparison');
   const actions=[
    {id:'abstain',payoffsUsdByScenario:Object.fromEntries(
      scenarioForecast.scenarios.map(s=>[s.id,0]))},
    ...takers.map(t=>({id:t.id,payoffsUsdByScenario:Object.fromEntries(
      scenarioForecast.scenarios.map(s=>{
       const v=s.values[scenarioForecast.outcomeValueKey],
         yesWin=v>market.floor_strike;
       const ownWin=t.side==='yes'?yesWin:!yesWin;
       return [s.id,Number(ownWin)-t.priceUsd-t.feeUsd];
      }))})),
   ];
   informationValue=evaluateMarketInformationValue({
    forecast:scenarioForecast,actions,signalModel:signalStudy.model,at,
    computeCostUsd:signalStudy.computeCostUsd,
    repricingCostBoundUsd:signalStudy.repricingCostBoundUsd,
   });
   if(conditionedSignal!==null){
    // Same immutable book/fee action menu, posterior Bayes decision. A
    // different, later market book requires a NEW observation and action menu.
    const conditioned=conditionMarketForecastOnSignal({
     forecast:scenarioForecast,signalModel:signalStudy.model,
     observation:signalObservation,at,actions,
    });
    observedSignalDecision=conditioned.conditionalAction;
   }
  }catch(error){informationGaps.push({
   kind:'conditional-information-value',reason:error.message});}
 }

 return {
  kind:'aaa-gas-participation-research-v1',
  status:'conditional-venue-research',at,ticker,scope,
  scenarioProjection:{forecastId:scenarioProjection.forecastId,
   marketProbabilityYes:p,targetScope:base.sourceScope,
   marketProbabilities:scenarioProjection.marketProbabilities,
   nestedPairs:scenarioProjection.nestedPairs},
  posteriorForecast:conditionedSignal?.forecast??null,
  signProjection,
  observedSignal:conditionedSignal===null?null:{
   observationId:conditionedSignal.observationId,
   signalId:conditionedSignal.signalId,
   status:conditionedSignal.status,
   logObservationLikelihood:conditionedSignal.logObservationLikelihood,
   posteriorPriorDivergenceNats:conditionedSignal.posteriorPriorDivergenceNats,
   sourceAuthenticated:false,tradeEligible:false,orderEffect:false,
  },
  observedSignalDecision,coherence:base.coherence,menu,informationValue,
  gaps:[...base.gaps,...gaps,...menu.gaps,...informationGaps],
  dependencies:['existing Kalshi AAA rule/quote parser and nested-scenario projection',
   'existing Kalshi quadratic fee model and orderbook depth',
   'shared maker adverse-fill model, joint market-game and abstention decision menu'],
  empiricalGate:'calibration and queue model metadata were supplied by caller; independently verified trade-worthiness is NOT established',
  tradeEligible:false,orderEffect:false,
 };
}
