import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Phi, fee, touch, takerLeg, loadSeen, recordSeen, appendRows, readRows } from '../src/category-shadows/common.mjs';
import * as gdp from '../src/category-shadows/gdp.mjs';
import * as fed from '../src/category-shadows/fed.mjs';
import * as nfp from '../src/category-shadows/nfp.mjs';
import * as btc from '../src/category-shadows/btc.mjs';
import * as wti from '../src/category-shadows/wti.mjs';
import { clusterCi, gradeFamily, rowEv } from '../src/category-shadows/grade.mjs';

const mk = (o) => ({ yes_bid_dollars: '0.10', yes_ask_dollars: '0.12', yes_bid_size_fp: '500.00', yes_ask_size_fp: '40.00', strike_type: 'greater', ...o });

test('fee matches the record at a 10-lot and Phi is a cdf', () => {
  assert.equal(fee(0.5), 0.018); assert.equal(fee(0.08), 0.006);
  assert.ok(Math.abs(Phi(0) - 0.5) < 1e-7 && Math.abs(Phi(1.96) - 0.975) < 1e-3);
});
test('taker legs: yes at the ask with ask depth, no at 1-bid with bid depth', () => {
  const b = touch(mk({}));
  assert.deepEqual(takerLeg(b, 'yes'), { price: 0.12, depth: 40, fee10: fee(0.12) });
  assert.deepEqual(takerLeg(b, 'no'), { price: 0.9, depth: 500, fee10: fee(0.9) });
  assert.equal(takerLeg(touch(mk({ yes_bid_dollars: '0.0000' })), 'no'), null);
});
test('gdp rule: theta 0.05 toward GDPNow', () => {
  const p = gdp.gdpRef(2, 3, 1.16); assert.ok(p > 0.8);
  assert.equal(gdp.gdpTake(touch(mk({ yes_ask_dollars: '0.50', yes_bid_dollars: '0.45' })), p), 'yes');
  assert.equal(gdp.gdpTake(touch(mk({ yes_ask_dollars: '0.80', yes_bid_dollars: '0.78' })), p), null);
  assert.equal(gdp.gdpTake(touch(mk({ yes_ask_dollars: '0.30', yes_bid_dollars: '0.28' })), 0.05), 'no');
});
test('fed futures chain: month-average inversion and the 25bp step split', () => {
  const px = (y, m) => ({ '2026-11': 96.0 }[`${y}-${m}`] ?? null);
  const post = fed.impliedAfter(new Date('2026-10-28T19:00:00Z'), 3.88, px); // 3 days left -> next month contract
  assert.ok(Math.abs(post - 4.0) < 1e-9);
  const px2 = (y, m) => ({ '2026-12': 100 - (3.93 * 9 + 4.1343 * 22) / 31 }[`${y}-${m}`] ?? null);
  assert.ok(Math.abs(fed.impliedAfter(new Date('2026-12-09T19:00:00Z'), 3.93, px2) - 4.1343) < 1e-9);
  const d = fed.stepDistribution(3.88, 4.0); assert.ok(Math.abs(d[0] - 0.52) < 1e-9 && Math.abs(d[1] - 0.48) < 1e-9);
  assert.ok(Math.abs(fed.outcomeProb(d, 1) - 0.48) < 1e-9 && fed.outcomeProb(d, 2) === 0);
  assert.equal(fed.outcomeOf({ custom_strike: { Cut: '>25' } }), -2);
  assert.equal(fed.fedTake(touch(mk({ yes_ask_dollars: '0.98', yes_bid_dollars: '0.97' })), 1), null); // price band excludes near-certainties
});
test('nfp rule: mid band 15-35c, spread <= 10c', () => {
  assert.equal(nfp.nfpTake(touch(mk({ yes_bid_dollars: '0.20', yes_ask_dollars: '0.24' }))), 'yes');
  assert.equal(nfp.nfpTake(touch(mk({ yes_bid_dollars: '0.05', yes_ask_dollars: '0.30' }))), null);
  assert.equal(nfp.nfpTake(touch(mk({ yes_bid_dollars: '0.40', yes_ask_dollars: '0.44' }))), null);
});
test('btc refs: z in DVOL sigma, time-of-day adjustment, cell rule buys NO', () => {
  const r = btc.btcRefs({ strike: 86000, spot: 84900, dvol: 0.35, hours: 4, varTod: 6e-5 });
  assert.ok(r.z > 1 && r.z < 2 && r.pDvol < 0.1 && r.zTod > 1);
  assert.equal(btc.btcTake(touch(mk({ yes_bid_dollars: '0.07', yes_ask_dollars: '0.09' })), r.z), 'no');
  assert.equal(btc.btcTake(touch(mk({ yes_bid_dollars: '0.07', yes_ask_dollars: '0.09' })), 0.5), null);
  assert.equal(btc.btcTake(touch(mk({ yes_bid_dollars: '0.01', yes_ask_dollars: '0.09' })), r.z), null);
});
test('tick logs once per market per window (dedup) and reports waiting outside the window', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-'));
  const now = Date.parse('2026-12-03T21:00:00Z'); // 16.5h before close: waiting
  const close = '2026-12-04T13:29:00Z';
  const client = { getMarkets: async () => [mk({ ticker: 'KXPAYROLLS-26NOV-T50000', event_ticker: 'KXPAYROLLS-26NOV', close_time: close, floor_strike: 50000, yes_bid_dollars: '0.20', yes_ask_dollars: '0.24' })] };
  let r = await nfp.tick({ client, now, seen: new Set() }); assert.equal(r.status, 'waiting');
  const now2 = Date.parse('2026-12-03T22:10:00Z');
  r = await nfp.tick({ client, now: now2, seen: loadSeen('nfp', root) });
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].take, 'yes'); assert.equal(r.rows[0].depth, 40); assert.equal(r.rows[0].fee10, fee(0.24));
  appendRows('nfp', r.rows, now2, root); recordSeen('nfp', r.keys, root);
  const again = await nfp.tick({ client, now: now2 + 300000, seen: loadSeen('nfp', root) });
  assert.equal(again.status, 'already-logged'); assert.equal(readRows('nfp', root).length, 1);
  assert.deepEqual(readdirSync(join(root, 'nfp')).sort(), ['2026-12-03.jsonl', 'seen.jsonl']);
});
test('grading: realised EV per contract, clustered CI, admission bars', () => {
  assert.ok(Math.abs(rowEv({ take: 'no', price: 0.9, fee10: 0.01 }, 'no') - 0.09) < 1e-12);
  assert.ok(Math.abs(rowEv({ take: 'no', price: 0.9, fee10: 0.01 }, 'yes') + 0.91) < 1e-12);
  const c = clusterCi(new Map([['a', [0.1, 0.1]], ['b', [0.1]], ['c', [0.1]]])); assert.ok(Math.abs(c.mean - 0.1) < 1e-12 && c.lo > 0.09);
  const rows = []; const results = new Map();
  for (let i = 0; i < 70; i += 1) { const t = `T${i}`; rows.push({ family: 'btc', take: 'no', price: 0.92, fee10: 0.005, ticker: t, event: `E${i}`, close: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T21:00:00Z`, ref: { dvol: i % 3 === 0 ? 0.55 : 0.4 } }); results.set(t, 'no'); }
  const g = gradeFamily('btc', rows, results);
  assert.equal(g.settledEvents, 70); assert.equal(g.checks.highVolWeek, true); assert.equal(g.checks.days, true); assert.ok(g.meanEvCents > 7);
  assert.equal(gradeFamily('gdp', rows.slice(0, 5), results).admit, false);
});
test('gdp tick in window logs the GDPNow reference per market and refuses a stale nowcast', async () => {
  const close = '2026-10-30T12:29:00Z';
  const client = { getMarkets: async () => [mk({ ticker: 'KXGDP-26OCT30-T2.0', event_ticker: 'KXGDP-26OCT30', close_time: close, floor_strike: 2, yes_bid_dollars: '0.50', yes_ask_dollars: '0.54' })] };
  const now = Date.parse('2026-10-29T21:00:00Z');
  const ok = await gdp.tick({ client, now, seen: new Set(), fetchers: { gdpnow: async () => ({ date: '2026-10-28', nowcast: 3.2, sd: 1.16, quarter: '2026q3' }) } });
  assert.equal(ok.rows[0].take, 'yes'); assert.ok(ok.rows[0].refP > 0.8); assert.equal(ok.rows[0].ref.nowcast, 3.2);
  const stale = await gdp.tick({ client, now, seen: new Set(), fetchers: { gdpnow: async () => ({ date: '2026-10-01', nowcast: 3.2, sd: 1.16 }) } });
  assert.equal(stale.status, 'stale-reference');
});

// WTI: synthetic CL=F bars (5-minute, every day), settled events 1..8 with a constant basis plus small noise.
const wtiBars = () => { const T = []; const P = []; let p = 70; const t0 = Date.parse('2026-09-01T00:00:00Z') / 1000; for (let i = 0; i < 12 * 24 * 40; i += 1) { T.push(t0 + 300 * i); p *= 1 + 0.0004 * Math.sin(i * 1.7); P.push(p); } return { T, P }; };
const wtiPrior = (bars) => Array.from({ length: 8 }, (_, i) => { const closeSec = Date.parse('2026-09-20T18:30:00Z') / 1000 + i * 86400; return { closeSec, val: wti.px(bars, closeSec).p + 0.5 + (i % 2) * 0.1 }; });
test('wti forecast: previous basis shifts F, sb from basis changes, needs history', () => {
  const bars = wtiBars(); const prior = wtiPrior(bars); const closeSec = Date.parse('2026-09-29T18:30:00Z') / 1000; const nowSec = closeSec - 6 * 3600;
  const f = wti.wtiForecast({ bars, prior, closeSec, nowSec });
  assert.ok(Math.abs(f.F - (f.p0 + f.b)) < 1e-12 && Math.abs(f.b - 0.6) < 1e-9 && Math.abs(f.sb - 0.099) < 0.002 && f.sig > 0 && f.nb > 0);
  assert.equal(wti.wtiForecast({ bars, prior: prior.slice(0, 4), closeSec, nowSec }), null);
});
test('wti bracket probabilities: greater, less, between sum to one', () => {
  const f = { F: 80, sig: 1, sb: 0 };
  const g = wti.bracketProb({ strike_type: 'greater', floor_strike: 80 }, f); assert.ok(Math.abs(g - 0.5) < 1e-6);
  const parts = wti.bracketProb({ strike_type: 'less', cap_strike: 78.99 }, f) + wti.bracketProb({ strike_type: 'between', floor_strike: 79, cap_strike: 80.99 }, f) + wti.bracketProb({ strike_type: 'greater', floor_strike: 80.99 }, f);
  assert.ok(Math.abs(parts - 1) < 0.01); // the backtest widens only the between-cap by half a cent
});
test('wti take rule: 3c after the 1-lot fee, ask > bid, YES before NO', () => {
  const b = (bid, ask) => touch(mk({ yes_bid_dollars: bid, yes_ask_dollars: ask }));
  assert.equal(wti.wtiTake(b('0.40', '0.45'), 0.60), 'yes'); // 0.60 - 0.45 - fee 0.02 = 0.13
  assert.equal(wti.wtiTake(b('0.40', '0.45'), 0.47), null); // 0.47 - 0.45 - 0.02 < 0.03
  assert.equal(wti.wtiTake(b('0.40', '0.45'), 0.20), 'no'); // 0.80 - 0.60 - 0.02
  assert.equal(wti.wtiTake(b('0.45', '0.45'), 0.9), null);
  assert.equal(wti.wtiTake(touch(mk({ yes_bid_dollars: undefined })), 0.9), null);
});
test('wti window rule: 12/6/3/1h horizons, 20 minute window, daily events only', () => {
  assert.equal(wti.horizonFor(12), 12); assert.equal(wti.horizonFor(11.7), 12); assert.equal(wti.horizonFor(11.6), null); assert.equal(wti.horizonFor(12.01), null);
  assert.equal(wti.horizonFor(5.9), 6); assert.equal(wti.horizonFor(2.5), null); assert.equal(wti.horizonFor(1), 1); assert.equal(wti.horizonFor(24), null);
  assert.ok(wti.isDailyEvent('KXWTI-26OCT0614') && !wti.isDailyEvent('KXWTI-26NOV03'));
});
test('wti tick logs every bracket once per event+horizon with depth, fee10, refP, edge; marks takes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cs-')); const bars = wtiBars(); const prior = wtiPrior(bars);
  const close = '2026-09-29T18:30:00Z'; const now = Date.parse(close) - 5.9 * 3600e3;
  const ev = 'KXWTI-26SEP2914'; const f = wti.wtiForecast({ bars, prior, closeSec: Date.parse(close) / 1000, nowSec: now / 1000 });
  const lo = (f.F - 3).toFixed(2);
  const mkts = [mk({ ticker: `${ev}-T${lo}`, event_ticker: ev, close_time: close, floor_strike: Number(lo), yes_bid_dollars: '0.60', yes_ask_dollars: '0.70' }),
    mk({ ticker: `${ev}-T${(f.F + 40).toFixed(2)}`, event_ticker: ev, close_time: close, floor_strike: f.F + 40, yes_bid_dollars: '0.01', yes_ask_dollars: '0.03' })];
  const client = { getMarkets: async () => [...mkts, mk({ ticker: 'KXWTI-26NOV03-T50', event_ticker: 'KXWTI-26NOV03', close_time: close, floor_strike: 50 })] };
  const fetchers = { wtiBars: async () => bars, wtiSettled: async () => prior };
  const r = await wti.tick({ client, now, seen: new Set(), fetchers });
  assert.equal(r.rows.length, 2); assert.deepEqual(r.keys, [`${ev}|h6`]);
  assert.equal(r.rows[0].take, 'yes'); assert.equal(r.rows[0].depth, 40); assert.equal(r.rows[0].fee10, fee(0.7)); assert.ok(r.rows[0].refP > 0.99 && r.rows[0].edge > 0.29); assert.equal(r.rows[0].horizon, 6);
  assert.equal(r.rows[1].take, null);
  appendRows('wti', r.rows, now, root); recordSeen('wti', r.keys, root);
  const again = await wti.tick({ client, now: now + 300000, seen: loadSeen('wti', root), fetchers });
  assert.equal(again.rows.length, 0); assert.equal(again.status, 'waiting');
  const far = await wti.tick({ client, now: Date.parse(close) - 8 * 3600e3, seen: new Set(), fetchers }); assert.equal(far.status, 'waiting');
});
test('wti admission bar: 60 events, 20 days, +3c, positive lower bound, event clusters; retire after 25 events', () => {
  const mkRows = (n, price, win) => { const rows = []; const results = new Map(); for (let i = 0; i < n; i += 1) { const t = `W${i}`; rows.push({ family: 'wti', take: 'yes', price, fee10: 0.01, ticker: t, event: `E${i}`, close: `2026-10-${String(1 + (i % 25)).padStart(2, '0')}T18:30:00Z` }); results.set(t, i % 10 < win ? 'yes' : 'no'); } return { rows, results }; };
  const good = mkRows(70, 0.5, 9); const g = gradeFamily('wti', good.rows, good.results);
  assert.equal(g.settledEvents, 70); assert.ok(g.days >= 20); assert.equal(g.checks.days, true); assert.ok(g.meanEvCents >= 3); assert.equal(g.admit, true);
  const few = mkRows(59, 0.5, 9); assert.equal(gradeFamily('wti', few.rows, few.results).admit, false);
  const thin = mkRows(70, 0.89, 9); assert.equal(gradeFamily("wti", thin.rows, thin.results).checks.mean, false); // mean about 0, below the 3c bar
  const bad = mkRows(30, 0.5, 4); const gb = gradeFamily('wti', bad.rows, bad.results); assert.equal(gb.retire, true); assert.equal(gb.admit, false);
  const early = mkRows(20, 0.5, 4); assert.equal(gradeFamily('wti', early.rows, early.results).retire, false);
});
