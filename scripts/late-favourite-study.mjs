#!/usr/bin/env node
// Late-favourite study: does buying a game-winner favourite at the ask in the final hours and holding to
// settlement earn a net edge?  Public read-only data, never an order.  See
// data/records/2026-10-07-late-favourite/README.md for the pre-registered rules and results.
//
//   node late-favourite-study.mjs fetch   [--cache DIR] [--only SERIES,SERIES]     (resumable)
//   node late-favourite-study.mjs tape    [--cache DIR] [--n 50]                   (trade-tape fill check)
//   node late-favourite-study.mjs analyze [--cache DIR] [--insample late-rows.json] [--out FILE]
//
// Pacing: >= 450 ms between requests; HTTP 429 -> wait 5-20 s, at most 5 consecutive, then stop with partial results.
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createKalshiClient } from '../../../src/client.mjs';

// ---------------------------------------------------------------- pre-registered rules (fixed before OOS was read)
export const RULES = [
  { id: 'R1', lo: 0.95, hi: 0.985, window: 'W1' }, // ask in [0.95, 0.985], within 240 min of last two-sided minute
  { id: 'R2', lo: 0.90, hi: 0.9499, window: 'W1' }, // ask in [0.90, 0.95)
  { id: 'R1rt', lo: 0.95, hi: 0.985, window: 'W2' }, // same band, any minute of the 6 h before close (no look-ahead on the end)
  { id: 'R2rt', lo: 0.90, hi: 0.9499, window: 'W2' },
];
export const SIZES = [10, 100];
const W1_MIN = 240; // minutes before last two-sided minute
const FETCH_BEFORE_CLOSE_S = 6 * 3600;
const DAY = 86400;
const iso = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 1000);
export const SETS = {
  oosA: { lo: iso('2026-08-01'), hi: iso('2026-09-05'), series: ['KXMLBGAME', 'KXWNBAGAME', 'KXNCAAFGAME', 'KXNFLGAME'] },
  oosB: { lo: iso('2026-09-05'), hi: iso('2026-10-07'), series: ['KXNHLGAME', 'KXWNBAGAME', 'KXEPLGAME', 'KXUCLGAME', 'KXLALIGAGAME', 'KXSERIEAGAME', 'KXBUNDESLIGAGAME', 'KXLIGUE1GAME', 'KXMLSGAME', 'KXATPMATCH', 'KXWTAMATCH'] },
};
const HIST_CUTOFF = iso('2026-08-08');

// ---------------------------------------------------------------- fee and statistics
export const fee$ = (mult, C, P) => Math.ceil(0.07 * mult * C * P * (1 - P) * 100 - 1e-9) / 100; // ceil to the cent, per order
const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const quant = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
/** Delete-one-cluster jackknife SE of the ratio (sum of v)/(sum of n) over clusters. */
function jackSE(clusters) {
  const g = clusters.length; if (g < 2) return null;
  const V = clusters.reduce((s, c) => s + c.v, 0), N = clusters.reduce((s, c) => s + c.n, 0);
  const th = clusters.map((c) => (V - c.v) / (N - c.n || 1)); const bar = mean(th);
  return Math.sqrt(((g - 1) / g) * th.reduce((s, t) => s + (t - bar) ** 2, 0));
}
const clusterBy = (entries, keyf, valf) => { const m = new Map(); for (const e of entries) { const k = keyf(e); const c = m.get(k) ?? { v: 0, n: 0 }; c.v += valf(e); c.n += 1; m.set(k, c); } return [...m.values()]; };
const dayOf = (event) => { const m = /-(\d\d)([A-Z]{3})(\d\d)/.exec(event); return m ? m[1] + m[2] + m[3] : 'unk'; };

