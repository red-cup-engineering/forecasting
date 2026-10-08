import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sidesOfReading } from '@red-cup-engineering/computer-data-engineering-services-section/four';
import { createFetcher, BudgetExhausted } from '../src/hypotheses/fetcher.mjs';
import { readStatuses, runHypotheses, hypothesesDir } from '../src/hypotheses/run.mjs';
import { admittedHypothesisModels, hypothesisSurface } from '../src/hypotheses/admit.mjs';
import { openStore } from '../src/hypotheses/store.mjs';

const NOW = Date.parse('2027-02-01T00:00:00Z');
const WEEKS = 14; // settled weekly events after registration

/** A fake Kalshi: one series, WEEKS weekly events of two thresholds each; NO always wins on the in-band rung. */
function fakeClient(calls) {
  const events = Array.from({ length: WEEKS }, (_, i) => {
    const close = new Date(Date.parse('2026-10-15T12:25:00Z') + i * 7 * 86400000);
    return { id: `T-${String(i).padStart(2, '0')}`, close };
  });
  const markets = events.flatMap((e) => [200, 210].map((s) => ({ ticker: `${e.id}-${s}`, event_ticker: e.id, close_time: e.close.toISOString().replace('.000', ''), occurrence_datetime: e.close.toISOString().replace('.000', ''), result: 'no', floor_strike: s * 1000, strike_type: 'greater_or_equal' })));
  return {
    async call(method, path, { query } = {}) {
      calls.push(path);
      if (path === '/series/T') return { series: { fee_multiplier: 1, fee_type: 'quadratic' } };
      if (path === '/markets') return { markets, cursor: '' };
      if (path === '/markets/candlesticks') {
        return { markets: query.market_tickers.split(',').map((t) => ({ market_ticker: t, candlesticks: [{ end_period_ts: query.end_ts - 60, yes_bid: { close_dollars: '0.3800' }, yes_ask: { close_dollars: '0.4000' } }] })) };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hyp-')), content = join(root, 'content');
  mkdirSync(content);
  const h = JSON.parse(readFileSync(join(hypothesesDir, 'claims-c1.json'), 'utf8'));
  writeFileSync(join(content, 'test-t1.json'), JSON.stringify({ ...h, id: 'test-t1', universe: { series: ['T'] }, registeredAt: '2026-10-08T00:00:00Z' }));
  writeFileSync(join(content, 'late-favourite-r1.json'), readFileSync(join(hypothesesDir, 'late-favourite-r1.json')));
  return { root: join(root, 'state'), content };
}

test('a run encodes entries, passes the criterion, emits a surface model, and skips killed hypotheses', async () => {
  const { root, content } = fixture(), calls = [];
  const fetcher = createFetcher({ budget: 100, client: fakeClient(calls) });
  const r = await runHypotheses({ requestBudget: 100, root, contentDir: content, now: NOW, fetcher });
  assert.deepEqual(r.skipped, ['late-favourite-r1']);
  const t1 = r.hypotheses.find((x) => x.id === 'test-t1');
  assert.equal(t1.clusters, WEEKS);
  assert.deepEqual(sidesOfReading(t1.reading), [true, false]);
  assert.equal(t1.status, 'passed');
  assert.ok(existsSync(join(root, 'admitted', 'test-t1.json')));
  assert.ok(!existsSync(join(root, 'late-favourite-r1')), 'killed hypotheses leave no ledger');
  const model = JSON.parse(readFileSync(join(root, 'admitted', 'test-t1.json'), 'utf8'));
  assert.equal(model.model.id, 'hypothesis:test-t1');
  assert.equal(model.model.band.admitted, true);
  assert.ok(model.model.p < 0.2 && model.model.band.low <= model.model.p && model.model.p <= model.model.band.high, JSON.stringify(model.model));
  // The desk-side lookup: a contract in the rule's band 24 h before close gets the model; outside the band it does not.
  const live = { dir: root, series: 'T', quote: { bid: 0.38, ask: 0.40 }, minutesToAnchor: { close: 1440 } };
  assert.equal(admittedHypothesisModels(live).length, 1);
  assert.equal(admittedHypothesisModels({ ...live, quote: { bid: 0.9, ask: 0.92 } }).length, 0);
  assert.equal(admittedHypothesisModels({ ...live, minutesToAnchor: { close: 300 } }).length, 0);
  const surface = hypothesisSurface({ ...live, mid: 0.39 });
  assert.ok(surface.admitted.includes('hypothesis:test-t1') && surface.p < 0.39);
  assert.ok(!calls.some((p) => p.includes('KXLATE')), 'no fetch for killed');
});

test('idempotent: a second run on the same input yields the same ledger and fetches nothing new', async () => {
  const { root, content } = fixture(), calls = [];
  await runHypotheses({ requestBudget: 100, root, contentDir: content, now: NOW, fetcher: createFetcher({ budget: 100, client: fakeClient(calls) }) });
  const ledger1 = readFileSync(join(root, 'test-t1', 'ledger.json'), 'utf8');
  const cache1 = readdirSync(join(root, 'cache', 'data', 'logs'), { recursive: true }).length;
  const calls2 = [];
  const r2 = await runHypotheses({ requestBudget: 100, root, contentDir: content, now: NOW + 3600e3, fetcher: createFetcher({ budget: 100, client: fakeClient(calls2) }) });
  assert.equal(readFileSync(join(root, 'test-t1', 'ledger.json'), 'utf8'), ledger1);
  assert.equal(r2.sync.newQuotes ?? 0, 0);
  assert.equal(r2.sync.newMarkets ?? 0, 0);
  assert.equal(calls2.filter((p) => p === '/markets/candlesticks').length, 0);
  assert.equal(readdirSync(join(root, 'cache', 'data', 'logs'), { recursive: true }).length, cache1);
  // A no-fetch verdict run reproduces the status.
  const r3 = await runHypotheses({ mode: 'verdict', root, contentDir: content, now: NOW });
  assert.equal(r3.hypotheses.find((x) => x.id === 'test-t1').mean, r2.hypotheses.find((x) => x.id === 'test-t1').mean);
});

test('the request budget stops a run cleanly and the next run resumes', async () => {
  const { root, content } = fixture(), calls = [];
  const r1 = await runHypotheses({ requestBudget: 3, root, contentDir: content, now: NOW, fetcher: createFetcher({ budget: 3, client: fakeClient(calls) }) });
  assert.equal(r1.partial, true);
  assert.equal(calls.length, 3);
  const r2 = await runHypotheses({ requestBudget: 100, root, contentDir: content, now: NOW, fetcher: createFetcher({ budget: 100, client: fakeClient([]) }) });
  assert.equal(r2.hypotheses.find((x) => x.id === 'test-t1').clusters, WEEKS);
  assert.throws(() => createFetcher({}), TypeError);
  await assert.rejects(createFetcher({ budget: 0, client: fakeClient([]) }).kalshi('/series/T'), BudgetExhausted);
  await assert.rejects(runHypotheses({ root, contentDir: content }), TypeError);
});

test('observations are SEAVT rows in the flat-file journal layout', async () => {
  const { root, content } = fixture();
  await runHypotheses({ requestBudget: 100, root, contentDir: content, now: NOW, fetcher: createFetcher({ budget: 100, client: fakeClient([]) }) });
  const store = openStore(join(root, 'cache'));
  assert.equal(store.get('T-00-200', 'market').result, 'no');
  assert.equal(store.get('T-00-200', 'quote:close:-1440').bid, 0.38);
  const statuses = readStatuses({ root, contentDir: hypothesesDir });
  assert.equal(statuses.find((s) => s.id === 'late-favourite-r1').status, 'killed');
});
