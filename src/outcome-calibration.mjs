/** Counts-based payout calibration. Raw source counts define an informative
 * empirical prior's point; separately qualified effective units represent
 * correlation uncertainty. Current independent clusters update that prior. */
import {regularizedIncompleteBeta} from './temperature-distribution.mjs';
import {tailLossRate} from './temperature-tail-prediction.mjs';

export function binaryLossPosterior({losses=0,clusters=0,prior=null}={}) {
  if(!Number.isFinite(clusters)||clusters<0||!Number.isFinite(losses)||losses<0||losses>clusters)throw new TypeError('valid effective outcome counts required');
  let alpha=1,beta=1,priorMean=.5,priorStrength=2;
  if(prior){
    if(!Number.isFinite(prior.losses)||prior.losses<0||!Number.isFinite(prior.trials)||prior.trials<prior.losses||!Number.isFinite(prior.effectiveTrials)||prior.effectiveTrials<=0||prior.effectiveTrials>prior.trials)throw new TypeError('qualified raw/effective prior counts required');
    priorMean=tailLossRate(0,'held',{held:{losses:prior.losses,clusters:prior.trials}});
    priorStrength=prior.effectiveTrials;alpha=priorMean*priorStrength;beta=(1-priorMean)*priorStrength;
  }
  alpha+=losses;beta+=clusters-losses;
  const total=alpha+beta,lossMean=alpha/total;
  const quantile=q=>{let lo=0,hi=1;for(let i=0;i<60;i++){const mid=(lo+hi)/2;if(regularizedIncompleteBeta(mid,alpha,beta)<q)lo=mid;else hi=mid;}return (lo+hi)/2;};
  return {type:'binary-loss-posterior',method:'scoped empirical count prior and clustered Beta likelihood',alpha,beta,lossMean,winMean:1-lossMean,lossLow95:quantile(.025),lossHigh95:quantile(.975),variance:alpha*beta/(total*total*(total+1)),effectiveClusters:clusters,effectiveLosses:losses,priorMean,priorStrength};
}

/** Positive fee-aware EV belief, independent of whether an order filled.
 * Confidence shrinks capital continuously; an interval endpoint is not an
 * additional positive-EV gate. */
export function positiveEdgeWeight(posterior,{riskCostCents,feePerContractCents}) {
  if(!posterior||!Number.isFinite(riskCostCents)||riskCostCents<=0||riskCostCents>=100||!Number.isFinite(feePerContractCents)||feePerContractCents<0)return null;
  const maxLoss=1-(riskCostCents+feePerContractCents)/100;
  const probability=regularizedIncompleteBeta(Math.min(1,Math.max(0,maxLoss)),posterior.alpha,posterior.beta);
  return {probability,weight:probability,expectedEdgeCents:100*posterior.winMean-riskCostCents-feePerContractCents};
}
