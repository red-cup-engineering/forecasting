import test from 'node:test';
import assert from 'node:assert/strict';
import {replayFuelMakerFillSelection} from '../src/fuel-maker-fill-retrospective.mjs';

const head='p,Q,H,hb,tb,eb,yes,filled,clean,n';
const rows=[
 '95,0,240,0,0,5,1,6,4,60',
 '95,0,240,0,0,5,0,20,1,40',
 '96,0,240,0,0,5,1,12,9,60',
 '96,0,240,0,0,5,0,10,0,40',
 '95,1,240,0,0,5,1,7,1,60',
 '95,0,20,0,0,5,0,0,0,40',
];
const data=()=>head+'\n'+rows.join('\n')+'\n';
const study=(opts={})=>replayFuelMakerFillSelection({
 csv:data(),sourceId:'archive:gas-grid-immutable',...opts,
});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,a+' != '+b);

test('outcome-conditioned tape measures the risk of losers selecting our order',()=>{
 const r=study(),p=r.prices.find(x=>x.priceCents===95);
 assert.equal(r.receivedRows,6);
 assert.equal(r.selectedRows,4);
 assert.equal(p.placements,100);
 near(p.empiricalBaseWinFraction,.6);
 near(p.fillGivenWinningSettlement,.1);
 near(p.fillGivenLosingSettlement,.5);
 near(p.simulatedGrossUsdPerPlacement,(6-.95*(6+20))/100);
 assert.ok(p.selectionEffectUsdPerPlacement<0);
 assert.equal(p.candidateModelAdmitted,undefined);
 assert.equal(r.candidateModelAdmitted,false);
 assert.equal(r.pooledSourceFamilies,true);
 assert.deepEqual(r.sourceFamilies,['AAA-gasoline','diesel']);
 assert.equal(r.tradeEligible,false);
});

test('clean and sweep outcome strata reconcile exactly to the same gross cash',()=>{
 const r=study();
 for(const p of r.prices){
  near(p.cleanFillGrossUsdPerPlacement+p.sweepFillGrossUsdPerPlacement,
   p.simulatedGrossUsdPerPlacement);
  assert.equal(p.simulatedCleanFills+p.simulatedSweepFills,p.simulatedFills);
 }
});

test('money per ATTEMPT is not money per filled contract',()=>{
 const p=study().prices[0];
 const pnlPerFilled=(6-.95*26)/26;
 assert.ok(Math.abs(p.simulatedGrossUsdPerPlacement-pnlPerFilled)>1e-9);
 assert.equal(p.placements,100);
 assert.equal(p.simulatedFills,26);
});

test('a separately supplied fee lowers historical gross without fabricating actual fee terms',()=>{
 const base=study(),costly=study({makerFeeUsdPerFill:.003});
 for(let i=0;i<base.prices.length;i++){
  const a=base.prices[i],b=costly.prices[i];
  near(a.simulatedGrossUsdPerPlacement-b.simulatedGrossUsdPerPlacement,
   .003*a.simulatedFills/a.placements);
 }
 assert.equal(base.makerFeeUsdPerFill,0);
});

test('missing losing-outcome comparison cannot be admitted as a zero-risk strategy',()=>{
 const csv=head+'\n'+'95,0,240,0,0,5,1,2,1,10\n';
 const p=replayFuelMakerFillSelection({csv,sourceId:'fixture'}).prices[0];
 assert.equal(p.status,'missing-settlement-class');
 assert.equal(p.tradeEligible,false);
});

test('queue-ahead or horizon scope cannot be mixed with requested source bucket',()=>{
 const a=study({queueAhead:1});
 assert.equal(a.selectedRows,1);
 assert.equal(a.prices.length,1);
 assert.equal(a.prices[0].status,'missing-settlement-class');
 const b=study({horizonMinutes:20});
 assert.equal(b.selectedRows,1);
 assert.throws(()=>study({queueAhead:5000}),RangeError);
});

test('duplicates are frequency counts, not invented row-level independent trials',()=>{
 const r=study();
 assert.equal(r.prices[0].placements,100);
 assert.match(r.uncertainty,/NO prospective confidence interval/);
 assert.match(r.sourceQualification??r.prices[0].sourceQualification,/correlated hypothetical/);
});

test('source-integrity validation rejects malformed CSV and impossible fill accounting',()=>{
 assert.throws(()=>study({csv:'wrong\n95,0,240,0,0,5,1,6,4,60'}),TypeError);
 assert.throws(()=>study({csv:head+'\n95,0,240,0,0,5,1,11,2,10'}),TypeError);
 assert.throws(()=>study({csv:head+'\n95,0,240,0,0,5,1,7,8,10'}),TypeError);
 assert.throws(()=>study({csv:head+'\n95,0,240,0,0,5,3,0,0,10'}),TypeError);
 assert.throws(()=>study({sourceId:''}),TypeError);
});
