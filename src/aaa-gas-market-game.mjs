/**
 * AAA gasoline prediction-market RESEARCH as a composition of existing games.
 *
 * DO NOT build a second Kalshi orderbook/coherence engine/allocator here.
 *
 * 1. Validate one AAA daily/weekly/monthly directional threshold event and
 *    its official contract rules at the point-in-time market snapshot.
 * 2. Reuse Kalshi's existing coherence-families + simplex/fee-aware assessor
 *    to look for cross-strike outcome contradictions/Dutch books.
 * 3. Reuse the shared prediction-market Fréchet maker game to score supplied
 *    calibrated probability and fill models, including adversarial selection.
 *
 * No independent forecasts are invented: historical simple daily/weekly AAA
 * autoregressions were beaten by Kalshi's prices. An unspecified or stale
 * likelihood, fill model, missing source rule, fee schedule or book timestamp
 * is a RESEARCH GAP, not a simulated profitable opportunity.
 *
 * Kalshi is a CENTRAL LIMIT ORDER BOOK, not a deployed onchain AMM pool.
 * Passive bids/asks are automated market-making *strategies* and have
 * queue priority, adverse fills, fees and possible, non-guaranteed LIP
 * rewards. Every result is research-only and cannot place orders.
 */
import {rankBinaryMakerPlacements} from '@red-cup-engineering/mandate-portfolio-allocation-service/binary-maker-game';
import {ladderGroups,buildLadder,ladderFamily} from './coherence-families.mjs';
import {assessFamily} from './coherence.mjs';
import {orderFeeCentsOfFills} from './fees.mjs';

const validClock=(s)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const validNum=(x)=>typeof x==='number'&&Number.isFinite(x);
const gasSeries=(ticker)=>/^KXAAAGAS(?:D|W|M)(?:[A-Z]{2})?$/u.test(ticker??'');
const knownAAA=(rules)=>typeof rules==='string'&&
  /according to AAA\b/iu.test(rules)&&/average regular gas prices/iu.test(rules)&&
  /strictly greater than/iu.test(rules);
const validRung=(m,event,at,maxAgeMs)=>(
  m&&typeof m.ticker==='string'&&m.ticker.startsWith(event.event_ticker+'-')&&
  m.strike_type==='greater'&&validNum(m.floor_strike)&&m.floor_strike>0&&
  knownAAA(m.rules_primary)&&validClock(m.close_time)&&Date.parse(m.close_time)>at&&
  validClock(m.marketObservedAt)&&Date.parse(m.marketObservedAt)<=at&&
  at-Date.parse(m.marketObservedAt)<=maxAgeMs
);
const emptyMaker=()=>rankBinaryMakerPlacements([]);

/**
 * Point-in-time research packet from an already collected Kalshi event/series.
 * event.markets MUST carry exact rules_primary, marketObservedAt, live
 * close_time, strike, quote prices AND depth from the exchange adapter.
 *
 * Research candidates are not synthesized from book spreads; their quote
 * price comes from an existing venue market-making planner. A candidate
 * requires independently measured, contemporaneous forecast and queue
 * models with evidence availability clocks. No example probabilities,
 * zero-fee assumptions, or phantom incentive credits.
 */
