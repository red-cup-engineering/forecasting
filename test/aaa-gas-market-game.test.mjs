import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAaaGasMarketGame,projectAaaGasScenarioLadder} from '../src/aaa-gas-market-game.mjs';

const at='2026-10-12T20:00:00Z',observedAt='2026-10-12T19:59:40Z';
const ticker='KXAAAGASD';
const series={ticker,fee_type:'quadratic_with_maker_fees',fee_multiplier:1};
function market(strike,bid,ask,extra={}){
 const s=strike.toFixed(4);
 return {ticker:ticker+'-26OCT13-'+s,
   floor_strike:strike,strike_type:'greater',
   rules_primary:'Resolves Yes if average regular gas prices for United States are strictly greater than $'+s+' on Oct 13, 2026 according to AAA.',
   close_time:'2026-10-13T03:59:00Z',marketObservedAt:observedAt,
   yes_bid_dollars:bid.toFixed(4),yes_ask_dollars:ask.toFixed(4),
   yes_bid_size_fp:'100',yes_ask_size_fp:'100',...extra};
}
const markets=()=>[market(4,.94,.96),market(4.005,.60,.65),market(4.01,.10,.15)];
const event=(overrides={})=>({event_ticker:ticker+'-26OCT13',series_ticker:ticker,markets:markets(),...overrides});
const args=(extras={})=>({event:event(),series,at,...extras});
const probability=(p)=>({low:p,high:p});
const quote=(extras={})=>({
 id:'research-maker-yes',ticker:markets()[0].ticker,side:'yes',priceUsd:.95,
 probabilityYes:probability(1),probabilityFill:probability(.4),
 modelId:'gas-panel-heldout-v1',modelEvidenceId:'sha:model-scored-before-day',
 modelAvailableAt:'2026-10-12T19:00:00Z',
 fillModelId:'gas-queue-v1',fillEvidenceId:'sha:queue-scored-before-day',
 fillAvailableAt:'2026-10-12T19:30:00Z',...extras,
});

test('source-bound AAA directional ladders reuse shared outcome coherence, not a gas-only LP',()=>{
 const r=analyzeAaaGasMarketGame(args());
 assert.equal(r.status,'read-only-research');
 assert.equal(r.coherence.length,1);
 assert.ok(['glued','tension','dutch-book'].includes(r.coherence[0].verdict));
 assert.equal(r.maker.action,'abstain');
 assert.equal(r.orderEffect,false);
 assert.equal(r.tradeEligible,false);
});

test('nonmonotone gas prices are passed to the existing cross-strike Dutch-book engine',()=>{
 const m=markets();
 m[0]=market(4,.10,.12);m[1]=market(4.005,.90,.92);
 const r=analyzeAaaGasMarketGame(args({event:event({markets:m})}));
 assert.equal(r.status,'read-only-research');
 assert.equal(r.coherence[0].verdict,'dutch-book');
 assert.ok(r.coherence[0].unitProfitBeforeFees>0);
 assert.equal(r.tradeEligible,false,'arbitrage LP does not establish simultaneous executable fills');
});

test('unspecified outcome/fill models never invent positive quotes',()=>{
 const r=analyzeAaaGasMarketGame(args({quoteCandidates:[quote({probabilityFill:null})]}));
 assert.equal(r.maker.action,'abstain');
 assert.equal(r.maker.bestCandidate,null);
 assert.equal(r.gaps.length,1);
 assert.match(r.gaps[0].reason,/invalid conditional probability/u);
});

test('research candidate uses exact venue maker fees and sharp adversarial fill couplings',()=>{
 const r=analyzeAaaGasMarketGame(args({quoteCandidates:[quote()]}));
 assert.equal(r.gaps.length,0);
 assert.equal(r.maker.action,'conditional-candidate');
 assert.equal(r.maker.bestCandidate,'research-maker-yes');
 const q=r.maker.candidates[0].quote;
 assert.ok(q.makerFeeUsdPerFill>0);
 assert.ok(q.makerFeeUsdPerFill<.01);
 assert.ok(q.conditionalPnlUsdPerPlacement.low>0);
 assert.equal(q.tradeEligible,false);
 assert.deepEqual(q.rewardScenarioUsdPerPlacement,{low:0,high:0});
});

test('quote-side NO purchase is valued through the same shared maker game',()=>{
 const m=markets()[2];
 const no=quote({id:'research-maker-no',ticker:m.ticker,side:'no',priceUsd:.86,
   probabilityYes:probability(0)});
 const r=analyzeAaaGasMarketGame(args({quoteCandidates:[no]}));
 assert.equal(r.gaps.length,0);
 assert.equal(r.maker.candidates.length,1);
 assert.equal(r.maker.candidates[0].quote.side,'no');
 assert.equal(r.tradeEligible,false);
});

