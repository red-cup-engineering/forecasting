#!/usr/bin/env node
/**
 * Crypto combo shadow lane: collect | score.   SHADOW ONLY.
 * Read-only: signed GET /communications/rfqs, public GETs for markets and the trade tape. It never creates,
 * accepts, confirms or deletes an RFQ or quote and never orders. Paced >= 300 ms per request; a 429 backs off
 * (max 5 consecutive) then pauses the loop 60 s.
 *
 *   node scripts/crypto-combo-shadow.mjs collect [--sample 4] [--interval 3] [--hours H]
 *   node scripts/crypto-combo-shadow.mjs score [--from-created]   (default counts prints after the decision time; the flag counts from RFQ creation)
 *
 * Prospective test of records/2026-10-07-crypto-combo-correlation: for every all-crypto-15M combo RFQ, read the leg
 * books at once, price midJoint (Gaussian copula of leg MIDS, rho from the prior 24 h of Binance 1-min returns) and
 * indepMid, and shadow-quote SELL YES at midJoint + 0.02. Prints on the combo ticker are recorded; legs/combos are
 * graded after the window closes.
 *
 * State (append-only JSONL, deduped by id) in ~/.local/state/561-group/settlements/forecasting-service/crypto-shadow/:
 *   rfqs.jsonl       every all-crypto-15M RFQ seen {id,ticker,legs,created,size,sampled,t}
 *   decisions.jsonl  shadow decision rows (or {skip})
 *   prints.jsonl     combo tape prints for decided combos, by trade_id
 *   results.jsonl    {ticker,result} for legs and combo markets
 *   rho.jsonl        hourly correlation snapshots
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createKalshiClient } from '@red-cup-engineering/kalshi-services-section/client';
import { correlationFromReturns } from '../src/crypto-joint.mjs';
import { ASSETS, cryptoRfq, sampled, decide, nextPollAt, comboOutcome, score } from '../src/crypto-combo-shadow-core.mjs';

const dir = process.env.CRYPTO_SHADOW_DIR ?? join(process.env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'crypto-shadow');
const file = (n) => join(dir, n);
const args = process.argv.slice(2); const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? Number(args[i + 1]) : def; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(new Date().toISOString(), ...a);
const append = (name, rows) => { if (rows.length) appendFileSync(file(name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };
const readRows = (name) => (existsSync(file(name)) ? readFileSync(file(name), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);

// ------------------------------------------------------------------ pacing + 429 policy
const raw = createKalshiClient({ minIntervalMs: 300, retries429: 0 });
let consecutive429 = 0;
async function call(path, o = {}) {
  for (;;) {
    try { const r = await raw.call('GET', path, o); consecutive429 = 0; return r; } catch (e) {
      if (e.status !== 429) throw e;
      consecutive429 += 1;
      if (consecutive429 > 5) { log('429 x5: pausing 60 s'); consecutive429 = 0; await sleep(60000); continue; }
      await sleep(1000 * 2 ** (consecutive429 - 1));
    }
  }
}

// ------------------------------------------------------------------ Binance rho
async function klines(sym, endTime) {
  const u = new URL('https://data-api.binance.vision/api/v3/klines');
  u.search = new URLSearchParams({ symbol: `${sym}USDT`, interval: '1m', limit: '1000', ...(endTime ? { endTime: String(endTime) } : {}) });
  const res = await fetch(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`binance ${sym} ${res.status}`);
  return (await res.json()).map((b) => [b[0], +b[1], +b[2], +b[3], +b[4]]);
}
async function refreshRho() {
  const series = {};
  for (const a of ASSETS) {
    const newer = await klines(a); const older = await klines(a, newer[0][0] - 1);
    series[a] = [...older, ...newer]; await sleep(120);
  }
  const now = Date.now(); const c = correlationFromReturns(series, now, 1440);
  append('rho.jsonl', [{ t: now, n: c.n, assets: c.assets, rho: c.rho.map((r) => r.map((v) => +v.toFixed(4))), sigma: c.sigma }]);
  return c;
}

// ------------------------------------------------------------------ collect
async function collect() {
  mkdirSync(dir, { recursive: true });
  const SAMPLE = opt('sample', 4); const interval = opt('interval', 3) * 1000; const endAt = opt('hours', 0) ? Date.now() + opt('hours', 0) * 3600e3 : Infinity;
  const seen = new Set(readRows('rfqs.jsonl').map((r) => r.id));
  const allSeen = new Map(); // id -> createdMs, every RFQ id (any kind) for the early page stop
  const decided = new Set(readRows('decisions.jsonl').map((r) => r.rfqId));
  const printIds = new Set(readRows('prints.jsonl').map((r) => r.trade_id));
  const resolved = new Set(readRows('results.jsonl').filter((r) => r.result).map((r) => r.ticker));
  const polls = new Map(); // combo -> poll state
  const pending = new Map(); // combo -> {legs, closeMs}
  const counts = { listed: 0, crypto: 0, sampled: 0, decided: 0, skipped: 0, prints: 0 };
  const rfqRows = new Map(readRows('rfqs.jsonl').map((r) => [r.id, r]));
  for (const d of readRows('decisions.jsonl')) {
    if (d.skip) continue;
    const r = rfqRows.get(d.rfqId); if (!r) continue;
    pending.set(d.combo, { legs: r.legs, closeMs: d.closeMs });
    if (!polls.has(d.combo) && Date.now() < d.closeMs + 120000) polls.set(d.combo, { combo: d.combo, createdMs: Date.parse(r.created), closeMs: d.closeMs, i: POLL_START(Date.parse(r.created)), final: false });
  }
  let rho = null; let rhoAt = 0; let lastSweep = 0;
  log('collect start', { dir, SAMPLE, known: seen.size, decided: decided.size });
  while (Date.now() < endAt) {
    const loopStart = Date.now();
    try {
      if (!rho || loopStart - rhoAt > 3600e3) { try { rho = await refreshRho(); rhoAt = Date.now(); log('rho refreshed', { n: rho.n }); } catch (e) { log('rho', e.message); if (!rho) { await sleep(10000); continue; } } }
      // 1. new RFQs: open list is newest-first; stop paging at the first page with nothing new.
      const fresh = []; let cursor;
      for (let page = 0; page < 10; page += 1) {
        const p = await call('/communications/rfqs', { query: { limit: 200, status: 'open', cursor } });
        let news = 0;
        for (const q of p.rfqs ?? []) {
          if (allSeen.has(q.id)) continue;
          allSeen.set(q.id, Date.parse(q.created_ts)); news += 1;
          counts.listed += 1;
          const c = cryptoRfq(q); if (!c || seen.has(c.id)) continue;
          counts.crypto += 1; seen.add(c.id);
          const keep = sampled(c.ticker, SAMPLE); if (keep) counts.sampled += 1;
          const row = { id: c.id, ticker: c.ticker, legs: c.legs, created: c.created, size: c.size, sampled: keep, t: Date.now() };
          append('rfqs.jsonl', [row]); rfqRows.set(c.id, row);
          if (keep && Date.now() - c.createdMs < 60000) fresh.push(c);
        }
        cursor = p.cursor; if (!cursor || news === 0) break;
      }
      for (const [id, ms] of allSeen) if (loopStart - ms > 3600e3) allSeen.delete(id);
      // 2. book read + decision, immediately for the new sampled ones (one batched markets call per 100 legs).
      if (fresh.length) {
        const want = [...new Set(fresh.flatMap((c) => c.legs.map((l) => l.m)))]; const byT = {};
        const fetchStart = Date.now();
        for (let i = 0; i < want.length; i += 100) {
          const p = await call('/markets', { query: { tickers: want.slice(i, i + 100).join(','), limit: 100 }, signed: false });
          for (const m of p.markets ?? []) byT[m.ticker] = m;
        }
        const fetchedAt = Date.now();
        for (const c of fresh) {
          if (decided.has(c.id)) continue;
          const d = decide(c, byT, rho, { now: Date.now(), fetchedAt }); d.bookFetchMs = fetchedAt - fetchStart; d.rhoAt = rhoAt;
          decided.add(c.id); append('decisions.jsonl', [d]);
          if (d.skip) { counts.skipped += 1; continue; }
          counts.decided += 1;
          pending.set(c.ticker, { legs: c.legs, closeMs: c.closeMs });
          if (!polls.has(c.ticker)) polls.set(c.ticker, { combo: c.ticker, createdMs: c.createdMs, closeMs: c.closeMs, i: 0, final: false });
        }
      }
      // 3. tape polls for decided combos that are due (a few per loop).
      const now = Date.now();
      const due = [...polls.values()].filter((s) => nextPollAt(s) <= now).sort((a, b) => nextPollAt(a) - nextPollAt(b)).slice(0, 6);
      for (const s of due) {
        const out = [];
        for (let page = 0, cur; page < 3; page += 1) {
          const p = await call('/markets/trades', { query: { ticker: s.combo, min_ts: Math.floor(s.createdMs / 1000) - 5, limit: 1000, cursor: cur }, signed: false });
          for (const tr of p.trades ?? []) if (!printIds.has(tr.trade_id)) { printIds.add(tr.trade_id); out.push({ trade_id: tr.trade_id, ticker: tr.ticker, created_time: tr.created_time, p: Number(tr.yes_price_dollars), n: Number(tr.count_fp), takerYes: tr.taker_outcome_side === 'yes', seen: Date.now() }); }
          cur = p.cursor; if (!cur) break;
        }
        append('prints.jsonl', out); counts.prints += out.length;
        s.last = Date.now(); s.i += 1; if (Date.now() >= s.closeMs + 30000) s.final = true;
        if (s.final) polls.delete(s.combo);
      }
      // 4. result sweep each minute: legs and combos whose window closed >150 s ago.
      if (now - lastSweep > 60000) {
        lastSweep = now; const tk = new Set();
        for (const [combo, v] of pending) { if (now < v.closeMs + 150000) continue; if (!resolved.has(combo)) tk.add(combo); for (const l of v.legs) if (!resolved.has(l.m)) tk.add(l.m); }
        const list = [...tk];
        for (let i = 0; i < list.length; i += 100) {
          const p = await call('/markets', { query: { tickers: list.slice(i, i + 100).join(','), limit: 100 }, signed: false });
          const out = [];
          for (const m of p.markets ?? []) if (m.result === 'yes' || m.result === 'no') { resolved.add(m.ticker); out.push({ t: Date.now(), ticker: m.ticker, result: m.result }); }
          append('results.jsonl', out);
        }
        for (const [combo, v] of pending) if (now > v.closeMs + 150000 && resolved.has(combo) && v.legs.every((l) => resolved.has(l.m))) pending.delete(combo);
        log('status', { ...counts, polls: polls.size, pending: pending.size });
      }
    } catch (e) { log('loop error', e.message); await sleep(5000); }
    const wait = interval - (Date.now() - loopStart); if (wait > 0) await sleep(wait);
  }
  log('collect done', counts);
}
function POLL_START(createdMs) { const age = (Date.now() - createdMs) / 1000; return [4, 10, 20, 40, 80, 160, 320, 600].filter((o) => o <= age).length; }

// ------------------------------------------------------------------ score
function scoreCmd() {
  const results = {}; for (const r of readRows('results.jsonl')) results[r.ticker] = r.result;
  const rfqs = new Map(readRows('rfqs.jsonl').map((r) => [r.id, r]));
  const prints = new Map(); for (const p of readRows('prints.jsonl')) (prints.get(p.ticker) ?? prints.set(p.ticker, []).get(p.ticker)).push(p);
  const seenCombo = new Set(); const rows = []; let unsettled = 0; let rfqsDecided = 0; let skips = 0; const rhoSeen = new Set();
  for (const d of readRows('decisions.jsonl')) {
    if (d.skip) { skips += 1; continue; }
    rfqsDecided += 1;
    if (seenCombo.has(d.combo)) continue; seenCombo.add(d.combo); // one row per combo ticker: first decision
    const r = rfqs.get(d.rfqId); const legs = r.legs;
    const y = comboOutcome(legs, results); const own = results[d.combo];
    if (y === null) { unsettled += 1; continue; }
    if (own && (own === 'yes') !== y) log('combo result disagrees with legs', d.combo);
    const createdMs = Date.parse(r.created); const from = args.includes('--from-created') ? createdMs : d.t; // default: only prints after our book read could be hit by the quote
    const ps = (prints.get(d.combo) ?? []).filter((p) => Date.parse(p.created_time) >= from && Date.parse(p.created_time) <= d.closeMs).sort((a, b) => Date.parse(a.created_time) - Date.parse(b.created_time)).map((p) => ({ p: p.p, takerYes: p.takerYes, ms: Date.parse(p.created_time) }));
    rows.push({ combo: d.combo, window: d.closeMs, y: y ? 1 : 0, midJoint: d.midJoint, indepMid: d.indepMid, ourQuote: d.ourQuote, prints: ps });
  }
  const s = score(rows);
  const rfqsSeen = rfqs.size; const rfqsSampled = [...rfqs.values()].filter((r) => r.sampled).length;
  const f = (x, k = 4) => (Number.isFinite(x) ? x.toFixed(k) : 'NA');
  const pm = (j, k = 4) => `${f(j.est, k)} +- ${f(j.se, k)}`;
  console.log(JSON.stringify({ rfqsSeen, rfqsSampled, decisions: rfqsDecided, skips, combosUnsettled: unsettled, combosSettled: rows.length, windowsSettled: s.windows, combosWithPrint: s.matched, windowsWithPrint: s.windowsMatched, fills: s.filled, windowsFilled: s.windowsFilled, fillRate: +f(s.fillRate, 3), tapePrintsRecorded: [...prints.values()].reduce((a, v) => a + v.length, 0) }));
  console.log('metric (est +- jackknife SE over windows)');
  console.log(`  print - midJoint      ${pm(s.gapPrintMinusMidJoint)}   t=${f(s.gapPrintMinusMidJoint.t, 2)}`);
  console.log(`  print - indepMid      ${pm(s.gapPrintMinusIndep)}`);
  console.log(`  slope print~midJoint  ${pm(s.slopePrintOnMidJoint, 3)}`);
  console.log(`  Brier print           ${pm(s.brier.print)}`);
  console.log(`  Brier midJoint        ${pm(s.brier.midJoint)}`);
  console.log(`  Brier indepMid        ${pm(s.brier.indepMid)}`);
  console.log(`  sell-YES P&L @quote   ${pm(s.pnlAtQuote)} /contract  t=${f(s.pnlAtQuote.t, 2)}  (n=${s.filled}, windows=${s.windowsFilled}, combo-wins(y=0)=${f(s.hitRate, 3)})`);
  console.log(`  sell-YES P&L @print   ${pm(s.pnlAtPrint)} /contract  t=${f(s.pnlAtPrint.t, 2)}`);
}

if (cmd === 'collect') await collect();
else if (cmd === 'score') scoreCmd();
else { console.error('usage: crypto-combo-shadow.mjs collect|score'); process.exit(2); }
