import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hypothesesDir } from '../src/hypotheses/run.mjs';
import { RegistrationError, entriesFromTape, requireAfterRegistration, snapshotTarget } from '../src/hypotheses/entry.mjs';
import { quoteFromCandles, syncForwardQuotes, tapeFor } from '../src/hypotheses/data.mjs';
import { orderFee } from '../src/fees.mjs';

// The cent-per-order hypotheses are scored on the fee they registered: whole cents per order, not the account grid.
const CENT = { gridCents: 1 };

const load = (id) => JSON.parse(readFileSync(join(hypothesesDir, `${id}.json`), 'utf8'));
const row = (ticker, event, result, bid, ask, { close = '2026-10-15T12:25:00Z', ts = '2026-10-14T12:25:00Z' } = {}) => ({ ticker, event, close, occ: close, result, multiplier: 1, quote: bid === null ? null : { ts, bid, ask } });

test('C1 on a synthetic tape: NO at 1 - bid, only YES asks in [0.15, 0.65], cent-rounded fee at C = 10', () => {
  const h = load('claims-c1');
  const tape = [
    row('KXJOBLESSCLAIMS-26OCT15-210', 'KXJOBLESSCLAIMS-26OCT15', 'no', 0.38, 0.40),   // in band, NO wins
    row('KXJOBLESSCLAIMS-26OCT15-220', 'KXJOBLESSCLAIMS-26OCT15', 'yes', 0.58, 0.60),  // in band, NO loses
    row('KXJOBLESSCLAIMS-26OCT15-200', 'KXJOBLESSCLAIMS-26OCT15', 'yes', 0.90, 0.92),  // out of band
    row('KXJOBLESSCLAIMS-26OCT15-230', 'KXJOBLESSCLAIMS-26OCT15', 'no', 0.02, 0.10),   // out of band
    row('KXJOBLESSCLAIMS-26OCT15-240', 'KXJOBLESSCLAIMS-26OCT15', 'no', null),          // no quote
  ];
  const { entries, noQuote } = entriesFromTape(h, tape);
  assert.equal(noQuote, 1);
  assert.equal(entries.length, 2);
  const win = entries.find((e) => e.ticker.endsWith('-210')), loss = entries.find((e) => e.ticker.endsWith('-220'));
  assert.equal(win.price, 0.62);
  assert.equal(win.won, true);
  assert.ok(Math.abs(win.x - (1 - 0.62 - orderFee(10, 0.62, CENT) / 10)) < 1e-12);
  assert.equal(loss.won, false);
  assert.ok(Math.abs(loss.x - (0 - 0.42 - orderFee(10, 0.42, CENT) / 10)) < 1e-12);
  assert.equal(win.g, 'KXJOBLESSCLAIMS-26OCT15');
});

test('O1 chooses the rung nearest 0.50 once per event', () => {
  const h = load('ncaaf-overs-o1');
  const ev = 'KXNCAAFTOTAL-26OCT17AAABBB';
  const tape = [row(`${ev}-50`, ev, 'yes', 0.70, 0.72), row(`${ev}-55`, ev, 'no', 0.49, 0.51), row(`${ev}-60`, ev, 'no', 0.30, 0.32)];
  const { entries } = entriesFromTape(h, tape);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ticker, `${ev}-55`);
  assert.equal(entries[0].price, 0.51);
});

test('registeredAt: observations before registration are refused, and the helper throws', () => {
  const h = load('claims-c1');
  const early = row('KXJOBLESSCLAIMS-26OCT08-210', 'KXJOBLESSCLAIMS-26OCT08', 'no', 0.38, 0.40, { close: '2026-10-08T12:25:00Z', ts: '2026-10-07T12:25:00Z' });
  const closedEarly = row('KXJOBLESSCLAIMS-26OCT01-210', 'KXJOBLESSCLAIMS-26OCT01', 'no', 0.38, 0.40, { close: '2026-10-01T12:25:00Z', ts: '2026-09-30T12:25:00Z' });
  const ok = row('KXJOBLESSCLAIMS-26OCT15-210', 'KXJOBLESSCLAIMS-26OCT15', 'no', 0.38, 0.40);
  const r = entriesFromTape(h, [early, closedEarly, ok]);
  assert.equal(r.refused, 2);
  assert.equal(r.entries.length, 1);
  assert.throws(() => requireAfterRegistration(h, '2026-10-07T12:00:00Z'), RegistrationError);
  assert.doesNotThrow(() => requireAfterRegistration(h, h.registeredAt));
});