// ---------------------------------------------------------------- the rules applied to one market
/** market = {series, event, ticker, y, c: [[tsSec, bid, ask, vol]...]} (candles sorted by ts; ts relative or absolute). */
export function entryFor(market, rule) {
  const two = market.c.filter(([, b, a]) => a < 1 && b > 0 && a > 0);
  if (!two.length) return null;
  const endTs = two[two.length - 1][0];
  for (let i = 0; i < two.length; i += 1) {
    const [ts, bid, ask, vol] = two[i];
    const mins = (endTs - ts) / 60;
    if (rule.window === 'W1' && mins > W1_MIN) continue;
    if (ask < rule.lo - 1e-9 || ask > rule.hi + 1e-9) continue;
    // stay age: minutes since the mid was last below the band's lower edge (censored at the data start)
    let k = i - 1; while (k >= 0 && (two[k][1] + two[k][2]) / 2 >= rule.lo - 0.0025) k -= 1;
    const stayAge = k < 0 ? (ts - two[0][0]) / 60 : (ts - two[k][0]) / 60, censored = k < 0;
    const next5 = two.filter(([t]) => t > ts && t <= ts + 300).reduce((s, r) => s + (r[3] ?? 0), 0);
    return { series: market.series, event: market.event, ticker: market.ticker, day: dayOf(market.event), ts, ask, y: market.y, holdMin: mins, stayAge, censored, vol0: vol, vol5: next5 };
  }
  return null;
}

// ---------------------------------------------------------------- Kalshi access with the house client (public, unsigned)
function makeGetter(statePath) {
  const client = createKalshiClient({ credentials: null, minIntervalMs: 450, retries429: 0 });
  let consecutive429 = 0;
  const get = async (path, query) => {
    for (;;) {
      try { const r = await client.call('GET', path, { query, signed: false }); consecutive429 = 0; return r; } catch (e) {
        if (e.code !== 'http-429') throw e;
        consecutive429 += 1;
        if (consecutive429 > 5) { const err = new Error('429 x5: stopping with partial results'); err.partial = true; throw err; }
        await new Promise((r) => setTimeout(r, (5 + Math.random() * 15) * 1000));
      }
    }
  };
  return { get, client };
}
async function listMarkets(get, series, lo, hi) {
  const out = []; let cursor;
  for (;;) {
    const d = await get('/markets', { series_ticker: series, status: 'settled', min_close_ts: lo, max_close_ts: hi, limit: 1000, cursor });
    out.push(...d.markets); cursor = d.cursor; if (!cursor || !d.markets.length) break;
  }
  return out;
}
const num = (x) => (x == null || x === '' ? 0 : Number(x));
const compact = (cs) => cs.map((k) => [k.end_period_ts, num(k.yes_bid?.close_dollars), num(k.yes_ask?.close_dollars), num(k.volume_fp)]);

// ---------------------------------------------------------------- fetch
async function cmdFetch(cache, only) {
  mkdirSync(cache, { recursive: true });
  const { get } = makeGetter();
  try {
    for (const [name, set] of Object.entries(SETS)) {
      for (const series of set.series) {
        if (only && !only.includes(series)) continue;
        const listF = join(cache, `${name}-${series}.markets.json`), rowsF = join(cache, `${name}-${series}.jsonl`);
        let markets;
        if (existsSync(listF)) markets = JSON.parse(readFileSync(listF, 'utf8'));
        else { markets = (await listMarkets(get, series, set.lo, set.hi)).filter((m) => m.result === 'yes' || m.result === 'no').map((m) => ({ ticker: m.ticker, event: m.event_ticker, result: m.result, close: m.close_time })); writeFileSync(listF, JSON.stringify(markets)); }
        const done = new Set(existsSync(rowsF) ? readFileSync(rowsF, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).ticker) : []);
        console.error(series, name, markets.length, 'markets,', done.size, 'cached');
        let n = 0;
        for (const m of markets) {
          if (done.has(m.ticker)) continue;
          const ct = Math.floor(Date.parse(m.close) / 1000);
          let c = [];
          try { c = (await get(`/series/${series}/markets/${m.ticker}/candlesticks`, { start_ts: ct - FETCH_BEFORE_CLOSE_S, end_ts: ct, period_interval: 1 })).candlesticks ?? []; } catch (e) { if (e.partial) throw e; console.error('skip', m.ticker, e.message); continue; }
          appendFileSync(rowsF, JSON.stringify({ series, event: m.event, ticker: m.ticker, y: m.result === 'yes' ? 1 : 0, ct, c: compact(c) }) + '\n');
          if (++n % 200 === 0) console.error(series, n, 'fetched');
        }
      }
    }
    console.error('fetch complete');
  } catch (e) { if (e.partial) { console.error(e.message); process.exitCode = 3; } else throw e; }
}

