import {THETA, MAKER_THETA, orderFee} from './fees.mjs';
import {binaryMakerPlacementBounds,binaryPostedLossBounds} from '@red-cup-engineering/mandate-portfolio-allocation-service/binary-maker-game';

const pips=x=>{const n=Math.round(x*10000);if(!Number.isSafeInteger(n)||Math.abs(x*10000-n)>1e-6)throw new RangeError('centicent monetary input required');return n;};
/** Bind observed venue terms; the current fee provider owns the law. */
export function participationFeeTerms(series){
 if(!['quadratic','quadratic_with_maker_fees','quadratic_with_combo_maker_fees'].includes(series?.fee_type))throw new TypeError('observed supported fee type required');
 const multiplier=Number(series.fee_multiplier);
 if(!Number.isFinite(multiplier)||multiplier<0)throw new TypeError('observed nonnegative fee multiplier required');
 return {taker:THETA*multiplier,maker:/maker/u.test(series.fee_type)?MAKER_THETA*multiplier:0};
}
/** Upper reserve against hundredth execution fragments. Normalize the observed
 * coefficient through the current fee provider, without reimplementing its
 * accumulator or rounding. This does not claim the fee actually charged. */
export function fragmentedWeatherFeeReserve(theta,count,prices){
 const atoms=Math.round(count*100);
 if(!Number.isFinite(theta)||theta<0||!Number.isSafeInteger(atoms)||atoms<0||atoms>1000000||Math.abs(count*100-atoms)>1e-6||!Array.isArray(prices)||!prices.length)throw new RangeError('observed coefficient, hundredth quantity and prices required');
 const feePerAtom=prices.map(price=>orderFee(.01,price,{multiplier:theta/THETA}));
 return atoms*Math.max(...feePerAtom);
}
/** Project the shared joint W/F science without inventing fill calibration. */
export function weatherFillSelectionBounds({winProbabilityLow,winProbabilityHigh,fillProbabilityLow=0,fillProbabilityHigh=1,costPerContractUsd,priceUsd,makerFeeUsdPerFill}){
 if(!Number.isFinite(costPerContractUsd)||Math.abs(priceUsd+makerFeeUsdPerFill-costPerContractUsd)>1e-8)throw new RangeError('consistent observed price and fee reserve required');
 const r=binaryMakerPlacementBounds({side:'yes',priceUsd,makerFeeUsdPerFill,probabilityYes:{low:winProbabilityLow,high:winProbabilityHigh},probabilityFill:{low:fillProbabilityLow,high:fillProbabilityHigh}});
 return {marginalWinProbability:r.probabilityWin,assumedFullFillProbability:r.probabilityFill,costPerContractUsd,
  conditionalWinProbabilityLow:r.conditionalWinProbabilityGivenFill.low,conditionalWinProbabilityHigh:r.conditionalWinProbabilityGivenFill.high,
  expectedNetPerPostedContractLowUsd:r.conditionalPnlUsdPerPlacement.low,expectedNetPerPostedContractHighUsd:r.conditionalPnlUsdPerPlacement.high,
  conditionalNetPerFilledContractLowUsd:r.conditionalWinProbabilityGivenFill.low===null?null:r.conditionalWinProbabilityGivenFill.low-costPerContractUsd,conditionalNetPerFilledContractHighUsd:r.conditionalWinProbabilityGivenFill.high===null?null:r.conditionalWinProbabilityGivenFill.high-costPerContractUsd,
  method:'shared binary-maker Fréchet operator; no independence assumption',scope:'supplied marginal intervals and full-fill/no-fill scenario; partial fills and calibration unidentified',actualFillProbability:null,actualConditionalWinProbability:null,tradeAuthority:false};
}

/** Weather action identities and captured fee reserves bind the shared posted
 * loss calculus. Marginal win bounds remain distinct from conditional-on-fill
 * probabilities; no copula, fill calibration or executable authority is added. */
