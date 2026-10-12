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
import {binaryMakerPlacementBounds,rankBinaryMakerPlacements} from '@red-cup-engineering/mandate-portfolio-allocation-service/binary-maker-game';
import {ladderGroups,buildLadder,ladderFamily} from './coherence-families.mjs';
import {assessFamily} from './coherence.mjs';
import {orderFeeCentsOfFills} from './fees.mjs';
import {eventDate} from '@red-cup-engineering/kalshi-services-section/market-facts';

const validClock=(s)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const validNum=(x)=>typeof x==='number'&&Number.isFinite(x);
const gasSeries=(ticker)=>/^KXAAAGAS(?:D|W|M)(?:[A-Z]{2})?$/u.test(ticker??'');
const knownAAA=(rules)=>typeof rules==='string'&&
  /according to AAA\b/iu.test(rules)&&/average regular gas prices/iu.test(rules)&&
  /strictly greater than/iu.test(rules);
/** Market's named survey population is part of the payout, not metadata. */
export function aaaGasScopeOf(market){
 const s=market?.rules_primary;
 if(!knownAAA(s))return null;
 return /average regular gas prices for (.+?) are strictly greater than /iu.exec(s)?.[1]?.trim()??null;
}
const validRung=(m,event,at,maxAgeMs)=>(
  m&&typeof m.ticker==='string'&&m.ticker.startsWith(event.event_ticker+'-')&&
  m.strike_type==='greater'&&validNum(m.floor_strike)&&m.floor_strike>0&&
  knownAAA(m.rules_primary)&&validClock(m.close_time)&&Date.parse(m.close_time)>at&&
  validClock(m.marketObservedAt)&&Date.parse(m.marketObservedAt)<=at&&
  at-Date.parse(m.marketObservedAt)<=maxAgeMs
);
const emptyMaker=()=>rankBinaryMakerPlacements([]);


/**
 * Push forward one EXISTING shared market-game joint scenario forecast into
 * ALL "AAA price > strike" binary contracts for the SAME event.
 *
 * Scenarios are the upstream market-game's weighted scenario records, not a
 * bespoke AAA posterior or independent Bernoulli models per rung. This makes
 * the implied tail probability monotonically nonincreasing in strike and
 * retains exact covariance between ANY two nested rungs:
 *
 *  P(W_i AND W_j) = P(X > max(strike_i, strike_j))
 *  Cov(W_i,W_j) = joint - P(W_i)P(W_j).
 *
 * A model/forecaster must supply source/target binding and a real issuance
 * clock. Probability normalisation alone does not establish empirical skill.
 * Neither these prices nor their covariance make trades admissible.
 */
