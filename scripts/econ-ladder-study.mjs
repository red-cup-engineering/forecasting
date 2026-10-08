#!/usr/bin/env node
/**
 * Are Kalshi's scheduled-economic-release ladders (CPI, payrolls, unemployment, Fed, GDP, PCE, claims, retail,
 * ISM) calibrated, coherent, and is there a fee-surviving tail rule?  Read-only public data; never orders.
 *
 * PRE-REGISTRATION (written before any price was fetched or computed; committed first):
 *   Universe   every settled event 2023+ of the series listed in SERIES; every binary bracket/threshold market in it.
 *   Quote      yes bid/ask = close of the last 1-minute candlestick with end_period_ts <= close_time - H,
 *              H = 24 h (R1) and 1 h (R2). Candle window is the 72 h before close. Age = H-point minus candle end.
 *   R1         at H = 24 h: for every market with yes bid in [0.03, 0.12], buy NO at 1 - bid, hold to settlement.
 *   R2         the same at H = 1 h.
 *   Net P&L    per contract = [result == no] - (1 - bid) - 0.07 * fee_multiplier(series) * P * (1 - P), P = 1 - bid
 *              (fee_multiplier from GET /series/{ticker}). No fee rounding, no price improvement, unit depth.
 *   Split      event close year 2023-2024 vs 2025-2026.
 *   SE         delete-one-EVENT jackknife on the mean net P&L per contract (an event's brackets are one cluster).
 *              Pooled across series: delete-one-event over all events.
 *   Calibration  two-sided quotes only (bid > 0, ask < 1); mid = (bid+ask)/2; bands fixed below; realised - mid.
 *   Coherence  per event and horizon, the event's markets form a ladder family (thresholds monotone, brackets
 *              partition); Brier of mids before/after `brierProjection` onto the coherent set; Dutch book via
 *              coherence.mjs assessFamily at top-of-book with unit depth, net of fees. "fresh" = every quote
 *              younger than 1 h (H=24) / 5 min (H=1).
 *   Verdict    a rule "works" only if both time halves have positive net mean with jackknife t > 2.
 *
 *   node scripts/econ-ladder-study.mjs collect [--series A,B] [--cache dir]
 *   node scripts/econ-ladder-study.mjs analyze [--cache dir] [--md out.md]
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { brierProjection } from '../src/combo-rigidity.mjs';
import { assessFamily } from '../src/coherence.mjs';
import { ladderFamily, buildLadder, exclusiveFamily, ladderGroups, isNumericStrike, thetaOf } from '../src/coherence-families.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const CACHE = arg('cache', '/tmp/claude-1000/-home-emsenn-info/bfd39b66-66a8-4bd1-abf7-8a75503c9632/scratchpad/econ-cache');
const SERIES = (arg('series', 'KXCPI,KXCPICORE,KXCPIYOY,KXCPICOREYOY,KXU3,KXPAYROLLS,KXFED,KXFEDDECISION,KXGDP,KXPCECORE,KXPCEHEAD,KXJOBLESSCLAIMS,KXJOBLESS,KXRETAIL,KXUSRETAIL,KXISMPMI')).split(',');
const API = 'https://api.elections.kalshi.com/trade-api/v2';
const FIRST_YEAR = 23;
for (const d of ['series', 'events', 'mk', 'q']) mkdirSync(join(CACHE, d), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ---------------------------------------------------------------- http (>= 450 ms pacing, 429 backoff)
class PartialStop extends Error {}
let last = 0; let consecutive429 = 0;
async function kget(path) {
  for (;;) {
    const wait = last + 450 - Date.now(); if (wait > 0) await sleep(wait);
    last = Date.now();
    let r;
    try { r = await fetch(API + path); } catch { await sleep(3000); continue; }
    if (r.status === 429) {
      consecutive429 += 1;
      if (consecutive429 > 5) throw new PartialStop(`5 consecutive 429s at ${path}`);
      await sleep(5000 + Math.random() * 15000); continue;
    }
    consecutive429 = 0;
    if (r.status >= 500) { await sleep(3000); continue; }
    if (!r.ok) return { status: r.status };
    return { status: 200, json: await r.json() };
  }
}
const cached = (file, fn) => async () => { if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')); const v = await fn(); if (v !== undefined) writeFileSync(file, JSON.stringify(v)); return v; };

// ---------------------------------------------------------------- collect
const g = (o, k) => num(o?.[`${k}_dollars`] ?? o?.[k]);
function reduceCandles(cs, closeTs, H) {
  const T = closeTs - H;
  let best = null;
  for (const c of cs) if (c.end_period_ts <= T && (!best || c.end_period_ts >= best.end_period_ts)) best = c;
  if (!best) return null;
  const bid = g(best.yes_bid, 'close'); const ask = g(best.yes_ask, 'close');
  return { bid: bid ?? 0, ask: ask ?? 1, age: T - best.end_period_ts };
}

async function collectSeries(s) {
  const seriesJson = await cached(join(CACHE, 'series', `${s}.json`), async () => { const r = await kget(`/series/${s}`); return r.status === 200 ? r.json.series : undefined; })();
  if (!seriesJson) { console.log(`${s}: no series`); return; }
  const events = await cached(join(CACHE, 'events', `${s}.json`), async () => {
    const out = []; let cursor = '';
    do {
      const r = await kget(`/events?series_ticker=${s}&status=settled&limit=200&with_nested_markets=true${cursor ? `&cursor=${cursor}` : ''}`);
      if (r.status !== 200) throw new Error(`events ${s} ${r.status}`);
      out.push(...r.json.events); cursor = r.json.cursor;
    } while (cursor);
    return out;
  })();
  const keep = events.filter((e) => { const m = /-(\d{2})[A-Z]{3}/u.exec(e.event_ticker); return !m || Number(m[1]) >= FIRST_YEAR; });
  console.log(`${s}: ${events.length} settled events, ${keep.length} from 20${FIRST_YEAR}+ (fee_multiplier ${seriesJson.fee_multiplier})`);
  let done = 0;
  for (const e of keep) {
    const live = (e.markets ?? []).length > 0;
    const mk = await cached(join(CACHE, 'mk', `${e.event_ticker}.json`), async () => {
      let ms = e.markets ?? [];
      if (!ms.length) {
        let cursor = '';
        do {
          const r = await kget(`/historical/markets?event_ticker=${e.event_ticker}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
          if (r.status !== 200) throw new Error(`hist markets ${e.event_ticker} ${r.status}`);
          ms.push(...r.json.markets); cursor = r.json.cursor;
        } while (cursor);
      }
      return { event: { event_ticker: e.event_ticker, series_ticker: s, mutually_exclusive: e.mutually_exclusive, category: e.category, title: e.title }, live: ms.length > 0 && live, markets: ms.map((m) => ({ ticker: m.ticker, strike_type: m.strike_type, floor_strike: m.floor_strike ?? null, cap_strike: m.cap_strike ?? null, close_time: m.close_time, result: m.result, status: m.status, expiration_value: m.expiration_value ?? null, market_type: m.market_type })) };
    })();
    for (const m of mk.markets) {
      if (m.result !== 'yes' && m.result !== 'no') continue;
      await cached(join(CACHE, 'q', `${m.ticker.replace(/[^\w.-]/gu, '_')}.json`), async () => {
        const closeTs = Math.floor(Date.parse(m.close_time) / 1000);
        const path = mk.live ? `/series/${s}/markets/${m.ticker}/candlesticks` : `/historical/markets/${m.ticker}/candlesticks`;
        const r = await kget(`${path}?start_ts=${closeTs - 72 * 3600}&end_ts=${closeTs}&period_interval=1`);
        if (r.status !== 200) return { err: r.status };
        const cs = r.json.candlesticks ?? [];
        return { n: cs.length, q24: reduceCandles(cs, closeTs, 24 * 3600), q1: reduceCandles(cs, closeTs, 3600) };
      })();
    }
    done += 1; if (done % 10 === 0) console.log(`  ${s}: ${done}/${keep.length} events`);
  }
}

// ---------------------------------------------------------------- analysis
const BANDS = [[0, 0.03], [0.03, 0.12], [0.12, 0.3], [0.3, 0.7], [0.7, 0.88], [0.88, 0.97], [0.97, 1.0001]];
const THETA0 = 0.07;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** records: [{ev, x}] (x = per-contract value); delete-one-event jackknife of the pooled mean. */
function jackMean(recs) {
  const n = recs.length; if (!n) return { n: 0, events: 0, mean: NaN, se: NaN };
  const byEv = new Map();
  for (const r of recs) { const b = byEv.get(r.ev) ?? { s: 0, c: 0 }; b.s += r.x; b.c += 1; byEv.set(r.ev, b); }
  const S = recs.reduce((a, r) => a + r.x, 0); const m = S / n; const K = byEv.size;
  if (K < 2) return { n, events: K, mean: m, se: NaN };
  const loo = [...byEv.values()].map((b) => (S - b.s) / (n - b.c));
  const lm = mean(loo);
  const se = Math.sqrt(((K - 1) / K) * loo.reduce((a, x) => a + (x - lm) ** 2, 0));
  return { n, events: K, mean: m, se };
}
const fmt = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const half = (ev) => (Number(/-(\d{2})/u.exec(ev.event_ticker)?.[1] ?? 0) <= 24 ? 'H1' : 'H2'); // 2023-2024 vs 2025-2026