// ---------------------------------------------------------------- load + analyze
function loadOOS(cache) {
  const all = [];
  for (const f of readdirSync(cache).filter((x) => x.endsWith('.jsonl') && x.startsWith('oos'))) {
    const set = f.startsWith('oosA') ? 'oosA' : 'oosB';
    for (const l of readFileSync(join(cache, f), 'utf8').split('\n').filter(Boolean)) { const m = JSON.parse(l); m.set = set; all.push(m); }
  }
  return all;
}
function loadInSample(path) {
  const rows = JSON.parse(readFileSync(path, 'utf8')), markets = []; let cur = null, prev = Infinity;
  for (const [series, event, mins, mid, y, ask, bid] of rows) {
    if (!cur || event !== cur.event || series !== cur.series || mins >= prev) { cur = { series, event, ticker: `${event}#${markets.length}`, y, c: [], set: 'in' }; markets.push(cur); }
    cur.c.push([-mins * 60, bid, ask, null]); prev = mins;
  }
  return markets;
}
const SERIES_MULT = { KXMLBGAME: 0.5 }; // overwritten from GET /series/{ticker} by fetchFees; 1 otherwise
async function fetchFees(cache, seriesList) {
  const f = join(cache, 'fee-multipliers.json'); const have = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  const missing = seriesList.filter((s) => !(s in have));
  if (missing.length) { const { get } = makeGetter(); for (const s of missing) have[s] = Number((await get(`/series/${s}`)).series.fee_multiplier ?? 1); writeFileSync(f, JSON.stringify(have, null, 1)); }
  return have;
}
function stats(entries, mults, sizeSet = SIZES) {
  const n = entries.length; if (!n) return { n: 0 };
  const events = new Set(entries.map((e) => e.event)).size;
  const hit = mean(entries.map((e) => e.y));
  const gross = mean(entries.map((e) => e.y - e.ask));
  const out = { n, events, hit, avgAsk: mean(entries.map((e) => e.ask)), gross };
  for (const C of sizeSet) {
    const net = (e) => e.y - e.ask - fee$(mults[e.series] ?? 1, C, e.ask) / C;
    out[`net${C}`] = mean(entries.map(net));
    out[`seEvent${C}`] = jackSE(clusterBy(entries, (e) => e.event, net));
    out[`seDay${C}`] = jackSE(clusterBy(entries, (e) => e.day, net));
    out[`roc${C}`] = mean(entries.map((e) => net(e) / (e.ask + fee$(mults[e.series] ?? 1, C, e.ask) / C)));
  }
  out.hold = [0.1, 0.5, 0.9].map((q) => quant(entries.map((e) => e.holdMin), q));
  return out;
}
/** Empirical Kelly at the event-cluster grain: maximise mean log(1 + f r_cluster), r = cluster pnl / cluster capital. */
function kelly(entries, mults, C) {
  const m = new Map();
  for (const e of entries) { const cost = e.ask + fee$(mults[e.series] ?? 1, C, e.ask) / C; const c = m.get(e.event) ?? { pnl: 0, cost: 0 }; c.pnl += e.y - cost; c.cost += cost; m.set(e.event, c); }
  const r = [...m.values()].map((c) => c.pnl / c.cost);
  const g = (f) => mean(r.map((x) => Math.log(1 + f * x)));
  let best = 0, bestV = 0; const minR = Math.min(...r);
  const fmax = minR < 0 ? 0.999 / -minR : 50;
  for (let f = 0.001; f < fmax; f += 0.001) { const v = g(f); if (v > bestV) { bestV = v; best = f; } }
  const losses = r.filter((x) => x < 0).length;
  return { clusters: r.length, lossClusters: losses, pLoss: losses / r.length, meanR: mean(r), fStar: best, growthAtFStar: bestV, growthAt15: g(Math.min(1.5 * best, fmax * 0.99)) };
}
function analyze(markets, mults) {
  const res = {};
  for (const rule of RULES) {
    const ent = markets.map((m) => entryFor(m, rule)).filter(Boolean);
    const bySeries = {}; for (const s of new Set(ent.map((e) => e.series))) bySeries[s] = stats(ent.filter((e) => e.series === s), mults);
    const age = {};
    for (const [label, f] of [['stay<10m', (e) => e.stayAge < 10], ['stay10-60m', (e) => e.stayAge >= 10 && e.stayAge < 60], ['stay60-240m', (e) => e.stayAge >= 60 && e.stayAge < 240], ['stay>=240m(or censored)', (e) => e.stayAge >= 240]]) age[label] = stats(ent.filter(f), mults);
    const fill = ent.some((e) => e.vol0 != null) ? Object.fromEntries(SIZES.map((C) => [C, { minute: mean(ent.map((e) => (e.vol0 >= C ? 1 : 0))), plus5: mean(ent.map((e) => (e.vol0 + e.vol5 >= C ? 1 : 0))) }])) : null;
    res[rule.id] = { rule, all: stats(ent, mults), bySeries, age, fill, kelly: Object.fromEntries(SIZES.map((C) => [C, kelly(ent, mults, C)])), entries: ent.length };
  }
  return res;
}

