import test from 'node:test';
import assert from 'node:assert/strict';
import {compareAaaGasParticipation} from '@red-cup-engineering/forecasting/aaa-gas-participation';
import {fitBinaryOutcomeFillByDay,scoreBinaryOutcomeFillHoldout}
 from '@red-cup-engineering/mandate-portfolio-allocation-service/binary-fill-calibration';

const at='2026-10-12T20:00:00Z',eventTicker='KXAAAGASD-26OCT13';
const scope=eventTicker+'|AAA:regular-gasoline|United States';
const series={ticker:'KXAAAGASD',fee_type:'quadratic_with_maker_fees',fee_multiplier:1};
const market=(strike,bid,ask,more={})=>({
 ticker:eventTicker+'-'+strike.toFixed(4),
 floor_strike:strike,strike_type:'greater',
 rules_primary:'Resolves Yes if average regular gas prices for United States are strictly greater than $'+strike.toFixed(4)+' on Oct 13, 2026 according to AAA.',
 close_time:'2026-10-13T03:59:00Z',marketObservedAt:'2026-10-12T19:59:30Z',
 yes_bid_dollars:bid.toFixed(4),yes_ask_dollars:ask.toFixed(4),
 yes_bid_size_fp:'20',yes_ask_size_fp:'20',...more,
});
const event=()=>({
 event_ticker:eventTicker,series_ticker:'KXAAAGASD',
 markets:[market(4,.94,.96),market(4.005,.60,.65),market(4.01,.1,.15)],
});
const target=()=>event().markets[0].ticker;
const scenario=()=>({
 id:'previously-issued-joint-scenarios',observedAt:'2026-10-12T18:00:00Z',
 availableAt:'2026-10-12T18:30:00Z',
 horizon:'2026-10-13T14:00:00Z',eventTicker,targetDate:'2026-10-13',targetSource:'AAA',
 targetScope:'United States',outcomeValueKey:'officialGas',
 evidenceIds:['source-custody','prior-model-score'],
 scenarios:[
  {id:'below',probability:.1,values:{officialGas:3.995}},
  {id:'4.002',probability:.4,values:{officialGas:4.002}},
  {id:'4.007',probability:.4,values:{officialGas:4.007}},
  {id:'4.013',probability:.1,values:{officialGas:4.013}},
 ],
});
const scored=(more={})=>({
 scope,modelId:'gas-graded-distribution',
 calibrationRecordId:'calibration-days-before-target',
 availableAt:'2026-10-12T18:45:00Z',
 evidenceIds:['independent-calibration-source'],
 low:.89,high:.92,...more,
});
const fill=(more={})=>({
 kind:'outcome-conditioned',id:'previously-calibrated-queue-hazard',
 scope,availableAt:'2026-10-12T19:00:00Z',
 evidenceIds:['prior-day-queue-fill-receipts'],...more,
});
const maker=(more={})=>({
 id:'rest-YES',ticker:target(),side:'yes',priceUsd:.95,
 fillEvidence:fill(),
 probabilityFillGivenWin:{low:.8,high:.8},
 probabilityFillGivenLoss:{low:.1,high:.1},
 ...more,
});
const study=(more={})=>compareAaaGasParticipation({
 event:event(),series,at,ticker:target(),
 scenarioForecast:scenario(),settlementBand:scored(),
 makerQuotes:[],...more,
});

test('the Kalshi research bridge builds a real shared action comparison from exact source+fee+book',()=>{
 const r=study({makerQuotes:[maker()]});
 assert.equal(r.status,'conditional-venue-research');
 assert.equal(r.scope,scope);
 assert.equal(r.scenarioProjection.marketProbabilityYes,.9);
 assert.ok(r.menu.candidates.some(x=>x.kind==='taker'));
 assert.ok(r.menu.candidates.some(x=>x.kind==='maker'));
 assert.equal(r.menu.decision.id,'rest-YES');
 assert.equal(r.menu.candidates[0].fillModelId,'previously-calibrated-queue-hazard');
 assert.ok(r.menu.candidates[0].details.makerFeeUsdPerFill>0);
 assert.equal(r.tradeEligible,false);
 assert.equal(r.menu.orderEffect,false);
});

test('without outcome calibration the exact joint forecast does NOT authorize an attractive quote',()=>{
 const r=study({settlementBand:null,makerQuotes:[maker()]});
 assert.equal(r.status,'missing-consistent-source-calibration');
 assert.equal(r.menu,null);
 assert.equal(r.tradeEligible,false);
});