function loadAll() {
  const out = [];
  for (const s of SERIES) {
    const sf = join(CACHE, 'series', `${s}.json`); if (!existsSync(sf)) continue;
    const series = JSON.parse(readFileSync(sf, 'utf8'));
    const events = JSON.parse(readFileSync(join(CACHE, 'events', `${s}.json`), 'utf8'));
    for (const e of events) {
      const mf = join(CACHE, 'mk', `${e.event_ticker}.json`); if (!existsSync(mf)) continue;
      const mk = JSON.parse(readFileSync(mf, 'utf8'));
      const markets = [];
      for (const m of mk.markets) {
        if (m.result !== 'yes' && m.result !== 'no') continue;
        const qf = join(CACHE, 'q', `${m.ticker.replace(/[^\w.-]/gu, '_')}.json`); if (!existsSync(qf)) continue;
        const q = JSON.parse(readFileSync(qf, 'utf8')); if (q.err) continue;
        markets.push({ ...m, y: m.result === 'yes' ? 1 : 0, q24: q.q24, q1: q.q1 });
      }
      if (markets.length) out.push({ series, event: mk.event, markets, half: half(mk.event), year: 2000 + Number(/-(\d{2})/u.exec(e.event_ticker)?.[1] ?? 0) });
    }
  }
  return out;
}

