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
  return Number.isFinite(count) && Number.isSafeInteger(hundredths)
    && hundredths >= 1 && Math.abs(hundredths - count * 100) < 1e-6 ? hundredths : null;
};

// Kalshi quotes dollars on a 0.0001 grid. Converting a quote to whole cents before
// evaluating the fee can turn a real positive fee into zero near 0 or 1.
const quoteUnits = ({ priceCents, priceTenThousandths }) => {
  const cent = priceCents !== undefined;
  const tenThousandth = priceTenThousandths !== undefined;
  if (cent === tenThousandth) throw new RangeError('provide exactly one quote unit');
  if (cent) {
    if (!Number.isSafeInteger(priceCents) || priceCents < 1 || priceCents > 99)
      throw new RangeError('priceCents must be a whole cent in 1..99');
    return priceCents * 100;
  }
  if (!Number.isSafeInteger(priceTenThousandths)
    || priceTenThousandths < 1 || priceTenThousandths > 9999)
    throw new RangeError('priceTenThousandths must be an integer in 1..9999');
  return priceTenThousandths;
};

const fourDecimalQuote = (price) => {
  // Do not silently round unsupported extra precision into a different trade.
  const n = Number(price), raw = n * 10000, units = Math.round(raw);
  if (!Number.isFinite(n) || !Number.isSafeInteger(units)
    || units < 1 || units > 9999 || Math.abs(raw - units) > 1e-7)
    throw new RangeError('fee quote must use the venue four-decimal dollar grid (0.0001..0.9999)');
  return units;
};

/**
 * Fee in cents for ONE order filled as `fills`: each count is in hundredths of a
 * contract, each quote is either whole `priceCents` or integer dollar
 * `priceTenThousandths`. The original whole-cent API remains supported.
 *
 * All fills contribute before a single upward rounding at the account balance
 * grid. Invalid positive size or quote is an error, NEVER a silently free fill.
 * Scale: 1e-10 cents; for price unit q (1e-4 dollars), the scaled charge is
 *   rate * 100 * multiplier * countHundredths * q * (10000 - q).
 */
export function orderFeeCentsOfFills(fills, { multiplier = 1, maker = false, feeType, gridCents = BALANCE_GRID_CENTS } = {}) {
  if (!Array.isArray(fills)) throw new TypeError('fills must be an array');
  if (!Number.isFinite(gridCents) || !(gridCents > 0))
    throw new RangeError('gridCents must be positive and finite');
  if (!Number.isFinite(multiplier) || multiplier < 0)
    throw new RangeError('fee multiplier must be nonnegative and finite');
  const grid = Math.round(gridCents * SCALE);
  if (!Number.isSafeInteger(grid) || grid < 1)
    throw new RangeError('balance fee grid is not representable');
  const rate = rateOf({ maker, feeType });
  let scaled = 0;
  for (const fill of fills) {
    if (!fill || typeof fill !== 'object' || Array.isArray(fill))
      throw new TypeError('each fill must carry count and quote');
    const { count, priceCents, priceTenThousandths } = fill;
    const q = quoteUnits({ priceCents, priceTenThousandths });
    // A genuinely empty order has no fee, but an unrepresentable POSITIVE order
    // is a refusal: treating it as zero would overstate executable net EV.
    if (count === 0) continue;
    const hundredths = hundredthsOf(count);
    if (hundredths === null) throw new RangeError('fill count must be a positive multiple of 0.01');
    const term = Math.round(rate * 100 * multiplier * hundredths * q * (10000 - q));
    if (!Number.isSafeInteger(term) || !Number.isSafeInteger(scaled + term))
      throw new RangeError('fee arithmetic exceeds exact integer precision');
    scaled += term;
  }
  if (scaled === 0) return 0;
  return (Math.ceil(scaled / grid - 1e-9) * grid) / SCALE;
}

/** Fee in cents for one order at an integer whole-cent price. */
export const orderFeeCents = (count, priceCents, options) =>
  orderFeeCentsOfFills([{ count, priceCents }], options);

/** Fee in dollars for one order at any EXECUTABLE four-decimal venue price. */
export const orderFee = (count, price, options) =>
  orderFeeCentsOfFills([{ count, priceTenThousandths: fourDecimalQuote(price) }], options) / 100;

/** Per-contract fee of a positive-size order. Zero size has no per-contract meaning. */
export const orderFeePerContract = (count, price, options) => {
  if (!(Number.isFinite(count) && count > 0))
    throw new RangeError('positive order count is required for per-contract fee');
  return orderFee(count, price, options) / count;
};