export function weatherPostedLossBounds(cases,{tailFraction}={}){
 if(!Array.isArray(cases)||cases.length>4000)throw new TypeError('bounded captured weather cases required');
 const r=binaryPostedLossBounds(cases.map(c=>{
  if(!c||!Number.isInteger(c.quantity)||c.quantity<1||c.quantity>10000)throw new TypeError('whole captured weather quantity required');
  pips(c.capitalRequiredUsd);
  return {id:c.actionId,...(c.ticker!==undefined||c.side!==undefined?{instrument:c.ticker,side:c.side}:{}),quantity:c.quantity,capitalRequiredUsd:c.capitalRequiredUsd,probabilityWinLower:c.marginalWinProbabilityLow};
 }),{tailFraction});
 return {tailFraction:r.tailFraction,maximumGrossLossUsd:r.maximumGrossLossUsd,expectedGrossLossUpperUsd:r.expectedGrossLossUpperUsd,grossExpectedShortfallUpperUsd:r.grossExpectedShortfallUpperUsd,
  contributions:r.contributions.map(c=>({actionId:c.id,...(c.instrument!==undefined?{ticker:c.instrument,side:c.side}:{}),quantity:c.quantity,capitalRequiredUsd:c.capitalRequiredUsd,assumedMarginalWinProbabilityLow:c.probabilityWinLower,lossProbabilityUpper:c.lossProbabilityUpper,expectedGrossLossUpperUsd:c.expectedGrossLossUpperUsd,grossExpectedShortfallUpperUsd:c.grossExpectedShortfallUpperUsd})),
  method:r.method,sharpness:r.sharpness,scope:'captured posted weather loss envelopes under supplied marginal lower bounds; winning profits and collateral-return credit excluded',
  marginalProbabilitiesCalibrated:false,actualFillProbability:null,actualNetLossDistribution:null,tradeAuthority:false};
}

/** Greedy research proposal under explicit, unvalidated conditional probability
 * and usable-cash-time bounds. Rank by conservative net per dollar-hour after an
 * explicit holding hurdle, reserve priority cash first, and consume cash once.
 * Optional gross-loss ES caps use the shared arbitrary-dependence envelope.
 * Actual fill law and settlement-time distributions are open. */