function analyzeEventCoherence(ev, hz, fresh) {
  const H = hz === 'q24' ? 'q24' : 'q1';
  const maxAge = fresh ? (H === 'q24' ? 3600 : 300) : Infinity;
  const rows = ev.markets.filter((m) => isNumericStrike(m) && m[H] && m[H].bid > 0 && m[H].ask < 1 && m[H].age <= maxAge);
  const syn = (m) => ({ ticker: m.ticker, strike_type: m.strike_type, floor_strike: m.floor_strike, cap_strike: m.cap_strike, yes_bid_dollars: m[H].bid, yes_ask_dollars: m[H].ask, yes_bid_size_fp: '1', yes_ask_size_fp: '1' });
  const event = { event_ticker: ev.event.event_ticker, series_ticker: ev.event.series_ticker, mutually_exclusive: ev.event.mutually_exclusive, markets: rows.map(syn) };
  const groups = ladderGroups(event);
  let res = null;
  for (const [subject, ms] of groups) {
    if (ms.length < 3) continue;
    const lad = buildLadder(event, subject, ms, ev.series);
    if (lad.skipped) continue;
    const fam = ladderFamily(lad);
    const mids = fam.markets.map((fm) => { const m = ms.find((x) => x.ticker === fm.id); return (num(m.yes_bid_dollars) + num(m.yes_ask_dollars)) / 2; });
    const y = fam.markets.map((fm) => rows.find((r) => r.ticker === fm.id).y);
    const p = brierProjection(fam.nCells, fam.markets.map((fm) => fm.cells), mids, {});
    const brier = (v) => v.reduce((a, x, i) => a + (x - y[i]) ** 2, 0);
    const a = assessFamily(fam);
    res = { n: mids.length, distance2: p.distance2, brierMid: brier(mids), brierProj: brier(p.prices), verdict: a.verdict, margin: a.margin, dbProfit: a.verdict === 'dutch-book' ? Math.max(0, a.lpProfitAfterFees ?? 0) : 0, dbPortfolio: a.portfolio ? a.portfolio.guaranteed : 0, dbRaw: a.verdict === 'dutch-book' ? (a.unitProfitBeforeFees ?? 0) : 0 };
    break; // one ladder per event in these series
  }
  if (!res && ev.event.mutually_exclusive) {
    const nonNum = ev.markets.filter((m) => m[H] && m[H].bid > 0 && m[H].ask < 1 && m[H].age <= maxAge && !isNumericStrike(m));
    if (nonNum.length >= 2) {
      const e2 = { event_ticker: ev.event.event_ticker, series_ticker: ev.event.series_ticker, mutually_exclusive: true, category: ev.event.category, markets: nonNum.map((m) => ({ ticker: m.ticker, strike_type: m.strike_type, yes_bid_dollars: m[H].bid, yes_ask_dollars: m[H].ask, yes_bid_size_fp: '1', yes_ask_size_fp: '1' })) };
      const fam = exclusiveFamily(e2, ev.series);
      if (fam) {
        const mids = fam.markets.map((fm) => { const m = nonNum.find((x) => x.ticker === fm.id); return (m[H].bid + m[H].ask) / 2; });
        const y = fam.markets.map((fm) => nonNum.find((x) => x.ticker === fm.id).y);
        const p = brierProjection(fam.nCells, fam.markets.map((fm) => fm.cells), mids, {});
        const brier = (v) => v.reduce((a, x, i) => a + (x - y[i]) ** 2, 0);
        const a = assessFamily(fam);
        res = { n: mids.length, distance2: p.distance2, brierMid: brier(mids), brierProj: brier(p.prices), verdict: a.verdict, margin: a.margin, dbProfit: a.verdict === 'dutch-book' ? Math.max(0, a.lpProfitAfterFees ?? 0) : 0, dbPortfolio: a.portfolio ? a.portfolio.guaranteed : 0, dbRaw: a.verdict === 'dutch-book' ? (a.unitProfitBeforeFees ?? 0) : 0, exclusive: true };
      }
    }
  }
  return res;
}

