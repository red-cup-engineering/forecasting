// Scoring and admission for the category shadows. Admission bars are fixed IN ADVANCE here and in the README; change them only by a dated amendment.
import { binarySettlement } from '@red-cup-engineering/kalshi-services-section/market-facts';
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { familyDir, readRows, round } from './common.mjs';

export const BARS = {
  gdp: { cluster: 'event', minEvents: 8, minTakes: 20, minMeanCents: 3, note: 'GDPNow vs KXGDP, theta 0.05: >= 8 settled advance releases, >= 20 would-take rows, mean EV >= +3c/contract and a positive lower 95% CI (event-clustered). Retire if mean <= 0 after 4 releases.', retireAfterEvents: 4 },
  fed: { cluster: 'event', minEvents: 8, minTakes: 30, minNonHoldEvents: 3, minMeanCents: 1, note: 'ZQ futures vs KXFEDDECISION, theta 0.02: >= 8 settled meetings of which >= 3 ended in a hike or cut, >= 30 would-take rows, mean EV >= +1c and a positive lower 95% CI (meeting-clustered; daily rows of one meeting are one cluster). Retire if mean <= 0 after 4 meetings.', retireAfterEvents: 4 },
  nfp: { cluster: 'event', minEvents: 30, minTakes: 30, minMeanCents: 5, note: 'NFP mid-band YES longshot: >= 30 settled prints with a would-take row, mean EV >= +5c and a positive lower 95% CI (print-clustered). Retire if mean <= 0 after 12 prints.', retireAfterEvents: 12 },
  btc: { cluster: 'day', minEvents: 60, minDays: 20, minHighVolDays: 7, minMeanCents: 2, note: 'BTC 4h upside tail (buy NO, strike 1-2 DVOL-sigma above spot): >= 60 settled KXBTCD events with a would-take row on >= 20 UTC days, including >= 7 UTC days whose rows carry DVOL > 50, mean EV >= +2c and a positive lower 95% CI (clustered by UTC day). Retire if mean <= 0 after 30 events.', retireAfterEvents: 30 },
  wti: { cluster: 'event', minEvents: 60, minDays: 20, minMeanCents: 3, note: 'KXWTI daily vs CL=F lognormal (the category-edges backtest model, taker at ask or 1-bid, 12/6/3/1h before close): >= 60 settled events with a would-take row on >= 20 UTC days, mean EV >= +3c/contract and a positive lower 95% CI (clustered by event; the horizon rows of one event are one cluster). Retire if mean <= 0 after 25 events.', retireAfterEvents: 25 },
};

export function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Mean and cluster-bootstrap 95% CI. clusters: Map(key -> number[]). */
export function clusterCi(clusters, B = 4000, seed = 1) {
  const arr = [...clusters.values()]; const n = arr.length;
  const all = arr.flat(); const mean = all.length ? all.reduce((a, b) => a + b, 0) / all.length : null;
  if (n < 2) return { mean, lo: null, hi: null, clusters: n, n: all.length };
  const rnd = mulberry32(seed); const means = [];
  for (let b = 0; b < B; b += 1) { let s = 0; let c = 0; for (let i = 0; i < n; i += 1) { const a = arr[Math.floor(rnd() * n)]; for (const v of a) s += v; c += a.length; } means.push(s / c); }
  means.sort((x, y) => x - y);
  return { mean, lo: means[Math.floor(0.025 * B)], hi: means[Math.ceil(0.975 * B) - 1], clusters: n, n: all.length };
}

/** Per-contract realised EV for a take row given the market result ('yes'|'no'). */
export const rowEv = (row, result) => ((row.take === result ? 1 : 0) - row.price - row.fee10);