test('a prior model band must actually contain the joint scenario projection',()=>{
 const r=study({settlementBand:scored({low:.95,high:.99})});
 assert.equal(r.status,'missing-consistent-source-calibration');
 assert.equal(r.menu,null);
});

test('a shared forecast with the wrong official target day cannot price AAA',()=>{
 const wrong=study({scenarioForecast:{...scenario(),targetDate:'2026-10-14'}});
 assert.equal(wrong.status,'unbound-event-or-joint-scenario');
});

test('an AAA Maine forecast cannot price the United States event',()=>{
 const s={...scenario(),targetScope:'Maine'};
 const r=study({scenarioForecast:s});
 assert.equal(r.status,'unbound-event-or-joint-scenario');
});

test('previously published target and fill models are mandatory for maker comparison',()=>{
 const r=study({makerQuotes:[maker({fillEvidence:fill({availableAt:'2026-10-12T21:00:00Z'})})]});
 assert.equal(r.menu.gaps.length,1);
 assert.equal(r.menu.gaps[0].id,'rest-YES');
 assert.ok(!r.menu.candidates.some(x=>x.kind==='maker'));
 assert.equal(r.tradeEligible,false);
});

test('a fictitious incentive bonus is never added to guaranteed net maker cash',()=>{
 const a=study({makerQuotes:[maker()]});
 const b=study({makerQuotes:[maker({incentiveScenario:{low:1,high:3}})]});
 const m1=a.menu.candidates.find(x=>x.id==='rest-YES'),m2=b.menu.candidates.find(x=>x.id==='rest-YES');
 assert.deepEqual(m1.expectedPnlUsdPerAttempt,m2.expectedPnlUsdPerAttempt);
 assert.equal(m2.rewardAlreadyIncludedUsd,0);
 assert.equal(m2.kind,'incentive-maker');
});

test('sub-cent books are not silently rounded to zero fee under whole-cent venue fee formula',()=>{
 const e=event();e.markets[0]=market(4,.94,.9601);
 const r=study({event:e,makerQuotes:[maker()]});
 assert.equal(r.status,'conditional-venue-research');
 assert.ok(r.gaps.some(x=>x.kind==='taker'&&x.side==='yes'));
 assert.ok(!r.menu.candidates.some(x=>x.id==='take-yes'));
 assert.equal(r.tradeEligible,false);
});

test('empty executable depth removes taker but does not fabricate market-maker fill probability',()=>{
 const e=event();e.markets[0]=market(4,.94,.96,{yes_ask_size_fp:'0',yes_bid_size_fp:'0'});
 const r=study({event:e});
 assert.equal(r.menu.candidates.length,0);
 assert.equal(r.menu.decision.action,'abstain');
 assert.ok(r.gaps.some(x=>x.side==='yes'));
 assert.ok(r.gaps.some(x=>x.side==='no'));
});

test('structural coherence remains conditional on all hedge legs filling simultaneously',()=>{
 const e=event();
 e.markets[0]=market(4,.1,.12);
 e.markets[1]=market(4.005,.90,.92);
 const r=study({event:e});
 assert.equal(r.status,'conditional-venue-research');
 assert.equal(r.coherence[0].verdict,'dutch-book');
 assert.equal(r.tradeEligible,false);
 // LP may produce a positive all-filled guarantee; no joint-leg
 // fill evidence is supplied here and nothing is granted authority.
 assert.ok(r.menu.candidates.every(x=>x.tradeEligible===false));
});

test('unknown Kalshi fee type/changed rules or stale market quotes withhold all actions',()=>{
 const noFee=study({series:{...series,fee_type:'unknown'}});
 assert.equal(noFee.status,'unbound-event-or-joint-scenario');
 const stale=event();stale.markets[1]={...stale.markets[1],marketObservedAt:'2026-10-12T19:00:00Z'};
 const x=study({event:stale});
 assert.equal(x.status,'unbound-event-or-joint-scenario');
 const bad=event();bad.markets[0]={...bad.markets[0],rules_primary:'not AAA'};
 const y=study({event:bad});
 assert.equal(y.status,'unbound-event-or-joint-scenario');
});

test('frozen calibration and source receipts must not arrive after the trading decision',()=>{
 assert.equal(study({settlementBand:scored({availableAt:'2026-10-12T21:00:00Z'})}).status,
  'missing-consistent-source-calibration');
 assert.equal(study({scenarioForecast:{...scenario(),availableAt:'2026-10-12T21:00:00Z'}}).status,
  'unbound-event-or-joint-scenario');
});


