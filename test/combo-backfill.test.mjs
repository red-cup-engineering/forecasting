import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleWindows, dateRange, buildSnapshots, openCache, scoreFamily, familyEvents, isSportsLeg, candleRows } from '../scripts/combo-backfill.mjs';

test('window sampling is deterministic, disjoint, inside the slate and weighted to sports hours', () => {
  const a = sampleWindows({ date: '2026-09-27', windows: 24, windowMinutes: 5, seed: 1 });
  assert.deepEqual(a, sampleWindows({ date: '2026-09-27', windows: 24, windowMinutes: 5, seed: 1 }));
  assert.notDeepEqual(a, sampleWindows({ date: '2026-09-27', windows: 24, windowMinutes: 5, seed: 2 }));
  assert.equal(a.length, 24);
  const lo = Date.parse('2026-09-27T10:00:00Z') / 1000;
  for (let i = 0; i < a.length; i += 1) {
    assert.ok(a[i].minTs >= lo && a[i].maxTs < lo + 86400);
    assert.equal(a[i].maxTs - a[i].minTs, 299);
    if (i) assert.ok(a[i].minTs > a[i - 1].maxTs);
  }
  const peak = a.filter((w) => { const h = new Date(w.minTs * 1000).getUTCHours(); return h >= 16 || h < 4; }).length;
  assert.ok(peak >= 18, `sports hours hold most windows (${peak})`);
  assert.equal(sampleWindows({ date: '2026-09-27', windows: 9999, windowMinutes: 60 }).length, 24);
});

test('dateRange is inclusive', () => assert.deepEqual(dateRange('2026-09-26', '2026-09-28'), ['2026-09-26', '2026-09-27', '2026-09-28']));

test('snapshots carry the latest close per market forward, drop stale books, and sort globally', () => {
  const rows = [
    { event: 'E2', ticker: 'E2-A', ts: 120, bid: 0.1, ask: 0.2 },
    { event: 'E1', ticker: 'E1-A', ts: 60, bid: 0.4, ask: 0.5 },
    { event: 'E1', ticker: 'E1-B', ts: 120, bid: 0.3, ask: 0.35 },
    { event: 'E1', ticker: 'E1-A', ts: 240, bid: 0.45, ask: 0.5 },
    { event: 'E1', ticker: 'E1-B', ts: 5000, bid: 0.6, ask: 0.7 },
  ];
  const s = buildSnapshots(rows, { maxCarryS: 1800 });
  assert.deepEqual(s.map((x) => [x.t, x.event]), [[60e3, 'E1'], [120e3, 'E1'], [120e3, 'E2'], [240e3, 'E1'], [5000e3, 'E1']]);
  assert.deepEqual(s[1].markets, [{ ticker: 'E1-A', bid: 0.4, ask: 0.5 }, { ticker: 'E1-B', bid: 0.3, ask: 0.35 }]);
  assert.deepEqual(s[3].markets.map((m) => [m.ticker, m.bid]), [['E1-A', 0.45], ['E1-B', 0.3]]);
  assert.deepEqual(s[4].markets, [{ ticker: 'E1-B', bid: 0.6, ask: 0.7 }]); // E1-A's book is 4760 s old
  assert.ok(s.every((x) => x.k === 'ev'));
});

test('jsonl cache resumes, lets later rows win and survives a torn last line', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'cb-')), 'combos.jsonl');
  const c = openCache(f, (r) => r.t);
  c.add({ t: 'KXMVE-1', legs: [['KXNFLGAME-26SEP27LACBUF-BUF', 'yes', 'KXNFLGAME-26SEP27LACBUF']], r: '' });
  c.add({ t: 'KXMVE-1', legs: null, r: 'no' });
  appendFileSync(f, '{"t":"KXMVE-2","le');
  const again = openCache(f, (r) => r.t);
  assert.equal(again.map.size, 1);
  assert.equal(again.get('KXMVE-1').r, 'no');
  assert.ok(!again.has('KXMVE-2'));
});

test('game families and sports detection', () => {
  const f = scoreFamily('KXNFLSPREAD-26SEP27LACBUF-BUF28', 'KXNFLSPREAD-26SEP27LACBUF');
  assert.deepEqual(f, { prefix: 'KXNFL', game: '26SEP27LACBUF' });
  assert.ok(familyEvents(f).includes('KXNFLTEAMTOTAL-26SEP27LACBUF'));
  assert.equal(scoreFamily('KXNFLRECYDS-26SEP27LACBUF-X-50', 'KXNFLRECYDS-26SEP27LACBUF'), null);
  assert.equal(scoreFamily('KXHIGHNY-26SEP27-T70', 'KXHIGHNY-26SEP27'), null);
  assert.ok(isSportsLeg('KXNFLRECYDS-26SEP27LACBUF-X-50', 'KXNFLRECYDS-26SEP27LACBUF'));
  assert.ok(!isSportsLeg('KXHIGHNY-26SEP27-T70', 'KXHIGHNY-26SEP27'));
});

test('candle rows read close quotes, 0 when absent', () => {
  const rows = candleRows({ markets: [{ market_ticker: 'M', candlesticks: [{ end_period_ts: 60, yes_bid: { close_dollars: '0.4600' }, yes_ask: { close_dollars: '0.4700' } }, { end_period_ts: 120, price: {} }] }, { market_ticker: 'Z', candlesticks: [] }] }, (t) => (t === 'M' ? 'E' : null));
  assert.deepEqual(rows, [{ event: 'E', ticker: 'M', ts: 60, bid: 0.46, ask: 0.47 }, { event: 'E', ticker: 'M', ts: 120, bid: 0, ask: 0 }]);
});

test('crypto 15m legs and whole-day sampling', async () => {
  const { isCrypto15mLeg } = await import('../scripts/combo-backfill.mjs');
  assert.ok(isCrypto15mLeg('KXBTC15M-26SEP271500-00', 'KXBTC15M-26SEP271500'));
  assert.ok(!isCrypto15mLeg('KXNFLGAME-26SEP27LACBUF-BUF', 'KXNFLGAME-26SEP27LACBUF'));
  const w = sampleWindows({ date: '2026-09-27', windows: 288, windowMinutes: 5, startHour: 0, peak: 1 });
  assert.equal(w.length, 288);
  assert.equal(w[0].minTs, Date.parse('2026-09-27T00:00:00Z') / 1000);
});
