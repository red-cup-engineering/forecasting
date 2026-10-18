import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createMarketDataCache } from '../src/market-data-cache.mjs';
import { jsonlRows, jsonlRowsSync, sealJsonl } from '../src/jsonl-file.mjs';

const T = Date.parse('2026-09-27T12:00:00Z') / 1000;
const rows = (ticker, from, to) => { const out = []; for (let ts = from; ts <= to; ts += 60) out.push({ ticker, ts, bid: 0.4, ask: 0.5 }); return out; };

test('the cache fetches only what no window has covered, and keeps each minute once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdc-'));
  try {
    const cache = createMarketDataCache({ dir });
    const tickers = ['KXNFLGAME-26SEP27LACBUF-BUF', 'KXNFLGAME-26SEP27LACBUF-LAC'];
    assert.deepEqual(await cache.candles.missing(tickers, T - 1800, T + 299), tickers);
    await cache.candles.add(tickers, T - 1800, T + 299, tickers.flatMap((t) => rows(t, T - 1800, T + 299)));
    await cache.flush();
    assert.deepEqual(await cache.candles.missing(tickers, T - 1800, T + 299), []);
    // the next window overlaps the first by 10 minutes: only the markets' uncovered tail is missing, and overlap rows are not stored twice
    assert.deepEqual(await cache.candles.missing(tickers, T - 600, T + 1000), tickers);
    await cache.candles.add(tickers, T - 600, T + 1000, tickers.flatMap((t) => rows(t, T - 600, T + 1000)));
    await cache.flush();
    const all = await cache.candles.rows([tickers[0]], T - 1800, T + 1000);
    assert.equal(all.length, Math.floor((1000 + 1800) / 60) + 1);
    assert.equal(new Set(all.map((r) => r.ts)).size, all.length);
    // a fresh process reads the same from disk
    const again = createMarketDataCache({ dir });
    assert.deepEqual(await again.candles.missing(tickers, T - 1800, T + 1000), []);
    assert.deepEqual(await again.candles.rows([tickers[0]], T - 1800, T + 1000), all);
    // a market with no candles at all is covered all the same, so it is not asked for again
    await again.candles.add(['KXNBAGAME-26SEP27AAABBB-AAA'], T, T + 299, []);
    assert.deepEqual(await again.candles.missing(['KXNBAGAME-26SEP27AAABBB-AAA'], T, T + 299), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a range that crosses midnight is kept per day and read back whole', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdc-'));
  try {
    const cache = createMarketDataCache({ dir }), t = 'KXBTC15M-26SEP27-X', midnight = Date.parse('2026-09-28T00:00:00Z') / 1000;
    await cache.candles.add([t], midnight - 300, midnight + 300, rows(t, midnight - 300, midnight + 300));
    await cache.flush();
    assert.equal((await cache.candles.rows([t], midnight - 300, midnight + 300)).length, 11);
    assert.deepEqual(await cache.candles.missing([t], midnight - 300, midnight + 300), []);
    assert.deepEqual(await cache.candles.missing([t], midnight - 300, midnight + 301), [t]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tape windows are stored and read back exactly; eviction drops by age', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mdc-'));
  try {
    const cache = createMarketDataCache({ dir }), record = { minTs: 1, maxTs: 299, tapeTrades: 3, trades: [{ trade_id: 'a', ticker: 'KXMVE-1' }] };
    await cache.tape.put(1, 299, record);
    assert.deepEqual(await cache.tape.get(1, 299), record);
    assert.equal(await cache.tape.get(2, 300), null);
    const r = await cache.evict({ now: Date.now() + 200 * 86400_000, keepDays: 90 });
    assert.equal(r.removedRefs, 1);
    assert.equal(await cache.tape.get(1, 299), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a sealed JSONL reads as one stream with the plain rows after it, and a torn line stays plain', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jl-')), f = join(dir, 'trades.jsonl');
  try {
    writeFileSync(f, `${JSON.stringify({ n: 1 })}\n${JSON.stringify({ n: 2 })}\n{"n":3,"to`);
    const sealed = sealJsonl(f);
    assert.ok(sealed.after > 0);
    assert.equal(readFileSync(f, "utf8"), "{\"n\":3,\"to", 'the torn line is not sealed');
    appendFileSync(f, "rn\":1}\n");
    assert.deepEqual(jsonlRowsSync(f).map((r) => r.n), [1, 2, 3]);
    sealJsonl(f);
    assert.equal(existsSync(f), false);
    assert.deepEqual(jsonlRowsSync(f).map((r) => r.n), [1, 2, 3]);
    appendFileSync(f, `${JSON.stringify({ n: 4 })}\n`);
    const seen = []; for await (const r of jsonlRows(f)) seen.push(r.n);
    assert.deepEqual(seen, [1, 2, 3, 4]);
    assert.equal(gunzipSync(readFileSync(`${f}.gz`)).toString().split('\n').filter(Boolean).length, 3);
    assert.equal(sealJsonl(join(dir, 'absent.jsonl')), null);
    assert.equal(sealJsonl(f, { minAgeMs: 3600_000 }), null, 'a file still being written is left alone');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
