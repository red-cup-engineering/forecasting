import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAaaGasMarketGame} from '../src/aaa-gas-market-game.mjs';

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