const information=(correct=1,extra={})=>({
 scope,computeCostUsd:.005,repricingCostBoundUsd:.01,
 model:{
  id:'pretrained-AAA-price-movement-signal',
  conditionedOnForecastId:scenario().id,
  availableAt:'2026-10-12T18:15:00Z',
  sourceEvidenceIds:['authorized-prior-price-data'],
  signals:[
   {id:'low-source-indication',likelihoodByScenario:{
    below:correct,'4.002':1-correct,'4.007':1-correct,'4.013':1-correct}},
   {id:'high-source-indication',likelihoodByScenario:{
    below:1-correct,'4.002':correct,'4.007':correct,'4.013':correct}},
  ],
 },
 ...extra,
});

test('perfect upstream AAA source signal has positive sample information value at a frozen book',()=>{
 const r=study({signalStudy:information()});
 assert.equal(r.status,'conditional-venue-research');
 assert.ok(r.informationValue);
 assert.ok(r.informationValue.grossEvsiUsd>0);
 assert.ok(r.informationValue.signals.some(s=>s.bestAction==='take-no'));
 assert.ok(r.informationValue.signals.some(s=>s.bestAction==='take-yes'));
 assert.equal(r.informationValue.tradeEligible,false);
 assert.equal(r.tradeEligible,false);
});

test('uninformative source signal has no EVSI even when two taker sides are offered',()=>{
 const r=study({signalStudy:information(.5)});
 assert.ok(Math.abs(r.informationValue.grossEvsiUsd)<1e-12);
 assert.equal(r.informationValue.shouldAcquireConditional,false);
 assert.equal(r.informationValue.netEvsiUsd,-.015);
});

test('rival repricing loss can dominate otherwise valuable gas information',()=>{
 const r=study({signalStudy:information(1,{repricingCostBoundUsd:1})});
 assert.ok(r.informationValue.grossEvsiUsd>0);
 assert.ok(r.informationValue.netEvsiUsd<0);
 assert.equal(r.informationValue.shouldAcquireConditional,false);
});

test('signal model must match same AAA source scope and be available before decision',()=>{
 const wrong=study({signalStudy:information(1,{scope:'AAA-Maine'})});
 assert.equal(wrong.informationValue,null);
 assert.ok(wrong.gaps.some(x=>x.kind==='conditional-information-value'));
 const late=information();
 late.model.availableAt='2026-10-12T21:00:00Z';
 const r=study({signalStudy:late});
 assert.equal(r.informationValue,null);
 assert.ok(r.gaps.some(x=>/signal kernel/i.test(x.reason)));
 assert.equal(r.tradeEligible,false);
});


// Synthetic SOURCE/ORDER fixtures exercise the structural receiving contract
// only. These are NOT AAA actual trades or a measured forecast improvement.
const quoteRegime='rest-YES-95c|queue-zero|240-minute';
const syntheticReceipt=(i,{perfect=false}={})=>{
 const d=new Date(Date.UTC(2024,0,1+i)).toISOString().slice(0,10);
 const win=i%2===0,filled=perfect?win:win?(i%5!==0):(i%5===1);
 return {
  venueOrderId:'synthetic-order-'+i,executionReceiptId:'synthetic-terminal-'+i,
  settlementReceiptId:'synthetic-settlement-'+d,
  familyScope:scope,quoteRegime,side:'yes',
  eventId:'SYNTHETIC-EVENT-'+d,marketId:'SYNTHETIC-MARKET-'+d,
  targetDate:d,settlementSide:win?'yes':'no',
  settlementStatus:'finalized',filled,attemptedContracts:1,
  filledContracts:Number(filled),
  bookReceivedAt:d+'T11:59:30Z',placedAt:d+'T12:00:00Z',
  terminalAt:d+'T12:10:00Z',settledAt:d+'T15:00:00Z',
  settlementAvailableAt:d+'T16:00:00Z',
  ...(filled?{fillReceivedAt:d+'T12:05:00Z'}:{}),
  evidenceIds:['synthetic-book-'+d,'synthetic-order-proof-'+d],
 };
};
const syntheticScreen=()=>{
 const training=fitBinaryOutcomeFillByDay({
  familyScope:scope,quoteRegime,side:'yes',
  freezeAt:'2024-03-05T00:00:00Z',publishedAt:'2024-03-05T01:00:00Z',
  rows:Array.from({length:60},(_,i)=>syntheticReceipt(i)),
 });
 const holdout=scoreBinaryOutcomeFillHoldout({
  training,rows:Array.from({length:300},(_,i)=>syntheticReceipt(i+95,{perfect:true})),
  evaluatedAt:'2025-12-31T00:00:00Z',minEvaluationDays:30,
 });
 return {training,holdout,quoteRegime,holdoutPublishedAt:'2026-01-01T00:00:00Z'};
};
const screenMaker=(fillStudy)=>maker({
  id:'source-screened-maker',fillEvidence:undefined,
  probabilityFillGivenWin:undefined,probabilityFillGivenLoss:undefined,
  fillStudy,
});