test('quotes crossing the current book or far behind touch are not priceable as makers',()=>{
 const bad=[quote({id:'cross',priceUsd:.97}),quote({id:'behind',priceUsd:.90})];
 const r=analyzeAaaGasMarketGame(args({quoteCandidates:bad}));
 assert.equal(r.maker.action,'abstain');
 assert.equal(r.gaps.length,2);
 assert.ok(r.gaps.every(x=>/crosses the book/.test(x.reason)));
});

test('source evidence and fill calibration learned AFTER market time are not historical knowledge',()=>{
 const bad=[quote({id:'late-model',modelAvailableAt:'2026-10-12T21:00:00Z'}),
 quote({id:'late-fill',fillAvailableAt:'2026-10-12T21:00:00Z'})];
 const r=analyzeAaaGasMarketGame(args({quoteCandidates:bad}));
 assert.equal(r.gaps.length,2);
 assert.equal(r.maker.action,'abstain');
});

test('stale timestamps, changed settlement source or unknown fee schedule block the entire gas packet',()=>{
 const stale=markets();stale[0]={...stale[0],marketObservedAt:'2026-10-12T19:40:00Z'};
 const a=analyzeAaaGasMarketGame(args({event:event({markets:stale})}));
 assert.equal(a.status,'unqualified-exchange-snapshot');
 const sources=markets();sources[1]={...sources[1],rules_primary:'Resolves on proprietary retail survey without AAA.'};
 const b=analyzeAaaGasMarketGame(args({event:event({markets:sources})}));
 assert.equal(b.status,'unqualified-exchange-snapshot');
 const c=analyzeAaaGasMarketGame(args({series:{...series,fee_type:'unpublished'}}));
 assert.equal(c.status,'unbound-series-fee-schedule');
 const d=analyzeAaaGasMarketGame(args({event:event({series_ticker:'KXWTI'})}));
 assert.equal(d.status,'unsupported-or-unbound-gas-event');
});

test('once a market has closed, final AAA publication cannot be traded as pre-close information',()=>{
 const old=markets();old[0]={...old[0],close_time:'2026-10-12T19:00:00Z'};
 const r=analyzeAaaGasMarketGame(args({event:event({markets:old})}));
 assert.equal(r.status,'unqualified-exchange-snapshot');
});

test('national and state AAA events are deliberately analyzed as separate outcome spaces',()=>{
 const st='KXAAAGASDME';
 const local=event({series_ticker:st,event_ticker:st+'-26OCT13',
   markets:markets().map((m,i)=>({
     ...m,ticker:st+'-26OCT13-'+(4+i*.005).toFixed(4),
     rules_primary:m.rules_primary.replace('United States','Maine'),
   })),
 });
 const r=analyzeAaaGasMarketGame({event:local,series:{...series,ticker:st},at});
 assert.equal(r.status,'read-only-research');
 assert.equal(r.seriesTicker,st);
 assert.equal(r.coherence.length,1);
});

test('bounded candidate count and issuance clock are required',()=>{
 assert.throws(()=>analyzeAaaGasMarketGame(args({at:'bad'})),TypeError);
 assert.throws(()=>analyzeAaaGasMarketGame(args({maxBookAgeMs:0})),TypeError);
 assert.throws(()=>analyzeAaaGasMarketGame(args({quoteCandidates:Array(513).fill(quote())})),TypeError);
});


const sharedForecast=(extra={})=>({
 id:'shared-market-game-scored-forecast-1',
 observedAt:'2026-10-12T18:30:00Z',
 horizon:'2026-10-13T15:00:00Z',
 eventTicker:event().event_ticker,targetSource:'AAA',
 outcomeValueKey:'aaaNationalRegularGasDollars',
 evidenceIds:['source-AAA','trained-past-station-days'],
 scenarios:[
  {id:'below-all',probability:.1,values:{aaaNationalRegularGasDollars:3.995},heldPnlCentsByVenue:{kalshi:0}},
  {id:'first',probability:.4,values:{aaaNationalRegularGasDollars:4.002},heldPnlCentsByVenue:{kalshi:0}},
  {id:'second',probability:.4,values:{aaaNationalRegularGasDollars:4.007},heldPnlCentsByVenue:{kalshi:0}},
  {id:'third',probability:.1,values:{aaaNationalRegularGasDollars:4.013},heldPnlCentsByVenue:{kalshi:0}},
 ],
 ...extra,
});

