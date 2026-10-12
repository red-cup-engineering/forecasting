/**
 * Re-evaluate the EXISTING gas-maker microstructure grid (not a new collector)
 * through the shared outcome-conditioned fill game.
 *
 * The archival grid contains 10-minute *hypothetical placement* aggregates,
 * grouped by quote price, queue, horizon, and eventual YES/NO settlement.
 * Its source file has NO event-day identity or actual order/fill receipts.
 * Treat each displayed row as an aggregate, not an independent observation.
 *
 * The result is strictly RETROSPECTIVE DESCRIPTIVE ECONOMIC MEASUREMENT.
 * Never use the derived P(fill | win/lose) as a prospective admitted model:
 * no day-clustered calibration, exchange fill priority validation, fee regime,
 * or before-event availableAt evidence is present.
 */
import {binaryMakerOutcomeConditionedBounds}
  from '@red-cup-engineering/mandate-portfolio-allocation-service/binary-maker-game';

const REQUIRED='p,Q,H,hb,tb,eb,yes,filled,clean,n';
const num=x=>typeof x==='number'&&Number.isFinite(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const band=x=>({low:x,high:x});
function parse(text) {
 if(typeof text!=='string'||text.length>16_000_000)
  throw new TypeError('bounded retained CSV source is required');
 const lines=text.trim().split(/\r?\n/u);
 if(lines.shift()?.trim()!==REQUIRED)throw new TypeError('exact archived gas fill-grid columns required');
 if(lines.length>250000)throw new RangeError('too many retained gas grid rows');
 return lines.map((line,i)=>{
  const v=line.split(',').map(Number);
  if(v.length!==10||v.some(x=>!integer(x))||
     ![0,1].includes(v[6])||v[7]>v[9]||v[8]>v[7]||
     ![94,95,96,97,98].includes(v[0])||!v[9])
   throw new TypeError('invalid source-counts or dimensions on gas grid line '+(i+2));
  return {priceCents:v[0],queueAhead:v[1],horizonMinutes:v[2],
   hoursToCloseBin:v[3],timeBin:v[4],spreadBin:v[5],yesWon:v[6]===1,
   filled:v[7],clean:v[8],placements:v[9]};
 });
}
function group() {
 return {win:{placements:0,filled:0,clean:0},lose:{placements:0,filled:0,clean:0}};
}
const tally=(g,r)=>{
 const z=r.yesWon?g.win:g.lose;
 z.placements+=r.placements;z.filled+=r.filled;z.clean+=r.clean;
};
const pnl=(winFill,loseFill,total,price,fee)=>
  (winFill-(price+fee)*(winFill+loseFill))/total;

/**
 * @param {{csv:string,sourceId:string,queueAhead?:number,
 *  horizonMinutes?:number, makerFeeUsdPerFill?:number}} options
 * Explicit one-contract upper-bound gross comparison; the default maker
 * fee of zero is an OPTIMISTIC no-fee historical baseline, not a Kalshi
 * fee assertion. All results are descriptive with no confidence interval.
 */
export function replayAaaGasFillSelection({
 csv,sourceId,queueAhead=0,horizonMinutes=240,
 makerFeeUsdPerFill=0,
}={}){
 if(typeof sourceId!=='string'||!sourceId||
    !integer(queueAhead)||!integer(horizonMinutes)||horizonMinutes<1||
    !num(makerFeeUsdPerFill)||makerFeeUsdPerFill<0)
  throw new TypeError('archived source identity, queue and nonnegative fee required');
 const rows=parse(csv),selection=rows.filter(r=>r.queueAhead===queueAhead&&
   r.horizonMinutes===horizonMinutes);
 if(!selection.length)throw new RangeError('no comparable retained grid rows for requested quote regime');
 const map=new Map();
 for(const r of selection){if(!map.has(r.priceCents))map.set(r.priceCents,group());tally(map.get(r.priceCents),r);}
 const prices=[...map].sort(([a],[b])=>a-b).map(([priceCents,c])=>{
  const nWin=c.win.placements,nLose=c.lose.placements,n=nWin+nLose;
  // An outcome class absent from this archive cannot establish a
  // conditional rate. Withhold rather than divide by zero and assert 0%.
  if(nWin===0||nLose===0)return {priceCents,status:'missing-settlement-class',
   winPlacements:nWin,losePlacements:nLose,tradeEligible:false};
  const p=nWin/n,fillWin=c.win.filled/nWin,fillLoss=c.lose.filled/nLose;
  const priceUsd=priceCents/100;
  const bound=binaryMakerOutcomeConditionedBounds({
   side:'yes',priceUsd,makerFeeUsdPerFill,
   probabilityYes:band(p),
   probabilityFillGivenWin:band(fillWin),
   probabilityFillGivenLoss:band(fillLoss),
  });
  const historical=pnl(c.win.filled,c.lose.filled,n,priceUsd,makerFeeUsdPerFill);
  const modelEv=bound.conditionalPnlUsdPerPlacement.low;
  if(Math.abs(historical-modelEv)>1e-10)
   throw new Error('shared joint-fill model and archived cash accounting disagree');
  const filled=c.win.filled+c.lose.filled;
  const independent=(p-priceUsd-makerFeeUsdPerFill)*filled/n;
  const cleanPnl=pnl(c.win.clean,c.lose.clean,n,priceUsd,makerFeeUsdPerFill);
  const sweepWin=c.win.filled-c.win.clean,sweepLose=c.lose.filled-c.lose.clean;
  const sweptPnl=pnl(sweepWin,sweepLose,n,priceUsd,makerFeeUsdPerFill);
  if(Math.abs(cleanPnl+sweptPnl-historical)>1e-10)
   throw new Error('clean/sweep fill partition does not reconcile');
  return {
   priceCents,status:'retrospective-bucket-only',
   placements:n,winningPlacements:nWin,losingPlacements:nLose,
   simulatedFills:filled,simulatedCleanFills:c.win.clean+c.lose.clean,
   simulatedSweepFills:sweepWin+sweepLose,
   empiricalBaseWinFraction:p,
   fillGivenWinningSettlement:fillWin,fillGivenLosingSettlement:fillLoss,
   simulatedGrossUsdPerPlacement:historical,
   independenceCounterfactualUsdPerPlacement:independent,
   selectionEffectUsdPerPlacement:historical-independent,
   cleanFillGrossUsdPerPlacement:cleanPnl,
   sweepFillGrossUsdPerPlacement:sweptPnl,
   conditionalModelWitness:bound,
   sourceQualification:'retrospective correlated hypothetical queue replay; not day-clustered or calibrated',
   tradeEligible:false,
  };
 });
 return {
  kind:'aaa-gas-retrospective-outcome-fill-game-v1',
  sourceId,queueAhead,horizonMinutes,makerFeeUsdPerFill,
  receivedRows:rows.length,selectedRows:selection.length,
  prices,
  statement:'one-market binary YES maker held through settlement, with row-bucket fill replay',
  uncertainty:'no independent event/day IDs, no independent validation, no current queue or source rights; raw fractions have NO prospective confidence interval',
  economicConclusions:'optimistic historical no-fee results unless makerFeeUsdPerFill is independently supplied for these markets',
  candidateModelAdmitted:false,tradeEligible:false,orderEffect:false,
 };
}