export function gradeFamily(family, rows, results) {
  const bar = BARS[family]; const takes = rows.filter((r) => r.take && results.get(r.ticker));
  const clusters = new Map(); const events = new Set(); const days = new Set(); const hiVolDays = new Set(); const nonHold = new Set(); const evs = [];
  for (const r of takes) {
    const result = results.get(r.ticker); const ev = rowEv(r, result); evs.push(ev);
    const key = bar.cluster === 'day' ? (r.day ?? r.close.slice(0, 10)) : r.event;
    if (!clusters.has(key)) clusters.set(key, []); clusters.get(key).push(ev);
    events.add(r.event); days.add(r.day ?? r.close.slice(0, 10));
    if (family === 'btc' && r.ref?.dvol > 0.5) hiVolDays.add(r.day ?? r.close.slice(0, 10));
    if (family === 'fed' && results.get(`${r.event}|hold`) === false) nonHold.add(r.event);
  }
  const ci = clusterCi(clusters);
  const checks = {
    events: events.size >= bar.minEvents, takes: takes.length >= (bar.minTakes ?? 0),
    mean: ci.mean !== null && ci.mean * 100 >= bar.minMeanCents, lowerCiPositive: ci.lo !== null && ci.lo > 0,
    ...(bar.minDays ? { days: days.size >= bar.minDays } : {}),
    ...(family === 'btc' ? { highVolWeek: hiVolDays.size >= bar.minHighVolDays } : {}),
    ...(family === 'fed' ? { nonHoldEvents: nonHold.size >= bar.minNonHoldEvents } : {}),
  };
  const retire = events.size >= bar.retireAfterEvents && ci.mean !== null && ci.mean <= 0;
  return {
    family, settledTakeRows: takes.length, settledEvents: events.size, days: days.size, highVolDays: hiVolDays.size, nonHoldEvents: nonHold.size,
    unsettledTakeRows: rows.filter((r) => r.take).length - takes.length,
    meanEvCents: ci.mean === null ? null : round(ci.mean * 100, 2), ci95Cents: ci.lo === null ? null : [round(ci.lo * 100, 2), round(ci.hi * 100, 2)],
    clusters: ci.clusters, checks, admit: Object.values(checks).every(Boolean), retire, bar: bar.note,
  };
}

// Settlement lookups (cached in results.jsonl; one line per settled ticker).
export function loadResults(root) {
  const f = join(root, 'results.jsonl'); const m = new Map();
  if (existsSync(f)) for (const line of readFileSync(f, 'utf8').split('\n')) { if (line) { try { const o = JSON.parse(line); const admitted=binarySettlement(o.market); if(admitted&&Number(o.market.notional_value_dollars)===1&&admitted.ticker===o.ticker&&admitted.result===o.result)m.set(o.ticker, o.result); } catch { /* torn */ } } }
  return m;
}
export async function settle(client, tickers, results, root, { maxCalls = 400 } = {}) {
  let calls = 0;
  for (const ticker of tickers) {
    if (results.has(ticker) || calls >= maxCalls) continue;
    calls += 1;
    try {
      const m = await client.getMarket(ticker);
      if (binarySettlement(m) && Number(m.notional_value_dollars)===1) {
        results.set(ticker, m.result); appendFileSync(join(root, 'results.jsonl'), JSON.stringify({ ticker, result: m.result, market: {ticker:m.ticker,status:m.status,market_type:m.market_type,result:m.result,settlement_ts:m.settlement_ts,settlement_value_dollars:m.settlement_value_dollars,notional_value_dollars:m.notional_value_dollars,is_provisional:m.is_provisional}, t: new Date().toISOString() }) + '\n');
      }
    } catch { /* retry next grade */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  return results;
}
export async function gradeAll({ client, root, families = Object.keys(BARS) }) {
  const results = loadResults(root); const per = {};
  for (const fam of families) {
    const rows = readRows(fam, root); const takeTickers = [...new Set(rows.filter((r) => r.take).map((r) => r.ticker))];
    const extra = fam === 'fed' ? [...new Set(rows.map((r) => r.event + '-H0'))] : [];
    await settle(client, [...takeTickers, ...extra], results, root);
    if (fam === 'fed') for (const ev of new Set(rows.map((r) => r.event))) { const h = results.get(`${ev}-H0`); if (h) results.set(`${ev}|hold`, h === 'yes'); }
    per[fam] = gradeFamily(fam, rows, results);
  }
  return per;
}
export function readoutMarkdown(per, at) {
  const lines = [`# Category shadows admission readout`, `Generated ${at}. Log-only; no family is admitted to capital by this readout alone.`, ''];
  for (const g of Object.values(per)) {
    lines.push(`## ${g.family}: ${g.admit ? 'MEETS BAR' : g.retire ? 'RETIRE' : 'not yet'}`, `- settled would-take rows ${g.settledTakeRows} (unsettled ${g.unsettledTakeRows}), events ${g.settledEvents}, days ${g.days}`, `- mean EV ${g.meanEvCents}c per contract, 95% CI ${JSON.stringify(g.ci95Cents)} (${g.clusters} clusters)`, `- checks ${JSON.stringify(g.checks)}`, `- bar: ${g.bar}`, '');
  }
  return lines.join('\n');
}