export function projectAaaGasScenarioLadder({event,forecast,at}={}){
  if(!event||!forecast||!validClock(at)||forecast.targetSource!=='AAA'||
     forecast.eventTicker!==event.event_ticker||typeof forecast.id!=='string'||!forecast.id||
     !eventDate(event.event_ticker)||forecast.targetDate!==eventDate(event.event_ticker)||
     typeof forecast.targetScope!=='string'||!forecast.targetScope||
     !validClock(forecast.observedAt)||!validClock(forecast.horizon)||
     Date.parse(forecast.observedAt)>Date.parse(at)||
     Date.parse(forecast.horizon)<=Date.parse(at)||
     (forecast.availableAt!==undefined&&(!validClock(forecast.availableAt)||
       Date.parse(forecast.availableAt)>Date.parse(at)))||
     typeof forecast.outcomeValueKey!=='string'||!forecast.outcomeValueKey||
     !Array.isArray(forecast.evidenceIds)||!forecast.evidenceIds.length||
     !Array.isArray(forecast.scenarios)||forecast.scenarios.length<2||
     forecast.scenarios.length>512)
    throw new TypeError('bounded, point-in-time AAA target-source shared scenario forecast required');
  if(!Array.isArray(event.markets)||event.markets.length<2||event.markets.length>128||
     event.markets.some(m=>m.strike_type!=='greater'||!validNum(m.floor_strike)||
       !knownAAA(m.rules_primary)||typeof m.ticker!=='string'||
       aaaGasScopeOf(m)!==forecast.targetScope))
    throw new TypeError('source-matched directional AAA threshold roster required');
  const ids=new Set(),values=[];
  let total=0;
  for(const s of forecast.scenarios){
    if(!s||typeof s.id!=='string'||!s.id||ids.has(s.id)||
       !validNum(s.probability)||s.probability<0||s.probability>1||
       !validNum(s.values?.[forecast.outcomeValueKey]))
      throw new TypeError('unique shared scenario id, mass and numeric official-price target required');
    ids.add(s.id);total+=s.probability;
    values.push({price:s.values[forecast.outcomeValueKey],mass:s.probability});
  }
  if(Math.abs(total-1)>1e-9)throw new RangeError('scenario mass must sum to one');
  const ladder=event.markets.map(m=>({
    ticker:m.ticker,strikeUsdGallon:m.floor_strike,
    probabilityYes:values.reduce((acc,x)=>acc+(x.price>m.floor_strike?x.mass:0),0),
  })).sort((a,b)=>a.strikeUsdGallon-b.strikeUsdGallon);
  if(new Set(ladder.map(x=>x.strikeUsdGallon)).size!==ladder.length)
    throw new TypeError('one contract per AAA threshold required');
  if(ladder.some((x,i)=>i&&x.probabilityYes>ladder[i-1].probabilityYes+1e-12))
    throw new Error('nested scenario projection violated probability monotonicity');
  const pairs=[];
  for(let i=0;i<ladder.length;i++)for(let j=i;j<ladder.length;j++){
    const a=ladder[i],b=ladder[j];
    const joint=b.probabilityYes; // Sorted by nondecreasing strike; W_j subset W_i.
    pairs.push({first:a.ticker,second:b.ticker,jointYesProbability:joint,
      yesCovariance:joint-a.probabilityYes*b.probabilityYes});
  }
  return {
    status:'scenario-pushforward-ungraded',
    kind:'aaa-nested-threshold-scenario-pushforward-v1',
    eventTicker:event.event_ticker,targetDate:forecast.targetDate,forecastId:forecast.id??null,
    issuedAt:forecast.observedAt,sourceAvailableAt:forecast.availableAt??forecast.observedAt,at,source:'AAA',
    outcomeValueKey:forecast.outcomeValueKey,targetScope:forecast.targetScope,evidenceIds:[...forecast.evidenceIds],
    marketProbabilities:ladder,nestedPairs:pairs,
    interpretation:'exact projection of DECLARED shared market-game scenarios; no independent-strike approximation',
    statisticalSkill:'not certified by this operation; compare day-clustered forecast scores against Kalshi',
    tradeEligible:false,orderEffect:false,
  };
}

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
  event,series,at,quoteCandidates=[],scenarioForecast=null,maxBookAgeMs=60_000,
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
     !eventDate(event.event_ticker)||
     !Array.isArray(event.markets)||event.markets.length<2)
    return {...base,status:'unsupported-or-unbound-gas-event',gaps:['source/series/event/rung roster not bound'],coherence:[],maker:emptyMaker()};
  if(!['quadratic','quadratic_with_maker_fees','quadratic_with_combo_maker_fees'].includes(series.fee_type)||
     !validNum(Number(series.fee_multiplier??1))||Number(series.fee_multiplier??1)<0)
    return {...base,status:'unbound-series-fee-schedule',gaps:['unknown Kalshi fee type/multiplier'],coherence:[],maker:emptyMaker()};
  const invalid=event.markets.filter(m=>!validRung(m,event,now,maxBookAgeMs));
  const scope=aaaGasScopeOf(event.markets[0]);
  const inconsistentScope=!scope||event.markets.some(m=>aaaGasScopeOf(m)!==scope);
  if(invalid.length||inconsistentScope)
    return {...base,status:'unqualified-exchange-snapshot',
      gaps:[...invalid.map(m=>({ticker:m?.ticker??null,reason:'missing/changed AAA contract terms, closed market or stale/absent timestamped book'})),
        ...(inconsistentScope?[{reason:'rung survey populations differ or are unbound'}]:[])],
      coherence:[],maker:emptyMaker()};
  const groups=ladderGroups(event);
  if(groups.length!==1||groups[0][1].length!==event.markets.length)
    return {...base,status:'unbound-gas-ladder',gaps:['markets do not form one unambiguous directional AAA strike ladder'],
      coherence:[],maker:emptyMaker()};
  const [subject,markets]=groups[0];
  const ladder=buildLadder(event,subject,markets,series);
  if(ladder.skipped)return {...base,status:'unbound-gas-ladder',gaps:[ladder.skipped],coherence:[],maker:emptyMaker()};
  const c=assessFamily(ladderFamily(ladder));
  let scenarioProjection=null;const projectionGaps=[];
  if(scenarioForecast){try{scenarioProjection=projectAaaGasScenarioLadder({event,forecast:scenarioForecast,at});}
    catch(error){projectionGaps.push({reason:'unqualified shared market-game scenario: '+error.message});}}
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
    const yesBid=Number(m.yes_bid_dollars),yesAsk=Number(m.yes_ask_dollars);
    if(!validNum(yesBid)||!validNum(yesAsk)||yesBid<0||yesAsk>1||yesBid>=yesAsk){
      gaps.push({candidate:row.id,reason:'no valid contemporaneous two-sided YES book'});continue;
    }
    const quoteYesPrice=row.side==='yes'?row.priceUsd:1-row.priceUsd;
    if(!validNum(quoteYesPrice)||
       !(row.side==='yes'?quoteYesPrice>=yesBid&&quoteYesPrice<yesAsk:
         quoteYesPrice>yesBid&&quoteYesPrice<=yesAsk)){
      gaps.push({candidate:row.id,reason:'maker candidate crosses the book or is not at/inside the displayed touch'});continue;
    }
    if(!validNum(row.priceUsd)||row.priceUsd<=0||row.priceUsd>=1||
       Math.abs(row.priceUsd*100-Math.round(row.priceUsd*100))>1e-8)
      {gaps.push({candidate:row.id,reason:'requires a whole-cent one-contract resting quote from owning planner'});continue;}
    const feeType=series.fee_type,multiplier=Number(series.fee_multiplier??1);
    const actualFeeUsd=orderFeeCentsOfFills([{count:1,priceCents:Math.round(row.priceUsd*100)}],
      {feeType,multiplier,maker:true})/100;
    const proposed={
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
    };
    try{binaryMakerPlacementBounds(proposed);admitted.push(proposed);}
    catch(error){gaps.push({candidate:row.id,reason:'invalid conditional probability or cost assumptions: '+error.message});}
  }
  return {...base,status:'read-only-research',
    sourceBinding:'AAA average regular gasoline strictly greater than the named strike; source published after market close is not pre-close information',
    sourceScope:scope,
    coherence,scenarioProjection,maker:rankBinaryMakerPlacements(admitted),gaps:[...projectionGaps,...gaps],
    experimentalLimits:[
      'No calibrated AAA forward distribution supplied unless externally measured and timestamped',
      'No derived per-order queue/fill probability unless externally measured and timestamped',
      'Reference-price liquidity incentive competition is not a guaranteed reward',
      'Cross-strike LP assumes simultaneous depth and settlement semantics; it is not an executable fill certificate',
    ]};
}


