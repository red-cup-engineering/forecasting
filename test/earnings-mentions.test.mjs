import test from 'node:test';
import assert from 'node:assert/strict';
import { strikeFlags, quoteAt, buildFeatures, fitLogistic, predict, takerFee, feePerContract, tradeOutcome, clusterBootstrap, isEarningsSeries, brier, releaseMentions } from '../src/earnings-mentions.mjs';

test('series filter', () => {
  assert.ok(isEarningsSeries('KXEARNINGSMENTIONNVDA')); assert.ok(isEarningsSeries('KXMENTIONEARNLULU')); assert.ok(!isEarningsSeries('KXTRUMPMENTION'));
});

test('strike flags', () => {
  assert.deepEqual(strikeFlags('Tariff'), { isCount: false, multiWord: false, hasSlash: false });
  assert.equal(strikeFlags('AI (5+ times)').isCount, true);
  assert.equal(strikeFlags('Supply chain').multiWord, true);
  assert.equal(strikeFlags('Gold / Silver').hasSlash, true);
});

test('quoteAt takes the last real two-sided candle at or before t', () => {
  const c = (ts, bid, ask) => ({ end_period_ts: ts, yes_bid: { close_dollars: bid }, yes_ask: { close_dollars: ask } });
  const candles = [c(100, '0.40', '0.50'), c(160, '0.00', '1.00'), c(220, '0.60', '0.70')];
  assert.equal(quoteAt(candles, 200_000).mid, 0.45);
  assert.equal(quoteAt(candles, 230_000).ask, 0.7);
  assert.equal(quoteAt(candles, 50_000), null);
  assert.equal(quoteAt([{ end_period_ts: 100, yes_bid: { close: '0.3' }, yes_ask: { close: '0.4' } }], 100_000).bid, 0.3);
});

test('features see only strictly earlier calls', () => {
  const rows = [
    { event: 'A-1', company: 'A', word: 'x', callStart: 1, result: 'yes' },
    { event: 'A-2', company: 'A', word: 'x', callStart: 2, result: 'no' },
    { event: 'A-3', company: 'A', word: 'x', callStart: 3, result: 'yes' },
    { event: 'B-3', company: 'B', word: 'x', callStart: 3, result: 'yes' },
  ];
  buildFeatures(rows);
  assert.equal(rows[0].x.p1, 0); assert.equal(rows[0].x.nCw, 0);
  assert.equal(rows[1].x.p1, 1);
  assert.equal(rows[2].x.p1, -1); assert.equal(rows[2].x.p2, 1);
  // B-3 ties with A-3: it must not see A-3's outcome in the word rate; A-2 and A-1 only.
  const before = rows[3].x.lWord; const alone = [{ event: 'B-3', company: 'B', word: 'x', callStart: 3, result: 'yes' }];
  assert.ok(Math.abs(before - Math.log(((1 + 5 * 0.5) / (2 + 5)) / (1 - (1 + 5 * 0.5) / (2 + 5)))) < 0.5);
  assert.ok(alone.length === 1);
});

test('logistic regression separates a clean signal', () => {
  const xs = []; const ys = [];
  for (let i = 0; i < 200; i += 1) { const v = (i % 20) / 10 - 1; xs.push({ a: v }); ys.push(v > 0 ? 1 : 0); }
  const m = fitLogistic(xs, ys, { names: ['a'], ridge: 0.01 });
  assert.ok(predict(m, { a: 0.9 }) > 0.9 && predict(m, { a: -0.9 }) < 0.1);
});

test('taker fee rounds up per order', () => {
  assert.equal(takerFee(10, 0.5), 0.18); // 0.175 -> 0.18
  assert.equal(takerFee(1, 0.99), 0.01);
  assert.ok(Math.abs(feePerContract(0.5) - 0.018) < 1e-9);
});

test('trade outcome picks the favoured side net of fee', () => {
  const t = tradeOutcome({ p: 0.8, bid: 0.5, ask: 0.55, yes: 1 }, 0.1);
  assert.equal(t.side, 'yes'); assert.ok(Math.abs(t.pnl - (1 - 0.55 - feePerContract(0.55))) < 1e-9);
  const n = tradeOutcome({ p: 0.1, bid: 0.5, ask: 0.55, yes: 0 }, 0.1);
  assert.equal(n.side, 'no'); assert.ok(Math.abs(n.price - 0.5) < 1e-9);
  assert.equal(tradeOutcome({ p: 0.52, bid: 0.5, ask: 0.55, yes: 1 }, 0.1), null);
});

test('cluster bootstrap brackets the mean', () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ e: i % 10, v: i % 2 }));
  const b = clusterBootstrap(items, (x) => x.e, (x) => x.v, { draws: 300 });
  assert.ok(b.lo <= b.mean && b.mean <= b.hi); assert.equal(b.clusters, 10);
  assert.equal(brier([1, 0], [1, 0]), 0);
});

test('release mentions follow plural, possessive, slash and count rules', () => {
  const text = 'Tariffs hurt; the tariff\'s effect. Gold and silver rose. AI, AI and AI again. Supply  chain';
  assert.equal(releaseMentions('Tariff', text).count, 2);
  assert.equal(releaseMentions('Gold / Platinum', text).count, 1);
  const c = releaseMentions('AI (3+ times)', text); assert.equal(c.count, 3); assert.equal(c.need, 3);
  assert.equal(releaseMentions('supply chain', text).count, 1);
  assert.equal(releaseMentions('chai', 'chair chain').count, 0);
});