/** Exploratory (not pre-registered): every two-sided minute within 240 min of the end, realised minus mid, by band, stay age and time to end. */
function minuteCalib(markets) {
  const bands = [['mid[0.90,0.95)', 0.90, 0.95], ['mid[0.95,0.99]', 0.95, 0.9901]];
  const rows = [];
  for (const m of markets) {
    const two = m.c.filter(([, b, a]) => a < 1 && b > 0 && a > 0); if (!two.length) continue;
    const endTs = two[two.length - 1][0];
    for (let i = 0; i < two.length; i += 1) {
      const [ts, b, a] = two[i], mid = (a + b) / 2, mins = (endTs - ts) / 60; if (mins > W1_MIN) continue;
      for (const [bl, lo, hi] of bands) {
        if (mid < lo || mid >= hi) continue;
        let k = i - 1; while (k >= 0 && (two[k][1] + two[k][2]) / 2 >= lo - 0.0025) k -= 1;
        const age = k < 0 ? Infinity : (ts - two[k][0]) / 60; // Infinity = in band since the data start
        rows.push({ bl, event: m.event, day: dayOf(m.event), y: m.y, mid, mins, age });
      }
    }
  }
  const cell = (sel) => { const r = rows.filter(sel); if (!r.length) return { n: 0 }; const g = (e) => e.y - e.mid; return { n: r.length, events: new Set(r.map((e) => e.event)).size, mid: mean(r.map((e) => e.mid)), hit: mean(r.map((e) => e.y)), gap: mean(r.map(g)), se: jackSE(clusterBy(r, (e) => e.event, g)) }; };
  const ageB = [['age<5m', (e) => e.age < 5], ['5-30m', (e) => e.age >= 5 && e.age < 30], ['30-120m', (e) => e.age >= 30 && e.age < 120], ['>=120m/since start', (e) => e.age >= 120]];
  const minB = [['end-10m', (e) => e.mins < 10], ['10-30m', (e) => e.mins >= 10 && e.mins < 30], ['30-90m', (e) => e.mins >= 30 && e.mins < 90], ['90-240m', (e) => e.mins >= 90]];
  const out = {};
  for (const [bl] of bands) {
    out[bl] = { all: cell((e) => e.bl === bl), byAge: Object.fromEntries(ageB.map(([l, f]) => [l, cell((e) => e.bl === bl && f(e))])), byMinsToEnd: Object.fromEntries(minB.map(([l, f]) => [l, cell((e) => e.bl === bl && f(e))])) };
  }
  return out;
}
async function cmdAnalyze(cache, insample, outFile) {
  const oos = loadOOS(cache), ins = existsSync(insample) ? loadInSample(insample) : [];
  const mults = await fetchFees(cache, [...new Set([...oos, ...ins].map((m) => m.series))]);
  const result = {
    inSample: analyze(ins, mults),
    oosA: analyze(oos.filter((m) => m.set === 'oosA'), mults),
    oosB: analyze(oos.filter((m) => m.set === 'oosB'), mults),
    oosAll: analyze(oos, mults),
    minuteCalib: { inSample: minuteCalib(ins), oosA: minuteCalib(oos.filter((m) => m.set === 'oosA')), oosB: minuteCalib(oos.filter((m) => m.set === 'oosB')) },
    feeMultipliers: mults,
    markets: { in: ins.length, oosA: oos.filter((m) => m.set === 'oosA').length, oosB: oos.filter((m) => m.set === 'oosB').length },
  };
  writeFileSync(outFile, JSON.stringify(result, null, 1));
  console.error('wrote', outFile);
}

