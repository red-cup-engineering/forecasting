import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addMarketToEvent, derivePrefixFamilies, evaluateCells, foldEvent, kalshiMakerFee, kalshiTakerFee, newCellBook,
  newEventAccumulator, normalQuantile, priceBucketIndex, quoteAt, tradesFromQuote, wilsonInterval,
} from '../src/kalshi-edge-candidates.mjs';
import { deriveSetOfKalshiEdgeCandidates } from '../scripts/derive-set-of-kalshi-edge-candidates.mjs';

test('taker fee rounds up once per order to the account\'s $0.0001 grid; maker is free on quadratic series', () => {
  assert.ok(Math.abs(kalshiTakerFee(0.5, { count: 10 }) - 0.0175) < 1e-12); // 0.07*10*.25 = $0.175 per order of 10
  assert.equal(kalshiTakerFee(0.99, { count: 1 }), 0.0007);
  assert.equal(kalshiMakerFee(0.5, { feeType: 'quadratic' }), 0);
  assert.ok(kalshiMakerFee(0.5, { feeType: 'quadratic_with_maker_fees' }) > 0);
});

test('price buckets, Wilson and normal quantile', () => {
  assert.equal(priceBucketIndex(0.03), 0);
  assert.equal(priceBucketIndex(0.95), 8);
  assert.equal(priceBucketIndex(0.995), -1);
  const w = wilsonInterval(50, 100);
  assert.ok(w.low < 0.5 && w.high > 0.5);
  assert.ok(Math.abs(normalQuantile(0.975) - 1.96) < 0.01);
});

test('quoteAt uses the last candle before the horizon and refuses stale, crossed and wide quotes', () => {
  const candle = (end, bid, ask) => ({ end_period_ts: end, yes_bid: { close_dollars: bid }, yes_ask: { close_dollars: ask } });
  const candles = [candle(1000, '0.90', '0.92'), candle(4600, '0.95', '0.96'), candle(8200, '0.97', '0.98')];
  assert.deepEqual(quoteAt(candles, 8200 + 3600, 1), { bid: 0.97, ask: 0.98 });
  assert.deepEqual(quoteAt(candles, 8200 + 7200, 2), { bid: 0.97, ask: 0.98 });
  assert.equal(quoteAt(candles, 100000, 1), null);
  assert.equal(quoteAt([candle(10, '0.5', '0.4')], 3610, 1), null);
  assert.equal(quoteAt([candle(10, '0.2', '0.5')], 3610, 1), null);
});

test('a lane that wins reliably in both halves is a candidate; a coin-flip lane is not', () => {
  const book = newCellBook();
  const families = ['category:Test'];
  for (let i = 0; i < 400; i += 1) {
    const accumulator = newEventAccumulator(i < 200 ? 100 : 1000);
    const favourite = tradesFromQuote({ bid: 0.94, ask: 0.95 }, true, { orderSize: 10 });
    addMarketToEvent(accumulator, families, 6, favourite);
    foldEvent(book, accumulator, 500);
  }
  const evaluation = evaluateCells(book, { minEvents: 30 });
  const lane = evaluation.candidates.find((row) => row.side === 'yes' && row.mode === 'maker' && row.bucket[0] === 91);
  assert.ok(lane, 'maker favourite lane');
  assert.ok(lane.test.evLowerWilson > 0);
  assert.equal(evaluation.candidates.some((row) => row.side === 'no' && row.mode === 'taker'), false);
});

test('prefix families need three sibling series', () => {
  const map = derivePrefixFamilies(['KXHIGHNY', 'KXHIGHCHI', 'KXHIGHMIA', 'KXOTHER']);
  assert.equal(map.get('KXHIGHNY'), 'KXHIGH*');
  assert.equal(map.get('KXHIGHCHI').startsWith('KXHIGH'), true);
  assert.equal(map.has('KXOTHER'), false);
});

test('the script derives from a stubbed API and writes the record', async () => {
  const { mkdtempSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const outRoot = mkdtempSync(join(tmpdir(), 'edge-'));
  const now = Date.parse('2026-10-03T12:00:00Z');
  const closeAt = (i) => new Date(now - (i + 1) * 3600_000 * 2).toISOString().replace('.000Z', 'Z');
  const markets = Array.from({ length: 60 }, (_, i) => ({ ticker: `KXT-E${i}-A`, event_ticker: `KXT-E${i}`, close_time: closeAt(i), result: 'yes', volume_fp: '100' }));
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    const body = path.endsWith('/series') ? { series: [{ ticker: 'KXT', category: 'Test', fee_type: 'quadratic', fee_multiplier: 1 }] }
      : path.endsWith('/markets') ? { markets, cursor: '' }
      : { markets: markets.map((m) => ({ market_ticker: m.ticker, candlesticks: Array.from({ length: 40 }, (_, k) => {
        const end = Math.floor(Date.parse(m.close_time) / 1000) - (k * 3600);
        return { end_period_ts: end, yes_bid: { close_dollars: '0.50' }, yes_ask: { close_dollars: '0.51' } };
      }).reverse() })) };
    return { ok: true, status: 200, json: async () => body };
  };
  const result = await deriveSetOfKalshiEdgeCandidates({ now: new Date(now).toISOString(), outRoot, days: 7 }, { fetchImpl, paceMs: 0 });
  assert.equal(result.counts.marketsRead, 60);
  assert.ok(result.candidates > 0);
  assert.ok(existsSync(join(result.directory, 'results.json')) && existsSync(join(result.directory, 'README.md')));
});