export function weatherCarryAllocation(snapshot,policy,{now}={}){
 if(!Number.isFinite(now)||!Array.isArray(snapshot?.rows)||!policy||!Array.isArray(policy.cases)||!policy.cases.length||policy.cases.length>2*snapshot.rows.length)throw new TypeError('captured actions and bounded conditional cases required');
 const availablePips=pips(snapshot.availableCapitalUsd),priorityPips=pips(policy.priorityReserveUsd??0),hourlyRate=policy.hourlyCashHurdle??0,minWin=policy.minimumWinSurplusUsd??0;
 if(availablePips<0||priorityPips<0||priorityPips>availablePips||!Number.isFinite(hourlyRate)||hourlyRate<0||!Number.isFinite(minWin)||minWin<0)throw new RangeError('finite captured and priority cash, holding hurdle and win surplus required');
 const budgetPips=availablePips-priorityPips,lossPips=policy.maxLossBudgetUsd===undefined?budgetPips:pips(policy.maxLossBudgetUsd);if(lossPips<0)throw new RangeError('nonnegative worst loss budget required');
 const tailPolicy=policy.postedLossPolicy;
 if(tailPolicy!==undefined&&(!tailPolicy||!Number.isFinite(tailPolicy.tailFraction)||tailPolicy.tailFraction<=0||tailPolicy.tailFraction>1||!Number.isFinite(tailPolicy.maxGrossExpectedShortfallUsd)||tailPolicy.maxGrossExpectedShortfallUsd<0))throw new RangeError('posted loss policy requires worst-tail mass and nonnegative gross ES budget');
 const actions=new Map();for(const row of snapshot.rows)for(const action of row.actions.alternatives){if(actions.has(action.id))throw new TypeError('ambiguous captured action');actions.set(action.id,{row,action});}
 const seen=new Set(),evaluations=policy.cases.map(c=>{
  if(!c||typeof c.actionId!=='string'||seen.has(c.actionId))throw new TypeError('distinct conditional action cases required');seen.add(c.actionId);
  const bound=actions.get(c.actionId);if(!bound||bound.action.action!=='rest')throw new TypeError('captured resting action required');const {row,action}=bound;
  if(row.market?.market_type!=='binary'||Number(row.market.notional_value_dollars)!==1)throw new TypeError('observed one-dollar binary face value required');
  if(Date.parse(row.actions.observedAt)>now||!Number.isFinite(Date.parse(row.actions.expiresAt))||Date.parse(row.actions.expiresAt)<=now)throw new TypeError('fresh causal quote required');
  const low=c.winProbabilityLow,high=c.winProbabilityHigh,early=Date.parse(c.usableCashAtEarliest),late=Date.parse(c.usableCashAtLatest);
  if(![low,high].every(Number.isFinite)||low<0||high>1||low>high||!Number.isFinite(early)||!Number.isFinite(late)||early<now||late<early||late<=now)throw new TypeError('explicit conditional probability and future usable-cash interval required');
  const costPips=pips(action.capitalRequiredUsd),cost=costPips/10000,n=action.quantity;if(cost<=0||!Number.isInteger(n)||n<1||n>10000)throw new TypeError('captured finite cost and whole quantity required');
  const earlyHours=(early-now)/3600000,lateHours=(late-now)/3600000,lowerNet=n*low-cost,upperNet=n*high-cost,lowerAfter=lowerNet-cost*hourlyRate*lateHours,upperAfter=upperNet-cost*hourlyRate*earlyHours,winSurplus=n-cost;
  const postedLoss=tailPolicy===undefined?null:weatherPostedLossBounds([{actionId:c.actionId,ticker:row.ticker,side:action.side,quantity:n,capitalRequiredUsd:cost,marginalWinProbabilityLow:c.marginalWinProbabilityLow}],tailPolicy).contributions[0];
  return {actionId:c.actionId,ticker:row.ticker,side:action.side,quantity:n,price:action.price,pips:action.pips,costPips,capitalRequiredUsd:cost,winSurplusUsd:winSurplus,worstLossUsd:cost,breakEvenConditionalWinProbability:cost/n,breakEvenWithHoldingHurdle:(cost+cost*hourlyRate*lateHours)/n,conditionalNetLowUsd:lowerNet,conditionalNetHighUsd:upperNet,conditionalNetAfterHurdleLowUsd:lowerAfter,conditionalNetAfterHurdleHighUsd:upperAfter,heldHoursLow:earlyHours,heldHoursHigh:lateHours,lowerNetPerDollarHour:lowerAfter/(cost*lateHours),qualifiesUnderAssumptions:lowerAfter>0&&winSurplus>=minWin,assumptions:{...c,status:'unvalidated conditional-on-full-fill scenario; usable cash time is assumed, not certified by close time'},fillProbability:null,tradeAuthority:false,...(postedLoss?{postedLoss}:{})};
 });
 if(tailPolicy)weatherPostedLossBounds(evaluations.map(e=>({actionId:e.actionId,ticker:e.ticker,side:e.side,quantity:e.quantity,capitalRequiredUsd:e.capitalRequiredUsd,marginalWinProbabilityLow:e.postedLoss.assumedMarginalWinProbabilityLow})),tailPolicy);
 const candidates=evaluations.filter(e=>e.qualifiesUnderAssumptions).sort((a,b)=>b.lowerNetPerDollarHour-a.lowerNetPerDollarHour||a.actionId.localeCompare(b.actionId)),selected=[],skipped=[],sides=new Map();let spentPips=0,postedTailLossUsd=0;
 for(const e of candidates){const prices=sides.get(e.ticker)??new Map(),other=prices.get(e.side==='yes'?'no':'yes');let reason=null;
  if(prices.has(e.side))reason='same-side alternative already selected';else if(other!==undefined&&other+e.pips>=10000)reason='mutually crossing resting quotes';else if(spentPips+e.costPips>budgetPips)reason='priority cash or remaining cash';else if(spentPips+e.costPips>lossPips)reason='worst-loss budget';else if(tailPolicy&&postedTailLossUsd+e.postedLoss.grossExpectedShortfallUpperUsd>tailPolicy.maxGrossExpectedShortfallUsd)reason='posted gross expected-shortfall budget';
  if(reason){skipped.push({actionId:e.actionId,reason});continue;}prices.set(e.side,e.pips);sides.set(e.ticker,prices);spentPips+=e.costPips;if(tailPolicy)postedTailLossUsd+=e.postedLoss.grossExpectedShortfallUpperUsd;selected.push(e);
 }
 const postedLoss=tailPolicy===undefined?null:weatherPostedLossBounds(selected.map(e=>({actionId:e.actionId,ticker:e.ticker,side:e.side,quantity:e.quantity,capitalRequiredUsd:e.capitalRequiredUsd,marginalWinProbabilityLow:e.postedLoss.assumedMarginalWinProbabilityLow})),tailPolicy);
 return {...(postedLoss?{postedLoss:{...postedLoss,maxGrossExpectedShortfallUsd:tailPolicy.maxGrossExpectedShortfallUsd}}:{}),kind:'weather-carry-allocation-v1',at:new Date(now).toISOString(),priorityReserveUsd:priorityPips/10000,carryBudgetUsd:budgetPips/10000,carryReserveUsd:spentPips/10000,remainingCarryCashUsd:(budgetPips-spentPips)/10000,worstLossUsd:spentPips/10000,conditionalNetAfterHurdleLowUsd:selected.reduce((s,e)=>s+e.conditionalNetAfterHurdleLowUsd,0),selectedActionIds:selected.map(e=>e.actionId),evaluations,skipped,method:'greedy lower conditional net per dollar-hour; optimality unproven',selectionIsOptimal:false,fillProbability:null,scope:'full-fill expected-value and capital-use scenarios under supplied assumptions; no calibrated conditional probability, guaranteed payout or usable-cash deadline',orderEffect:false,tradeAuthority:false};
}