function analyze() {
  const all = loadAll();
  const md = [];
  const P = (s = '') => { md.push(s); console.log(s); };
  const bySeries = new Map();
  for (const e of all) { if (!bySeries.has(e.series.ticker)) bySeries.set(e.series.ticker, []); bySeries.get(e.series.ticker).push(e); }

  P('## Coverage');
  P('| series | title | events | 2023-24 | 2025-26 | markets | with q24 | with q1 | fee_mult |');
  P('|---|---|---|---|---|---|---|---|---|');
  for (const [t, evs] of bySeries) {
    const ms = evs.flatMap((e) => e.markets);
    P(`| ${t} | ${evs[0].series.title} | ${evs.length} | ${evs.filter((e) => e.half === 'H1').length} | ${evs.filter((e) => e.half === 'H2').length} | ${ms.length} | ${ms.filter((m) => m.q24).length} | ${ms.filter((m) => m.q1).length} | ${evs[0].series.fee_multiplier} |`);
  }

  // ---- calibration
  for (const hz of ['q24', 'q1']) {
    P(`\n## Calibration by mid band, ${hz === 'q24' ? '24 h' : '1 h'} before close (two-sided quotes; realised - mid, jackknife SE by event)`);
    const pooled = [];
    const sections = [...bySeries.entries(), ['ALL', all]];
    P('| series | band | n | events | mean mid | realised | realised - mid | SE | t |');
    P('|---|---|---|---|---|---|---|---|---|');
    for (const [t, evs] of sections) {
      for (const [lo, hi] of BANDS) {
        const recs = [];
        const mids = [];
        for (const e of evs) for (const m of e.markets) {
          const q = m[hz]; if (!q || !(q.bid > 0) || !(q.ask < 1)) continue;
          const mid = (q.bid + q.ask) / 2; if (mid < lo || mid >= hi) continue;
          recs.push({ ev: e.event.event_ticker, x: m.y - mid }); mids.push(mid);
        }
        if (recs.length < 8) continue;
        const j = jackMean(recs);
        P(`| ${t} | [${lo},${Math.min(hi, 1)}) | ${j.n} | ${j.events} | ${fmt(mean(mids))} | ${fmt(mean(mids) + j.mean)} | ${fmt(j.mean)} | ${fmt(j.se)} | ${fmt(j.mean / j.se, 1)} |`);
      }
      pooled.push(t);
    }
  }

  // ---- coherence
  const cohRows = [];
  for (const hz of ['q24', 'q1']) for (const fresh of [false, true]) {
    P(`\n## Coherence, ${hz === 'q24' ? '24 h' : '1 h'}, ${fresh ? 'fresh quotes only' : 'all quotes'} (ladders with >= 3 two-sided markets)`);
    P('| series | ladders | incoherent mids (dist2>1e-6) | Brier mid (per mkt) | Brier projected | gain/mkt | gain SE | glue margin<0 | Dutch book net>0.005 | mean net DB $/unit | max DB $ |');
    P('|---|---|---|---|---|---|---|---|---|---|---|');
    const sections = [...bySeries.entries(), ['ALL', all]];
    for (const [t, evs] of sections) {
      const rs = [];
      for (const e of evs) { const r = analyzeEventCoherence(e, hz, fresh); if (r) rs.push({ ev: e.event.event_ticker, r }); }
      if (!rs.length) continue;
      const n = rs.reduce((a, x) => a + x.r.n, 0);
      const bm = rs.reduce((a, x) => a + x.r.brierMid, 0) / n; const bp = rs.reduce((a, x) => a + x.r.brierProj, 0) / n;
      // gain per market, clustered by event: jackknife over ladders (1 per event) of sum gain / sum n
      const gains = rs.map((x) => ({ g: x.r.brierMid - x.r.brierProj, n: x.r.n }));
      const G = gains.reduce((a, x) => a + x.g, 0); const loo = gains.map((x) => (G - x.g) / (n - x.n)); const lm = mean(loo);
      const se = Math.sqrt(((gains.length - 1) / gains.length) * loo.reduce((a, x) => a + (x - lm) ** 2, 0));
      const inc = rs.filter((x) => x.r.distance2 > 1e-6).length;
      const neg = rs.filter((x) => x.r.margin !== null && x.r.margin < -1e-9).length;
      const db = rs.filter((x) => x.r.dbProfit > 0.005);
      P(`| ${t} | ${rs.length} | ${inc} (${fmt(inc / rs.length * 100, 0)}%) | ${fmt(bm)} | ${fmt(bp)} | ${fmt(G / n, 5)} | ${fmt(se, 5)} | ${neg} (${fmt(neg / rs.length * 100, 0)}%) | ${db.length} (${fmt(db.length / rs.length * 100, 0)}%) | ${fmt(db.length ? mean(db.map((x) => x.r.dbProfit)) : 0, 3)} | ${fmt(Math.max(0, ...db.map((x) => x.r.dbProfit)), 3)} |`);
      cohRows.push({ hz, fresh, t, ladders: rs.length, inc, neg, db: db.length });
    }
  }

  // ---- rules
  const feeOf = (series, P1) => THETA0 * (num(series.fee_multiplier) ?? 1) * P1 * (1 - P1);
  for (const [rule, hz] of [['R1', 'q24'], ['R2', 'q1']]) {
    P(`\n## ${rule}: buy NO at 1 - bid on markets with bid in [0.03, 0.12], ${hz === 'q24' ? '24 h' : '1 h'} before close, hold to settlement; net of taker fee`);
    P('| series | half | contracts | events | price paid (NO) | NO win rate | gross/contract | fee/contract | net/contract | SE | t | net ROI |');
    P('|---|---|---|---|---|---|---|---|---|---|---|---|');
    const sections = [...bySeries.entries(), ['ALL', all]];
    for (const [t, evs] of sections) {
      for (const h of ['H1', 'H2', 'both']) {
        const recs = []; const price = []; const win = []; const fees = [];
        for (const e of evs) { if (h !== 'both' && e.half !== h) continue; for (const m of e.markets) {
          const q = m[hz]; if (!q || q.bid < 0.03 || q.bid > 0.12) continue;
          const paid = 1 - q.bid; const fee = feeOf(e.series, paid);
          const pnl = (m.y === 0 ? 1 : 0) - paid - fee;
          recs.push({ ev: e.event.event_ticker, x: pnl }); price.push(paid); win.push(m.y === 0 ? 1 : 0); fees.push(fee);
        } }
        if (recs.length < 5) continue;
        const j = jackMean(recs);
        P(`| ${t} | ${h === 'H1' ? '2023-24' : h === 'H2' ? '2025-26' : 'all'} | ${j.n} | ${j.events} | ${fmt(mean(price))} | ${fmt(mean(win))} | ${fmt(mean(win) - mean(price))} | ${fmt(mean(fees))} | ${fmt(j.mean)} | ${fmt(j.se)} | ${fmt(j.mean / j.se, 1)} | ${fmt(j.mean / mean(price), 3)} |`);
      }
    }
  }
  const out = arg('md', null); if (out) writeFileSync(out, md.join('\n') + '\n');
}

const cmd = process.argv[2];
if (cmd === 'collect') {
  try { for (const s of SERIES) await collectSeries(s); console.log('collect complete'); }
  catch (e) { if (e instanceof PartialStop) console.log(`STOPPED (partial): ${e.message}`); else throw e; }
} else if (cmd === 'analyze') analyze();
else console.log('usage: collect | analyze');
