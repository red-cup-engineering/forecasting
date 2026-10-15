/** Recent-reading persistence for the published city index, with its parameters fitted from past outcomes only.
 *
 * Model. Let b(t) be the guidance proxy of the index at time t and y the index reading at the anchor
 * time t0. The innovation is e0 = y(t0) - b(t0). The forecast mean at target t is
 *   b(t) + a * exp(-(t-t0)/tau) * e0 + bias(localHour(t)),
 * the mean of a Gaussian AR(1)/Ornstein-Uhlenbeck error process observed with noise: the exponential is the
 * autocovariance of the forecast error, `a` is the Kalman gain at lag 0, and `bias` is a shrunken station
 * offset by time of day. A fixed a=1, tau=3 h (the earlier uncalibrated `recent-innovation-v1`) is one point
 * of this family. Fitting keeps the family and replaces the constants by measured ones.
 *
 * Fits use rows whose targets were settled before the fit time; nothing here reads a future outcome.
 */
const HOUR=3600000;
export const DECAY_HOURS=[.5,1,1.5,2,3,4,6,8,12];
export const GAIN_LIMITS=[0,1.2];
export const BIAS_PRIOR_ROWS=20;
export const innovationWeight=(lagMs,{gain,decayHours})=>gain*Math.exp(-lagMs/(decayHours*HOUR));
/** Row: {innovationF, lagMs, baseMeanF, truthF, localHour}. Returns {gain, decayHours, mse}. */
export function fitInnovation(rows,{decays=DECAY_HOURS}={}){
 if(!Array.isArray(rows)||rows.length<2)return null;
 let best=null;
 for(const decayHours of decays){
  let xy=0,xx=0;const xs=rows.map(r=>innovationWeight(r.lagMs,{gain:1,decayHours})*r.innovationF);
  rows.forEach((r,i)=>{xy+=xs[i]*(r.truthF-r.baseMeanF);xx+=xs[i]*xs[i];});
  const gain=xx>0?Math.min(GAIN_LIMITS[1],Math.max(GAIN_LIMITS[0],xy/xx)):0;
  const mse=rows.reduce((s,r,i)=>s+(r.truthF-r.baseMeanF-gain*xs[i])**2,0)/rows.length;
  if(!best||mse<best.mse-1e-12)best={gain,decayHours,mse};
 }
 return best;
}
/** Shrunken mean residual by local hour, after the innovation term. */
export function fitHourlyBias(rows,fit,{priorRows=BIAS_PRIOR_ROWS}={}){
 const sum=new Array(24).fill(0),n=new Array(24).fill(0);
 for(const r of rows){const e=r.truthF-r.baseMeanF-innovationWeight(r.lagMs,fit)*r.innovationF;sum[r.localHour]+=e;n[r.localHour]++;}
 return sum.map((s,h)=>n[h]?s/(n[h]+priorRows):0);
}
export const innovationMean=(row,fit,bias)=>row.baseMeanF+innovationWeight(row.lagMs,fit)*row.innovationF+(bias?bias[row.localHour]:0);
/** Spread multiplier per lead-time bucket that minimizes the training CRPS of a Student-t(5) forecast. */
export function fitSpread(rows,crps,{grid=[.5,.6,.7,.8,.9,1,1.15,1.3,1.5,1.75,2,2.5]}={}){
 let best=null;
 for(const multiplier of grid){
  const loss=rows.reduce((s,r)=>s+crps(r.meanF,r.scaleF*multiplier,r.truthF),0)/rows.length;
  if(!best||loss<best.loss-1e-12)best={multiplier,loss};
 }
 return best;
}