test('snapshot target and candle quote extraction', () => {
  const h = load('claims-c1');
  const target = snapshotTarget({ close: '2026-10-15T12:25:00Z' }, h.entry.snapshot);
  assert.equal(new Date(target).toISOString(), '2026-10-14T12:25:00.000Z');
  const sec = target / 1000;
  const candles = [
    { end_period_ts: sec - 600, yes_bid: { close_dollars: '0.3000' }, yes_ask: { close_dollars: '0.3400' } },
    { end_period_ts: sec - 60, yes_bid: { close_dollars: '0.3100' }, yes_ask: { close_dollars: '0.3500' } },
    { end_period_ts: sec + 60, yes_bid: { close_dollars: '0.9000' }, yes_ask: { close_dollars: '0.9500' } }, // after the snapshot: never used
  ];
  assert.deepEqual(quoteFromCandles(candles, sec, 3600), { ts: new Date((sec - 60) * 1000).toISOString(), bid: 0.31, ask: 0.35 });
  assert.deepEqual(quoteFromCandles([{ end_period_ts: sec - 60, yes_bid: { close_dollars: '0.0000' }, yes_ask: { close_dollars: '1.0000' } }], sec, 3600), { none: true });
});

test('forward-window custody uses the post-fetch receipt, never the cycle start or a later historical quote', async () => {
  const h = load('claims-c1');
  const ticker = 'KXJOBLESSCLAIMS-26OCT15-210', series = 'KXJOBLESSCLAIMS';
  const close = '2026-10-15T12:25:00Z';
  const target = Date.parse(close) - 24 * 3600e3;
  const market = {
    ticker, event_ticker: 'KXJOBLESSCLAIMS-26OCT15', close_time: close,
    yes_bid_dollars: '0.3800', yes_ask_dollars: '0.4000',
  };
  const fetcher = {
    async kalshi(path, q) {
      assert.equal(path, '/markets');
      assert.equal(q.series_ticker, series);
      assert.equal(q.status, 'open');
      return { markets: [market], cursor: '' };
    },
  };
  const memory = () => {
    const quotes = new Map();
    return {
      get: (e, a) => quotes.get(e + ':' + a),
      put(e, a, value, receipt) {
        assert.equal(receipt, value.observedAt);
        quotes.set(e + ':' + a, value);
        return true;
      },
      all: (attribute) => attribute === 'market'
        ? [[ticker, { ev: market.event_ticker, close, occ: close, result: 'no' }]]
        : [],
    };
  };
  const store = memory(), report = {};
  await syncForwardQuotes({ store, fetcher, hypotheses: [h], report, receiptClock: () => target });
  assert.equal(report.newQuotes, 1);
  const witness = store.get(ticker, 'quote:close:-1440');
  assert.equal(witness.kind, 'forward-window');
  assert.equal(witness.ts, new Date(target).toISOString());
  assert.equal(witness.observedAt, witness.ts);
  assert.deepEqual(tapeFor({ store, universe: [series], snapshot: h.entry.snapshot,
    notBeforeMs: Date.parse(h.registeredAt), requireForward: true })[0].quote, witness);

  const laterStore = memory(), laterReport = {};
  await syncForwardQuotes({ store: laterStore, fetcher, hypotheses: [h], report: laterReport,
    receiptClock: () => target + 61 * 60000 });
  assert.equal(laterReport.newQuotes ?? 0, 0, 'response received after the 60-min band cannot be backdated');
  assert.equal(laterStore.get(ticker, 'quote:close:-1440'), undefined);

  // A candle loaded after settlement remains retrospective, not a forward witness.
  const retrospective = memory();
  retrospective.put(ticker, 'quote:close:-1440', {
    ts: new Date(target).toISOString(), bid: 0.38, ask: 0.4,
    observedAt: new Date(target + 86400e3).toISOString(),
  }, new Date(target + 86400e3).toISOString());
  assert.equal(tapeFor({ store: retrospective, universe: [series], snapshot: h.entry.snapshot,
    notBeforeMs: Date.parse(h.registeredAt), requireForward: true })[0].quote, null);
});