// ---------------------------------------------------------------- trade tape: would a taker have filled?
async function cmdTape(cache, n) {
  const oos = loadOOS(cache).filter((m) => m.ct > HIST_CUTOFF + DAY);
  const rule = RULES[0], ents = oos.map((m) => entryFor(m, rule)).filter(Boolean);
  // deterministic shuffle
  let s = 12345; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = ents.map((e) => [rnd(), e]).sort((a, b) => a[0] - b[0]).slice(0, n).map((x) => x[1]);
  const { get } = makeGetter(); const out = [];
  try {
    for (const e of pick) {
      const d = await get('/markets/trades', { ticker: e.ticker, min_ts: e.ts - 60, max_ts: e.ts + 600, limit: 1000 });
      const tr = (d.trades ?? []).map((t) => ({ t: Date.parse(t.created_time) / 1000, p: Number(t.yes_price_dollars), c: Number(t.count_fp), side: t.taker_side }));
      const atOrBelow = (lo, hi) => tr.filter((t) => t.t > lo && t.t <= hi && t.p <= e.ask + 1e-9 && t.side === 'yes').reduce((x, t) => x + t.c, 0);
      const anyAt = (lo, hi) => tr.filter((t) => t.t > lo && t.t <= hi && t.p <= e.ask + 1e-9).reduce((x, t) => x + t.c, 0);
      out.push({ ticker: e.ticker, series: e.series, ts: e.ts, ask: e.ask, takerYesAtOrBelowAsk: { m0: atOrBelow(e.ts - 60, e.ts), p1: atOrBelow(e.ts - 60, e.ts + 60), p5: atOrBelow(e.ts - 60, e.ts + 300) }, anyAtOrBelowAsk: { m0: anyAt(e.ts - 60, e.ts), p5: anyAt(e.ts - 60, e.ts + 300) }, nTrades: tr.length });
    }
  } catch (e) { if (!e.partial) throw e; console.error(e.message); }
  const sum = {}; for (const C of SIZES) for (const k of ['m0', 'p1', 'p5']) sum[`takerYes_${k}_ge${C}`] = mean(out.map((o) => (o.takerYesAtOrBelowAsk[k] >= C ? 1 : 0)));
  for (const C of SIZES) for (const k of ['m0', 'p5']) sum[`any_${k}_ge${C}`] = mean(out.map((o) => (o.anyAtOrBelowAsk[k] >= C ? 1 : 0)));
  writeFileSync(join(cache, 'tape-sample.json'), JSON.stringify({ n: out.length, summary: sum, rows: out }, null, 1));
  console.error(JSON.stringify({ n: out.length, ...sum }, null, 1));
}

// ---------------------------------------------------------------- cli
if (process.argv[1]?.endsWith('late-favourite-study.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2); const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
  const scratch = '/tmp/claude-1000/-home-emsenn-info/bfd39b66-66a8-4bd1-abf7-8a75503c9632/scratchpad';
  const cache = opt('--cache', join(scratch, 'late-oos'));
  if (cmd === 'fetch') await cmdFetch(cache, opt('--only')?.split(','));
  else if (cmd === 'tape') await cmdTape(cache, Number(opt('--n', 50)));
  else if (cmd === 'analyze') await cmdAnalyze(cache, opt('--insample', join(scratch, 'late-rows.json')), opt('--out', join(cache, 'results.json')));
  else { console.error('usage: fetch | tape | analyze'); process.exitCode = 2; }
}