test('AAA venue adapter obtains conditional hazard bands from shared training and heldout studies',()=>{
 const studyData=syntheticScreen();
 assert.equal(studyData.holdout.conditionallyImproved,true);
 const r=study({makerQuotes:[screenMaker(studyData)]});
 assert.equal(r.status,'conditional-venue-research');
 assert.equal(r.gaps.filter(x=>x.kind==='maker').length,0);
 const m=r.menu.candidates.find(x=>x.id==='source-screened-maker');
 assert.ok(m);
 assert.equal(m.kind,'maker');
 assert.ok(m.fillModelId);
 assert.ok(m.fillModelId!==studyData.training.id);
 assert.equal(m.details.tradeEligible,false);
 assert.equal(r.tradeEligible,false);
});

test('unproved or incorrectly scoped fill evidence cannot price an AAA maker through the new study path',()=>{
 const good=syntheticScreen(),bad={
  ...good,holdout:{...good.holdout,conditionallyImproved:false},
 };
 const weak=study({makerQuotes:[screenMaker(bad)]});
 assert.ok(weak.gaps.some(x=>x.kind==='maker'&&/holdout/i.test(x.reason)));
 assert.ok(!weak.menu.candidates.some(x=>x.id==='source-screened-maker'));
 const wrong=study({makerQuotes:[screenMaker({...good,training:{
   ...good.training,familyScope:'diesel|another-population'},
 })]});
 assert.ok(wrong.gaps.some(x=>x.kind==='maker'));
 assert.ok(!wrong.menu.candidates.some(x=>x.id==='source-screened-maker'));
});

test('manual hypothetical fill estimates may not be silently combined with a historical fill study',()=>{
 const complete=syntheticScreen();
 const combined=study({makerQuotes:[maker({
  fillStudy:complete,
 })]});
 assert.ok(combined.gaps.some(x=>x.kind==='maker'&&/never combine both/i.test(x.reason)));
 assert.ok(!combined.menu.candidates.some(x=>x.id==='rest-YES'));
});


test('one received AAA source observation revises the full shared scenario ladder and research action',()=>{
 const signalStudy=information(.8);
 const observation={
  id:'received-AAA-source-indication-1',signalId:'low-source-indication',
  observedAt:'2026-10-12T19:20:00Z',availableAt:'2026-10-12T19:30:00Z',
  evidenceIds:['actual-source-byte-receipt'],
 };
 const posteriorId=JSON.stringify(['conditioned-joint-forecast',
   scenario().id,signalStudy.model.id,observation.id,observation.signalId]);
 const r=study({
  signalStudy,signalObservation:observation,
  settlementBand:scored({
   low:.68,high:.71,forecastId:posteriorId,
  }),
 });
 assert.equal(r.status,'conditional-venue-research');
 assert.equal(r.scenarioProjection.forecastId,posteriorId);
 assert.equal(r.posteriorForecast.id,posteriorId);
 assert.ok(r.posteriorForecast.evidenceIds.includes('actual-source-byte-receipt'));
 assert.ok(Math.abs(r.scenarioProjection.marketProbabilityYes-9/13)<1e-12);
 const ps=r.scenarioProjection.marketProbabilities.map(m=>m.probabilityYes);
 assert.ok(ps.every((p,i)=>i===0||ps[i-1]>=p));
 assert.ok(ps[1]>.3&&ps[1]<.5);
 assert.equal(r.observedSignalDecision.posteriorBestAction,'take-no');
 assert.equal(r.observedSignal.sourceAuthenticated,false);
 assert.equal(r.tradeEligible,false);
 assert.equal(r.orderEffect,false);
});

test('an unscoped or unavailable observation cannot silently reprice the AAA ladder',()=>{
 const info=information(.8);
 const obs={id:'new-report',signalId:'low-source-indication',
  observedAt:'2026-10-12T19:20:00Z',
  availableAt:'2026-10-12T19:30:00Z',evidenceIds:['publisher-receipt']};
 assert.equal(study({signalObservation:obs}).status,'unbound-conditional-source-signal');
 assert.equal(study({signalStudy:info,
  signalObservation:{...obs,availableAt:'2026-10-12T21:00:00Z'}}).status,
  'unqualified-conditional-source-signal');
 assert.equal(study({signalStudy:info,signalObservation:obs,
  settlementBand:scored({low:.68,high:.71})}).status,
  'missing-consistent-source-calibration');
});