/**
 * Audit the EXISTING public AAA+Kalshi observer's archived JSONL records.
 * The collector records receipt time, AAA source as_of, national_avg, and
 * displayed Kalshi bid/ask values, but NOT depth or queue position.
 * Count distinct source versions and apparent directional ladder crossings.
 * Do not count repeated 15-minute ticks as independent AAA observations.
 */
export function auditAaaGasCollectorSnapshots(records){
  if(!Array.isArray(records)||records.length>200000)
    throw new TypeError('bounded archived AAA/Kalshi snapshots required');
  const seen=new Map(),identities=new Set();
  let comparisons=0,crossings=0,snapshotsWithCrossing=0;
  let firstAt=null,lastAt=null;
  for(const rec of [...records].sort((a,b)=>Date.parse(a.ts)-Date.parse(b.ts))){
    if(!rec||!validClock(rec.ts)||!Array.isArray(rec.markets)||rec.markets.length>10000)
      throw new TypeError('each collector record must have receipt clock and bounded market rows');
    if(identities.has(rec.ts))throw new TypeError('duplicate collector receipt time');
    identities.add(rec.ts);
    firstAt??=rec.ts;lastAt=rec.ts;
    const sample=rec.aaa??{};
    if(typeof sample.as_of==='string'&&validNum(sample.national_avg)){
      const id=sample.as_of+'|'+sample.national_avg;
      if(!seen.has(id))seen.set(id,{asOf:sample.as_of,
        nationalAverageUsdGallon:sample.national_avg,firstObservedAt:rec.ts,observations:0});
      seen.get(id).observations++;
    }
    const eventRows=new Map();
    for(const m of rec.markets){
      if(!Array.isArray(m)||m.length<8||typeof m[0]!=='string')continue;
      const parts=/^(KXAAAGASD(?:[A-Z]{2})?-\d{2}[A-Z]{3}\d{2})-/u.exec(m[0]);
      if(!parts||!validNum(Number(m[1]))||!validClock(m[7])||
         Date.parse(rec.ts)>=Date.parse(m[7]))continue;
      if(!eventRows.has(parts[1]))eventRows.set(parts[1],[]);
      eventRows.get(parts[1]).push({strike:Number(m[1]),bid:Number(m[2]),ask:Number(m[3])});
    }
    let hit=false;
    for(const rows of eventRows.values()){
      rows.sort((a,b)=>a.strike-b.strike);
      for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
        const lower=rows[i],higher=rows[j];
        if(!(lower.strike<higher.strike&&lower.ask>0&&lower.ask<1&&
          higher.bid>0&&higher.bid<1))continue;
        comparisons++;
        if(higher.bid>lower.ask+1e-9){crossings++;hit=true;}
      }
    }
    if(hit)snapshotsWithCrossing++;
  }
  return {kind:'aaa-public-collector-source-information-audit-v1',
    ticks:records.length,distinctSourceVersions:seen.size,
    sourceVersions:[...seen.values()],firstObservedAt:firstAt,lastObservedAt:lastAt,
    strictlyCrossedDisplayedPairs:crossings,comparedDisplayedPairs:comparisons,
    snapshotsWithDisplayedCrossing:snapshotsWithCrossing,
    limits:['only observer receipts; no exact Kalshi market rules or book depth',
      'displayed crossing is necessary, not sufficient for simultaneous executable arbitrage',
      'same-day repeated snapshots are dependent and do not add independent AAA settlement labels'],
    tradeEligible:false,orderEffect:false};
}
