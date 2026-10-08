import { jackknife } from '../forward-shadow.mjs';
import { orderFee, feePerContract } from '../fees.mjs';

/** Net P&L per contract of one entry: payoff - price - fee. The fee model is the hypothesis's own. */
export function netPerContract({ won, price, multiplier, fee }) {
  const perContract = fee.rounding === 'none'
    ? feePerContract(price, { multiplier }) * (fee.theta / 0.07)
    : orderFee(fee.count, price, { multiplier }) / fee.count * (fee.theta / 0.07);
  return (won ? 1 : 0) - price - perContract;
}

/** Delete-one-cluster jackknife of items [{g, x}]; a zero-variance sample gets t = +-Infinity by the sign of its mean. */
export function clusterStats(items) {
  const s = jackknife(items.map(({ g, x }) => ({ g, x })));
  if (s.se === 0 && s.mean !== 0) return { ...s, t: s.mean > 0 ? Infinity : -Infinity };
  return s;
}

/** Difference of two arms' means with independent jackknife SEs. */
export function armDifference(a, b) {
  const mean = a.mean - b.mean, se = Math.hypot(a.se, b.se);
  return { mean, se, t: se > 0 ? mean / se : (mean === 0 ? NaN : Math.sign(mean) * Infinity) };
}