test('existing shared weighted scenarios produce a monotone AAA threshold distribution',()=>{
 const r=projectAaaGasScenarioLadder({event:event(),forecast:sharedForecast(),at});
 assert.equal(r.status,'scenario-pushforward-ungraded');
 assert.deepEqual(r.marketProbabilities.map(x=>x.probabilityYes),[.9,.5,.1]);
 assert.equal(r.marketProbabilities.length,3);
 assert.equal(r.nestedPairs.length,6);
 assert.equal(r.tradeEligible,false);
});

test('nested rung pair covariance is exact, rather than treating gas outcomes as independent',()=>{
 const r=projectAaaGasScenarioLadder({event:event(),forecast:sharedForecast(),at});
 const a=r.nestedPairs.find(x=>x.first.includes('4.0000')&&x.second.includes('4.0100'));
 assert.ok(a);
 assert.ok(Math.abs(a.jointYesProbability-.1)<1e-12);
 assert.ok(Math.abs(a.yesCovariance-(.1-.9*.1))<1e-12);
 const d=r.nestedPairs.find(x=>x.first===x.second&&x.first.includes('4.0050'));
 assert.ok(Math.abs(d.yesCovariance-.25)<1e-12);
});

test('permutation of a shared scenario list leaves CDF and covariance unchanged',()=>{
 const s=sharedForecast(),t=sharedForecast({scenarios:s.scenarios.slice().reverse()});
 const a=projectAaaGasScenarioLadder({event:event(),forecast:s,at});
 const b=projectAaaGasScenarioLadder({event:event(),forecast:t,at});
 assert.deepEqual(a.marketProbabilities,b.marketProbabilities);
 assert.deepEqual(a.nestedPairs,b.nestedPairs);
});

test('event research projects scenarios without converting them into trade-eligible maker probabilities',()=>{
 const r=analyzeAaaGasMarketGame(args({scenarioForecast:sharedForecast()}));
 assert.equal(r.status,'read-only-research');
 assert.ok(r.scenarioProjection);
 assert.deepEqual(r.scenarioProjection.marketProbabilities.map(x=>x.probabilityYes),[.9,.5,.1]);
 assert.equal(r.maker.action,'abstain');
 assert.equal(r.tradeEligible,false);
});

test('scope, source, target date and issued-after-decision future evidence cannot project',()=>{
 const broken=[
  {targetSource:'OPIS'},{eventTicker:'KXAAAGASD-26OCT14'},
  {availableAt:'2026-10-12T21:00:00Z'},{observedAt:'2026-10-12T21:00:00Z'},
  {horizon:'2026-10-12T18:00:00Z'}, {evidenceIds:[]},
 ];
 for(const mismatch of broken){
  const r=analyzeAaaGasMarketGame(args({scenarioForecast:sharedForecast(mismatch)}));
  assert.equal(r.scenarioProjection,null,JSON.stringify(mismatch));
  assert.equal(r.gaps.length,1,JSON.stringify(mismatch));
  assert.equal(r.maker.action,'abstain');
 }
});

test('scenario normalization and source prices reject zero data, duplicates and invalid weights',()=>{
 const s=sharedForecast();
 const bad=[
  {scenarios:s.scenarios.slice(0,3)},
  {scenarios:[{...s.scenarios[0],probability:0.9},...s.scenarios.slice(1)]},
  {scenarios:[s.scenarios[0],{...s.scenarios[1],id:'below-all'},...s.scenarios.slice(2)]},
  {scenarios:[{...s.scenarios[0],values:{}},...s.scenarios.slice(1)]},
 ];
 for(const patch of bad){
  assert.throws(()=>projectAaaGasScenarioLadder({event:event(),forecast:sharedForecast(patch),at}));
 }
});

test('shared-scenario projection never joins national and state AAA events',()=>{
 const stateTicker='KXAAAGASDME';
 const stateEvent=event({series_ticker:stateTicker,
  event_ticker:stateTicker+'-26OCT13',
  markets:markets().map(m=>({...m,ticker:m.ticker.replace(ticker,stateTicker),
    rules_primary:m.rules_primary.replace('United States','Maine')})),
 });
 assert.throws(()=>projectAaaGasScenarioLadder({event:stateEvent,forecast:sharedForecast(),at}),TypeError);
 const scoped=projectAaaGasScenarioLadder({event:stateEvent,forecast:sharedForecast({
   eventTicker:stateEvent.event_ticker,
 }),at});
 assert.equal(scoped.eventTicker,stateEvent.event_ticker);
 assert.equal(scoped.tradeEligible,false);
});