export function analyzeAaaGasMarketGame({
  event,series,at,quoteCandidates=[],maxBookAgeMs=60_000,
}={}){
  if(!validClock(at)||!Array.isArray(quoteCandidates)||quoteCandidates.length>512||
     !Number.isInteger(maxBookAgeMs)||maxBookAgeMs<1||maxBookAgeMs>3600_000)
    throw new TypeError('fixed observation time, bounded candidates and book staleness required');
  const now=Date.parse(at),base={
    kind:'aaa-gas-market-game-research-v1',
    at,seriesTicker:event?.series_ticker??null,eventTicker:event?.event_ticker??null,
    hypotheses:['AAA published-price model','cross-strike structural coherence',
      'fill-conditioned resting-order game','incentive competition (unverified)'],
    orderEffect:false,tradeEligible:false,
  };
  if(!event||!series||!gasSeries(event.series_ticker)||
     event.series_ticker!==series.ticker||typeof event.event_ticker!=='string'||
     !event.event_ticker.startsWith(event.series_ticker+'-')||
     !Array.isArray(event.markets)||event.markets.length<2)
    return {...base,status:'unsupported-or-unbound-gas-event',gaps:['source/series/event/rung roster not bound'],coherence:[],maker:emptyMaker()};
  if(!['quadratic','quadratic_with_maker_fees','quadratic_with_combo_maker_fees'].includes(series.fee_type)||
     !validNum(Number(series.fee_multiplier??1))||Number(series.fee_multiplier??1)<0)
    return {...base,status:'unbound-series-fee-schedule',gaps:['unknown Kalshi fee type/multiplier'],coherence:[],maker:emptyMaker()};
  const invalid=event.markets.filter(m=>!validRung(m,event,now,maxBookAgeMs));
  if(invalid.length)
    return {...base,status:'unqualified-exchange-snapshot',
      gaps:invalid.map(m=>({ticker:m?.ticker??null,reason:'missing/changed AAA contract terms, closed market or stale/absent timestamped book'})),
      coherence:[],maker:emptyMaker()};
  const groups=ladderGroups(event);
  if(groups.length!==1||groups[0][1].length!==event.markets.length)
    return {...base,status:'unbound-gas-ladder',gaps:['markets do not form one unambiguous directional AAA strike ladder'],
      coherence:[],maker:emptyMaker()};
  const [subject,markets]=groups[0];
  const ladder=buildLadder(event,subject,markets,series);
  if(ladder.skipped)return {...base,status:'unbound-gas-ladder',gaps:[ladder.skipped],coherence:[],maker:emptyMaker()};
  const c=assessFamily(ladderFamily(ladder));
  const coherence=[{...c,interpretation:'existing Kalshi structural LP; hypothetical simultaneous book execution, fees and queue constraints still require receiving'}];
  const byTicker=new Map(event.markets.map(m=>[m.ticker,m]));
  const admitted=[],gaps=[];
  for(const row of quoteCandidates){
    if(!row||typeof row.id!=='string'||!byTicker.has(row.ticker)||
       !['yes','no'].includes(row.side))
      {gaps.push({candidate:row?.id??null,reason:'quote not bound to one event market/side'});continue;}
    // Model versions and their publicly available clocks, not unverifiable
    // post-hoc prices. No inference that two historical samples are independent.
    if(!row.modelId||!row.modelEvidenceId||!validClock(row.modelAvailableAt)||
       !row.fillModelId||!row.fillEvidenceId||!validClock(row.fillAvailableAt)||
       Date.parse(row.modelAvailableAt)>now||Date.parse(row.fillAvailableAt)>now)
      {gaps.push({candidate:row.id,reason:'missing or later-published calibrated outcome/fill evidence'});continue;}
    const m=byTicker.get(row.ticker);
    if(!validNum(row.priceUsd)||row.priceUsd<=0||row.priceUsd>=1||
       Math.abs(row.priceUsd*100-Math.round(row.priceUsd*100))>1e-8)
      {gaps.push({candidate:row.id,reason:'requires a whole-cent one-contract resting quote from owning planner'});continue;}
    const feeType=series.fee_type,multiplier=Number(series.fee_multiplier??1);
    const actualFeeUsd=orderFeeCentsOfFills([{count:1,priceCents:Math.round(row.priceUsd*100)}],
      {feeType,multiplier,maker:true})/100;
    admitted.push({
      id:row.id,side:row.side,priceUsd:row.priceUsd,
      makerFeeUsdPerFill:actualFeeUsd,
      probabilityYes:row.probabilityYes,probabilityFill:row.probabilityFill,
      // Never attribute unknown LIP rewards to the gas quote in this
      // read-only study. Separate incentive score/denominator measurement.
      carryUsdPerPlacement:row.carryUsdPerPlacement??0,
      source:{ticker:row.ticker,modelId:row.modelId,modelEvidenceId:row.modelEvidenceId,
        fillModelId:row.fillModelId,fillEvidenceId:row.fillEvidenceId,
        marketObservedAt:m.marketObservedAt,modelAvailableAt:row.modelAvailableAt,
        fillAvailableAt:row.fillAvailableAt,seriesFeeType:feeType},
    });
  }
  return {...base,status:'read-only-research',
    sourceBinding:'AAA average regular gasoline strictly greater than the named strike; source published after market close is not pre-close information',
    coherence,maker:rankBinaryMakerPlacements(admitted),gaps,
    experimentalLimits:[
      'No calibrated AAA forward distribution supplied unless externally measured and timestamped',
      'No derived per-order queue/fill probability unless externally measured and timestamped',
      'Reference-price liquidity incentive competition is not a guaranteed reward',
      'Cross-strike LP assumes simultaneous depth and settlement semantics; it is not an executable fill certificate',
    ]};
}
