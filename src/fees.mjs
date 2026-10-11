/**
 * Kalshi's trading fee: the one definition every price, edge and sizing in this repository uses.
 *
 * A quadratic series charges the taker THETA x multiplier x C x P x (1 - P) dollars for C contracts at
 * price P (dollars). Makers pay nothing on plain 'quadratic' series and MAKER_THETA x multiplier x C x P x
 * (1 - P) on series whose fee_type carries maker fees ('quadratic_with_maker_fees',
 * 'quadratic_with_combo_maker_fees'). `multiplier` is the series' fee_multiplier (1 unless Kalshi says otherwise).
 *
 * Rounding (https://docs.kalshi.com/getting_started/fee_rounding): Kalshi keeps one fee accumulator per order
 * across all of its fills and settles it on the account's balance grid, rebating overpayment, so an order pays
 * its model fee summed over its fills, rounded UP to the grid once. The grid is $0.0001 for a direct member and
 * $0.01 for a member cleared through an FCM. The house account is a direct member: its balance_dollars carries
 * four decimals, and every one of its 16 fills on 2026-10-11 has fee_cost equal to its order's model fee rounded
 * up to $0.0001 (test/fees.test.mjs replays them). BALANCE_GRID_CENTS is therefore 0.01; pass gridCents: 1 to
 * price an FCM-cleared account.
 */
export const THETA = 0.07;
export const MAKER_THETA = 0.0175;
/** The house account's balance grid in cents: $0.0001, a direct member's. */
export const BALANCE_GRID_CENTS = 0.01;

const rateOf = ({ maker = false, feeType = 'quadratic' } = {}) => (maker ? (/maker/u.test(feeType ?? '') ? MAKER_THETA : 0) : THETA);

/** Unrounded fee per contract in dollars at price `p` dollars: the large-order limit. */
export const feePerContract = (p, { multiplier = 1, maker = false, feeType } = {}) => rateOf({ maker, feeType }) * multiplier * p * (1 - p);

// Fees are computed in integers of 1e-10 cents, so the plain rates and Kalshi's 0.01-contract counts are exact.
const SCALE = 1e10;
const hundredthsOf = (count) => {
  const hundredths = Math.round(count * 100);
  return Number.isFinite(count) && hundredths >= 1 && Math.abs(hundredths - count * 100) < 1e-6 ? hundredths : null;
};

/**
 * Fee in cents for ONE order filled as `fills` ({count, priceCents}: a count in contracts, to the hundredth, at a
 * whole-cent price), on the account's balance grid: the model fee summed over the fills, rounded up to the grid once.
 */
export function orderFeeCentsOfFills(fills, { multiplier = 1, maker = false, feeType, gridCents = BALANCE_GRID_CENTS } = {}) {
  if (!(gridCents > 0)) throw new RangeError(`gridCents must be positive: ${gridCents}`);
  const rate = rateOf({ maker, feeType });
  if (rate === 0) return 0;
  let scaled = 0;
  for (const { count, priceCents } of fills) {
    const hundredths = hundredthsOf(count);
    if (hundredths === null || !Number.isInteger(priceCents) || priceCents < 1 || priceCents > 99) continue;
    // cents = rate x mult x C x P x (100 - P) / 100 = rate x mult x hundredths x P x (100 - P) / 1e4.
    scaled += Math.round(rate * 1e6 * multiplier * hundredths * priceCents * (100 - priceCents));
  }
  if (scaled === 0) return 0;
  const grid = Math.round(gridCents * SCALE);
  return (Math.ceil(scaled / grid - 1e-9) * grid) / SCALE;
}

/** Fee in cents for ONE order of `count` contracts at `priceCents`, on the account's balance grid. */
export const orderFeeCents = (count, priceCents, options) => orderFeeCentsOfFills([{ count, priceCents }], options);

/** Fee in dollars for one order of `count` contracts at `price` dollars, on the account's balance grid. */
export const orderFee = (count, price, options) => orderFeeCents(count, Math.round(price * 100), options) / 100;

/** Fee per contract in dollars for one order of `count` at `price` dollars (the rounded order fee spread over the batch). */
export const orderFeePerContract = (count, price, options) => orderFee(count, price, options) / count;
