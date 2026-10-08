/**
 * Kalshi's trading fee: the one definition every price, edge and sizing in this repository uses.
 *
 * A quadratic series charges the taker THETA x multiplier x C x P x (1 - P) dollars for an order of C
 * contracts at price P (dollars), rounded UP to the cent once per order. Makers pay nothing on plain
 * 'quadratic' series and MAKER_THETA x multiplier x C x P x (1 - P) on series whose fee_type carries maker
 * fees ('quadratic_with_maker_fees', 'quadratic_with_combo_maker_fees'). `multiplier` is the series'
 * fee_multiplier (1 unless Kalshi says otherwise).
 */
export const THETA = 0.07;
export const MAKER_THETA = 0.0175;

const rateOf = ({ maker = false, feeType = 'quadratic' } = {}) => (maker ? (/maker/u.test(feeType ?? '') ? MAKER_THETA : 0) : THETA);

/** Unrounded fee per contract in dollars at price `p` dollars: the large-order limit. */
export const feePerContract = (p, { multiplier = 1, maker = false, feeType } = {}) => rateOf({ maker, feeType }) * multiplier * p * (1 - p);

/** Fee in whole cents for ONE order of `count` contracts at `priceCents`; exact in integers for the plain rates. */
export function orderFeeCents(count, priceCents, { multiplier = 1, maker = false, feeType } = {}) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(priceCents) || priceCents < 1 || priceCents > 99) return 0;
  const rate = rateOf({ maker, feeType });
  if (rate === 0) return 0;
  // cents = rate x mult x C x P x (100 - P) / 100; the numerator is scaled to an integer so 0.07 rounds exactly.
  return Math.ceil(Math.round(rate * 1e6 * multiplier * count * priceCents * (100 - priceCents)) / 1e8 - 1e-9);
}

/** Fee in dollars for one order of `count` contracts at `price` dollars, rounded up to the cent. */
export const orderFee = (count, price, options) => orderFeeCents(count, Math.round(price * 100), options) / 100;

/** Fee per contract in dollars for one order of `count` at `price` dollars (the rounded order fee spread over the batch). */
export const orderFeePerContract = (count, price, options) => orderFee(count, price, options) / count;
