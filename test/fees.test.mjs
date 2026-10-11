import test from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE_GRID_CENTS, orderFeeCents, orderFeeCentsOfFills, orderFee } from '../src/fees.mjs';

// Every fill on the house account on 2026-10-11 (GET /portfolio/fills), by order: count_fp, yes_price_dollars as
// whole cents (the fee is symmetric in P), and Kalshi's fee_cost in dollars. Each order's fee_cost sums to its model
// fee rounded up to $0.0001 once (the account's grid), not to the cent and not per fill.
const ORDERS = [
  { order: '01a12cc5-1178', fills: [[1, 6, '0.004000']] },
  { order: '01a12cbd-f910', fills: [[20, 8, '0.103100']] },
  { order: '01a12cbd-1e50', fills: [[20, 8, '0.103100']] },
  { order: '01a12ca2-9170', fills: [[1, 8, '0.005200']] },
  { order: '01a12c86-85c0', fills: [[2.03, 2, '0.002800']] },
  { order: '01a12c86-37a0', fills: [[3.65, 90, '0.023000'], [0.74, 92, '0.003900']] },
  { order: '01a12c85-d5f8', fills: [[4.02, 48, '0.070300']] },
  { order: '01a12c7d-c778', fills: [[14, 7, '0.063800']] },
  { order: '01a12c7c-bdd8', fills: [[1, 8, '0.005200']] },
  { order: '01a12c7c-0a28', fills: [[3, 9, '0.017200'], [6, 9, '0.034400'], [1, 9, '0.005800']] },
  { order: '01a12c78-5108', fills: [[5.04, 1, '0.003500']] },
  { order: '01a12c77-c850', fills: [[1.35, 84, '0.012700'], [10.42, 84, '0.098100']] },
];
const cents = (dollars) => Math.round(Number(dollars) * 1e6) / 1e4;

test('replayed on every fill of 2026-10-11: an order pays its model fee rounded up to $0.0001 once', () => {
  assert.equal(BALANCE_GRID_CENTS, 0.01);
  for (const { order, fills } of ORDERS) {
    const charged = Math.round(fills.reduce((sum, [, , fee]) => sum + cents(fee), 0) * 1e4) / 1e4;
    assert.equal(orderFeeCentsOfFills(fills.map(([count, priceCents]) => ({ count, priceCents }))), charged, order);
  }
});

test('rounding is once per order: rounding each fill would overcharge the 2026-10-11 LA order by $0.0001', () => {
  const fills = [{ count: 1.35, priceCents: 84 }, { count: 10.42, priceCents: 84 }];
  assert.equal(orderFeeCentsOfFills(fills), 11.08);
  assert.equal(Math.round((orderFeeCents(1.35, 84) + orderFeeCents(10.42, 84)) * 100) / 100, 11.09);
});

test('a small order pays its fee to the hundredth of a cent, not a whole cent', () => {
  assert.equal(orderFeeCents(1, 94), 0.4);    // 0.07 x 0.94 x 0.06 = 0.3948c
  assert.equal(orderFeeCents(1, 2), 0.14);    // 0.1372c
  assert.equal(orderFee(1, 0.97), 0.0021);    // $0.002037 -> $0.0021
  assert.equal(orderFeeCents(0, 50), 0);
  assert.equal(orderFeeCents(1.005, 50), 0, 'a count finer than 0.01 contracts is not an order Kalshi takes');
});

test('an FCM-cleared account rounds the order to the cent', () => {
  assert.equal(orderFeeCents(1, 2, { gridCents: 1 }), 1);
  assert.equal(orderFeeCents(100, 96, { gridCents: 1 }), 27);
  assert.throws(() => orderFeeCents(1, 2, { gridCents: 0 }), RangeError);
});

test('makers pay nothing on a plain quadratic series and the maker rate where the series charges it', () => {
  assert.equal(orderFeeCents(13, 96, { maker: true }), 0);
  assert.equal(orderFeeCents(13, 96, { maker: true, feeType: 'quadratic_with_maker_fees' }), 0.88); // 0.8736c
  assert.equal(orderFeeCents(10, 3, { multiplier: 0.5 }), 1.02);                                    // 1.0185c
});
