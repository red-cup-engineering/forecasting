#!/usr/bin/env node
/**
 * Is thin-book market making plus Kalshi liquidity-incentive rewards a lane?  READ-ONLY, public GETs only, never orders.
 *
 *   node scripts/maker-incentives-study.mjs programs            # GET /incentive_programs, all statuses -> cache/programs.json
 *   node scripts/maker-incentives-study.mjs now [--n 250]       # live books + family fair values for covered markets -> cache/now.json
 *   node scripts/maker-incentives-study.mjs history [--n 160]   # fetch tape + candles for closed-program markets -> cache/hist/
 *   node scripts/maker-incentives-study.mjs simulate            # resting-quote shadow over cache/hist -> cache/sim.json
 *   node scripts/maker-incentives-study.mjs report              # markdown tables from the caches
 *
 * Rules (help.kalshi.com 13823851, "Liquidity Incentive Program"): per second-snapshot, per side, reference price =
 * first level walking down from the best bid where cumulative size >= target/5; qualifying orders = those that
 * help reach `target` from the top; raw = size * d^(ticks below reference); share = raw / sum raw; snapshot score =
 * yes share + no share; a snapshot is excluded unless BOTH sides reach target; reward = score share * pool * (non-excluded / total).
 * Pace >= 400 ms; 429 backs off, 5 consecutive stops with partial results.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = 'https://api.elections.kalshi.com/trade-api/v2';
const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// ------------------------------------------------------------------ pure rules

/**
 * Score one side of a snapshot.  `levels`: [{p: price in dollars, size}] bids on this side (any order).
 * `mine`: optional {p, size} inserted last at its level.  Returns {ref, qualified, total, mineRaw, share}.
 */
export function lipSide(levels, target, d, mine = null, tick = 0.01) {
  const book = new Map();
  for (const { p, size } of levels) book.set(p, (book.get(p) ?? 0) + size);
  const ids = []; // [price, size, isMine]
  const sorted = [...book.entries()].sort((a, b) => b[0] - a[0]);
  let mineAt = false;
  for (const [p, s] of sorted) { ids.push([p, s, false]); if (mine && p === mine.p) { ids.push([p, mine.size, true]); mineAt = true; } }
  if (mine && !mineAt) { ids.push([mine.p, mine.size, true]); ids.sort((a, b) => b[0] - a[0] || (a[2] ? 1 : 0) - (b[2] ? 1 : 0)); }
  let cum = 0; let ref = null;
  for (const [p, s] of ids) { cum += s; if (ref === null && cum >= target / 5 - 1e-9) ref = p; }
  const qualified = cum >= target - 1e-9;
  if (!qualified) return { ref, qualified: false, total: 0, mineRaw: 0, share: 0 };
  let acc = 0; let total = 0; let mineRaw = 0;
  for (const [p, s, isMine] of ids) {
    if (acc >= target - 1e-9) break;
    const take = Math.min(s, target - acc); acc += take;
    const raw = take * d ** Math.max(0, Math.round((ref - p) / tick));
    total += raw; if (isMine) mineRaw += raw;
  }
  return { ref, qualified: true, total, mineRaw, share: total > 0 ? mineRaw / total : 0 };
}

/**
 * Fraction of the pool a resting pair would earn: snapshot score share = (yes share + no share) / 2 of the
 * per-snapshot maximum 2.0, zero when either side is short of target (excluded snapshot).
 */
export function lipPairShare(yesLevels, noLevels, target, d, mineYes, mineNo) {
  const y = lipSide(yesLevels, target, d, mineYes); const n = lipSide(noLevels, target, d, mineNo);
  return { qualified: y.qualified && n.qualified, share: y.qualified && n.qualified ? (y.share + n.share) / 2 : 0, yes: y, no: n };
}

/** Kalshi fee in dollars for `count` at price p: ceil to the cent of rate * C * P(1-P). Maker rate applies to maker-fee series only. */
export const feeOf = (rate, count, p) => (rate === 0 ? 0 : Math.ceil(rate * count * p * (1 - p) * 100 - 1e-9) / 100);
export const makerRate = (feeType, mult = 1) => (feeType === 'quadratic_with_maker_fees' ? 0.0175 * mult : 0);

/** Mean and delete-one-cluster jackknife SE of per-cluster values. */
export function jackknife(values) {
  const n = values.length; if (n < 2) return { n, mean: n ? values[0] : NaN, se: NaN };
  const sum = values.reduce((a, b) => a + b, 0); const mean = sum / n;
  const loo = values.map((v) => (sum - v) / (n - 1));
  const lm = loo.reduce((a, b) => a + b, 0) / n;
  return { n, mean, se: Math.sqrt(((n - 1) / n) * loo.reduce((a, x) => a + (x - lm) ** 2, 0)) };
}

/**
 * Resting-bid fill against the tape (YES-ladder bid at `price`), queue-aware and pessimistic like arena.shadowRest:
 * trades through the price fill without queue; trades at the price consume `ahead` first.
 * trades: [{t, yes, count, takerSide}] chronological, only those after placement.  Returns {fills:[{t,size}], ahead}.
 */
export function restBid(order, trades) {
  let { ahead, size } = order; const fills = [];
  for (const tr of trades) {
    if (tr.takerSide !== 'no' || tr.yes > order.price + 1e-9) continue; // a taker selling YES / buying NO hits YES bids
    let c = tr.count;
    if (tr.yes < order.price - 1e-9) ahead = 0; // traded through: everyone at our level was filled
    const eat = Math.min(ahead, c); ahead -= eat; c -= eat;
    const f = Math.min(c, size - fills.reduce((a, x) => a + x.size, 0));
    if (f > 1e-9) fills.push({ t: tr.t, size: f });
    if (fills.reduce((a, x) => a + x.size, 0) >= size - 1e-9) break;
  }
  return { fills, ahead };
}

// ------------------------------------------------------------------ http (public, paced, 429-aware)

const CACHE = process.env.MAKER_CACHE ?? '/tmp/claude-1000/-home-emsenn-info/bfd39b66-66a8-4bd1-abf7-8a75503c9632/scratchpad/maker-cache';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0; let strikes = 0;
async function get(path, query = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt += 1) {
    const wait = last + 420 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now();
    let res;
    try { res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) }); } catch (e) { if (attempt < 3) { await sleep(1000); continue; } throw e; }
    if (res.status === 429) { strikes += 1; if (strikes >= 5) throw new Error('429 x5: stop with partial results'); await sleep(1000 * 2 ** strikes); continue; }
    strikes = 0;
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    return res.json();
  }
}
const cached = async (key, fn) => { const f = join(CACHE, key); if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')); const v = await fn(); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, JSON.stringify(v)); return v; };
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const slim = (p) => ({ id: p.id, t: p.market_ticker, ty: p.incentive_type, d: p.incentive_description, s: p.start_date, e: p.end_date, r: p.period_reward / 1e4, ts: num(p.target_size_fp), df: p.discount_factor_bps / 1e4, po: p.paid_out, cap: p.max_reward_per_account ?? null });
const days = (p) => (Date.parse(p.e) - Date.parse(p.s)) / 864e5;
const seriesOf = (t) => t.split('-')[0];
const eventOf = (t) => t.split('-').slice(0, 2).join('-');
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// ------------------------------------------------------------------ stage: programs

async function programs() {
  const out = { fetched: new Date().toISOString(), active: [], upcoming: [], closed: [], closedCount: 0, closedByMonth: {} };
  for (const status of ['active', 'upcoming']) {
    let cursor; do { const j = await get('/incentive_programs', { status, limit: 10000, cursor }); out[status].push(...j.incentive_programs.map(slim)); cursor = j.next_cursor; } while (cursor);
  }
  const keepFrom = Date.now() - 45 * 864e5;
  let cursor; let pages = 0;
  do {
    const j = await get('/incentive_programs', { status: 'closed', limit: 10000, cursor }); pages += 1;
    for (const p of j.incentive_programs) {
      out.closedCount += 1; const m = p.end_date.slice(0, 7); out.closedByMonth[m] = (out.closedByMonth[m] ?? 0) + 1;
      if (Date.parse(p.end_date) >= keepFrom) out.closed.push(slim(p));
    }
    cursor = j.next_cursor; process.stderr.write(`closed page ${pages} total ${out.closedCount}\n`);
  } while (cursor && pages < 40);
  out.closedComplete = !cursor;
  mkdirSync(CACHE, { recursive: true }); writeFileSync(join(CACHE, 'programs.json'), JSON.stringify(out));
  console.log(`active ${out.active.length} upcoming ${out.upcoming.length} closed seen ${out.closedCount} kept ${out.closed.length} complete ${out.closedComplete}`);
}

// ------------------------------------------------------------------ stage: now

const levelsOf = (arr) => (arr ?? []).map(([p, s]) => ({ p: Number(p), size: Number(s) }));

async function seriesInfo(s) { return cached(`series/${s}.json`, async () => { const j = await get(`/series/${s}`); return { fee_type: j?.series?.fee_type ?? null, fee_multiplier: j?.series?.fee_multiplier ?? 1 }; }); }

async function now() {
  const P = JSON.parse(readFileSync(join(CACHE, 'programs.json'), 'utf8'));
  const nowMs = Date.now();
  const live = P.active.filter((p) => Date.parse(p.s) <= nowMs + 36e5 && days(p) >= 0.5);
  const byDay = [...live].sort((a, b) => b.r / days(b) - a.r / days(a));
  const N = Number(arg('n', 250)); const rnd = rng(7);
  const top = byDay.slice(0, Math.floor(N * 0.6)); const rest = byDay.slice(top.length).filter(() => rnd() < (N - top.length) / Math.max(1, byDay.length - top.length));
  const sample = [...top, ...rest];
  const rows = []; const events = new Map();
  for (const p of sample) {
    const ob = await cached(`ob-${new Date().toISOString().slice(0, 13)}/${p.t}.json`, async () => (await get(`/markets/${p.t}/orderbook`))?.orderbook_fp ?? null);
    if (!ob) continue;
    const yes = levelsOf(ob.yes_dollars); const no = levelsOf(ob.no_dollars);
    const bid = yes.length ? Math.max(...yes.map((l) => l.p)) : null; const noBid = no.length ? Math.max(...no.map((l) => l.p)) : null;
    const ask = noBid === null ? null : 1 - noBid;
    const at = (ls, p) => ls.filter((l) => Math.abs(l.p - p) < 1e-9).reduce((a, l) => a + l.size, 0);
    const near = (ls, top) => ls.filter((l) => top !== null && l.p >= top - 0.05 - 1e-9).reduce((a, l) => a + l.size, 0);
    const se = await seriesInfo(seriesOf(p.t));
    const row = { t: p.t, ev: eventOf(p.t), ser: seriesOf(p.t), kind: p.d || 'adhoc', pool: p.r, dur: days(p), perDay: p.r / days(p), target: p.ts, df: p.df, bid, ask, spread: bid !== null && ask !== null ? ask - bid : null, bidSz: bid === null ? 0 : at(yes, bid), askSz: noBid === null ? 0 : at(no, noBid), yesNear: near(yes, bid), noNear: near(no, noBid), yesDepth: yes.reduce((a, l) => a + l.size, 0), noDepth: no.reduce((a, l) => a + l.size, 0), feeType: se.fee_type, feeMult: se.fee_multiplier };
    // join-touch pair at size S: yes bid at best yes bid, no bid at best no bid (= YES ask); empty side seeds at 0.45/0.45
    row.share = {};
    for (const S of [100, 1000]) {
      const my = bid ?? 0.45; const mn = noBid ?? 0.45;
      const r = lipPairShare(yes, no, p.ts, p.df, { p: my, size: S }, { p: mn, size: S });
      const base = lipPairShare(yes, no, p.ts, p.df, null, null);
      row.share[S] = { share: r.share, qualified: r.qualified, baseQualified: base.qualified, capital: S * my + S * mn };
    }
    rows.push(row);
    if (!events.has(row.ev)) events.set(row.ev, []);
    events.get(row.ev).push(row);
  }
  // family fair values
  const { brierProjection } = await import('../src/combo-rigidity.mjs');
  const { ladderGroups, buildLadder, ladderFamily, exclusiveFamily, isNumericStrike } = await import('../src/coherence-families.mjs');
  for (const [evT, rs] of events) {
    const j = await cached(`ev-${new Date().toISOString().slice(0, 13)}/${evT}.json`, async () => get(`/events/${evT}`, { with_nested_markets: 'true' }));
    if (!j?.event) continue;
    const ev = j.event; const se = await seriesInfo(ev.series_ticker);
    const ms = ev.markets ?? j.markets ?? []; ev.markets = ms;
    const quote = (m) => { const b = num(m.yes_bid_dollars); const a = num(m.yes_ask_dollars); return b > 0 && a < 1 && a > b ? (b + a) / 2 : null; };
    let fam = null; let usable = null;
    const evx = { event_ticker: ev.event_ticker, series_ticker: ev.series_ticker, mutually_exclusive: ev.mutually_exclusive, category: ev.category, markets: ms };
    for (const [subject, g] of ladderGroups(evx)) {
      const two = g.filter((m) => quote(m) !== null); if (two.length < 3) continue;
      const lad = buildLadder(evx, subject, two, se); if (!lad.skipped) { fam = ladderFamily(lad); usable = two; break; }
    }
    let kind = 'ladder';
    if (!fam && ev.mutually_exclusive) {
      const two = ms.filter((m) => quote(m) !== null && !isNumericStrike(m));
      if (two.length >= 2) { fam = exclusiveFamily({ ...evx, markets: two.map((m) => ({ ...m, yes_bid_size_fp: '1', yes_ask_size_fp: '1' })) }, se); usable = two; kind = 'exclusive'; }
    }
    let fair = new Map();
    if (fam) {
      const mids = fam.markets.map((fm) => quote(usable.find((m) => m.ticker === fm.id)));
      const proj = brierProjection(fam.nCells, fam.markets.map((fm) => fm.cells), mids, { iterations: 4000 });
      fam.markets.forEach((fm, i) => fair.set(fm.id, { mid: mids[i], fair: proj.prices[i] }));
    }
    for (const r of rs) {
      r.famKind = fam ? kind : null; r.famN = fam ? fam.markets.length : 0;
      const f = fair.get(r.t); if (f) { r.mid = f.mid; r.fair = f.fair; r.fairGap = f.fair - f.mid; }
    }
  }
  writeFileSync(join(CACHE, 'now.json'), JSON.stringify({ at: new Date().toISOString(), liveCount: live.length, rows }));
  console.log(`books ${rows.length} of ${live.length} live programs; in families ${rows.filter((r) => r.famKind).length}`);
}

// ------------------------------------------------------------------ stage: history (fetch)

async function history() {
  const P = JSON.parse(readFileSync(join(CACHE, 'programs.json'), 'utf8'));
  const nowMs = Date.now(); const N = Number(arg('n', 160)); const rnd = rng(11);
  const pool = P.closed.filter((p) => days(p) >= 0.9 && days(p) <= 32 && Date.parse(p.e) < nowMs && Date.parse(p.e) > nowMs - 28 * 864e5 && !/15M|RANGE15|^KXCRYPTOLEAD/.test(p.t));
  // one event at a time, up to 3 random markets per event, events chosen at random, until N markets
  const byEv = new Map(); for (const p of pool) { const e = eventOf(p.t); if (!byEv.has(e)) byEv.set(e, []); byEv.get(e).push(p); }
  const evs = [...byEv.keys()].sort(() => rnd() - 0.5);
  const pick = []; for (const e of evs) { const ps = byEv.get(e).sort(() => rnd() - 0.5).slice(0, 3); pick.push(...ps); if (pick.length >= N) break; }
  console.log(`pool ${pool.length} programs, ${byEv.size} events; picking ${pick.length}`);
  mkdirSync(join(CACHE, 'hist'), { recursive: true });
  const { brierProjection } = await import('../src/combo-rigidity.mjs');
  void brierProjection;
  for (const p of pick) {
    const f = join(CACHE, 'hist', `${p.t}.json`); if (existsSync(f)) continue;
    const m = (await get(`/markets/${p.t}`))?.market; if (!m) continue;
    if (m.result !== 'yes' && m.result !== 'no') { writeFileSync(f, JSON.stringify({ prog: p, result: '', skip: true })); continue; }
    const end = Math.min(Date.parse(p.e), nowMs) / 1000 | 0; const start = Math.max(Date.parse(p.s) / 1000, nowMs / 1000 - 28 * 86400, end - 12 * 86400) | 0;
    const trades = []; let cursor; let pages = 0;
    do { const j = await get('/markets/trades', { ticker: p.t, min_ts: start, max_ts: end, limit: 1000, cursor }); if (!j) break; for (const t of j.trades) trades.push({ t: Date.parse(t.created_time) / 1000, yes: Number(t.yes_price_dollars), count: Number(t.count_fp), takerSide: t.taker_side }); cursor = j.cursor; pages += 1; } while (cursor && pages < 30);
    trades.sort((a, b) => a.t - b.t);
    const cjs = []; for (let a = start; a < end; a += 6 * 86400) { const cj = await get('/markets/candlesticks', { market_tickers: p.t, start_ts: a, end_ts: Math.min(end, a + 6 * 86400), period_interval: 1 }); cjs.push(...(cj?.markets?.[0]?.candlesticks ?? [])); }
    const candles = cjs.map((c) => [c.end_period_ts, num(c.yes_bid?.close_dollars) ?? 0, num(c.yes_ask?.close_dollars) ?? 1, num(c.volume_fp) ?? 0]);
    const se = await seriesInfo(seriesOf(p.t));
    // sibling candles (5-minute) for the coherence projection, only for events with a ladder or exclusive structure
    const ej = await get(`/events/${eventOf(p.t)}`, { with_nested_markets: 'true' });
    const sib = [];
    if (ej?.event && ej.event.markets.length >= 3 && ej.event.markets.length <= 60) {
      const tick = ej.event.markets.map((x) => x.ticker);
      for (let i = 0; i < tick.length; i += 25) {
        const cs = await get('/markets/candlesticks', { market_tickers: tick.slice(i, i + 25).join(','), start_ts: start, end_ts: end, period_interval: 60 });
        for (const mk of cs?.markets ?? []) sib.push({ t: mk.market_ticker, c: mk.candlesticks.map((c) => [c.end_period_ts, num(c.yes_bid?.close_dollars) ?? 0, num(c.yes_ask?.close_dollars) ?? 1]) });
      }
    }
    const rec = { prog: p, start, end, result: m.result, settleTs: m.settlement_ts ?? null, fee: se, trades, tradePages: pages, candles, ev: ej?.event ? { event_ticker: ej.event.event_ticker, series_ticker: ej.event.series_ticker, mutually_exclusive: ej.event.mutually_exclusive, category: ej.event.category, markets: ej.event.markets.map((x) => ({ ticker: x.ticker, strike_type: x.strike_type, floor_strike: x.floor_strike, cap_strike: x.cap_strike, result: x.result })) } : null, sib };
    writeFileSync(f, JSON.stringify(rec));
    process.stderr.write(`${p.t} trades ${trades.length} candles ${candles.length} sib ${sib.length}\n`);
  }
}

// ------------------------------------------------------------------ stage: simulate

/** Value of a time series [[ts,bid,ask]] at ts t (last candle at or before t), or null. */
function bookAt(candles, t, cursor) {
  while (cursor.i + 1 < candles.length && candles[cursor.i + 1][0] <= t) cursor.i += 1;
  return candles.length && candles[cursor.i][0] <= t ? candles[cursor.i] : null;
}

async function simulate() {
  const { brierProjection } = await import('../src/combo-rigidity.mjs');
  const { ladderGroups, buildLadder, ladderFamily, exclusiveFamily } = await import('../src/coherence-families.mjs');
  const NOW = JSON.parse(readFileSync(join(CACHE, 'now.json'), 'utf8'));
  const touchMed = (() => { const v = NOW.rows.flatMap((r) => [r.bidSz, r.askSz]).filter((x) => x > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 100; })();
  // live join-touch share of the pool, by series (median) and overall, per size
  const med = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const shareBySer = {}; const shareAll = {};
  for (const S of [100, 1000]) {
    shareAll[S] = med(NOW.rows.map((r) => r.share[S].share));
    const g = {}; for (const r of NOW.rows) (g[r.ser] ??= []).push(r.share[S].share); shareBySer[S] = Object.fromEntries(Object.entries(g).map(([k, v]) => [k, med(v)]));
  }
  const queues = { q0: 0, qmed: touchMed, q3: 3 * touchMed };
  const variants = { J: 0, F1: 0.01, F2: 0.02 };
  const results = [];
  for (const f of readdirSync(join(CACHE, 'hist'))) {
    const R = JSON.parse(readFileSync(join(CACHE, 'hist', f), 'utf8'));
    const { prog: p, trades, candles } = R;
    if (R.skip || (R.result !== 'yes' && R.result !== 'no')) continue; // settled only
    const y = R.result === 'yes' ? 1 : 0;
    // coherence fair value on the hour grid
    let fairAt = () => null;
    if (R.ev && R.sib.length >= 3) {
      const evBase = { ...R.ev, event_ticker: R.ev.event_ticker ?? R.ev.ticker };
      const rowsFor = (mids) => R.ev.markets.filter((m) => mids.has(m.ticker) || m.ticker === p.t).map((m) => { const x = mids.get(m.ticker) ?? 0.5; return { ...m, yes_bid_dollars: String(x - 0.005), yes_ask_dollars: String(x + 0.005), yes_bid_size_fp: '1', yes_ask_size_fp: '1' }; });
      const mk = (mids) => {
        const evx = { ...evBase, markets: rowsFor(mids) };
        for (const [subject, g] of ladderGroups(evx)) { if (g.length < 3 || !g.some((m) => m.ticker === p.t)) continue; const lad = buildLadder(evx, subject, g, R.fee); if (!lad.skipped) return ladderFamily(lad); }
        if (R.ev.mutually_exclusive && evx.markets.length >= 3) return exclusiveFamily(evx, R.fee);
        return null;
      };
      const sibMap = new Map(R.sib.map((s2) => [s2.t, { c: s2.c, cur: { i: 0 } }]));
      const cache = new Map();
      fairAt = (t) => {
        const hour = Math.floor(t / 3600);
        if (cache.has(hour)) return cache.get(hour);
        const mids = new Map();
        for (const [tk, s2] of sibMap) { const b2 = bookAt(s2.c, hour * 3600, s2.cur); if (b2 && b2[1] > 0 && b2[2] < 1 && b2[2] > b2[1]) mids.set(tk, (b2[1] + b2[2]) / 2); }
        let out = null; const own = mids.get(p.t);
        if (mids.size - (own === undefined ? 0 : 1) >= 2) {
          const fam = mk(mids);
          const ti = fam ? fam.markets.findIndex((fm) => fm.id === p.t) : -1;
          if (fam && ti >= 0) {
            const fit = fam.markets.map((fm, i) => i).filter((i) => i !== ti || own !== undefined);
            const pr = brierProjection(fam.nCells, fit.map((i) => fam.markets[i].cells), fit.map((i) => mids.get(fam.markets[i].id)), { iterations: 3000 });
            const price = own !== undefined ? pr.prices[fit.indexOf(ti)] : fam.markets[ti].cells.reduce((acc, c) => acc + pr.q[c], 0);
            out = { fair: price, mid: own ?? null, loo: own === undefined };
          }
        }
        cache.set(hour, out); return out;
      };
    }
    const sp = candles.filter((c) => c[1] > 0 && c[2] < 1 && c[2] > c[1]).map((c) => c[2] - c[1]).sort((a, b) => a - b); const medSpread = sp.length ? sp[sp.length >> 1] : null;
    const makerFee = makerRate(R.fee.fee_type, R.fee.fee_multiplier);
    const durDays = (R.end - R.start) / 86400;
    for (const S of [100, 1000]) for (const [qn, Q] of Object.entries(queues)) for (const [vn, margin] of Object.entries(variants)) {
      const cur = { i: 0 }; let ti = 0; let lastTrade = null; let inv = 0; let cash = 0; let fees = 0; let maxInv = 0; let invMin = 0;
      let bid = null; let ask = null; // resting {price,size,ahead}
      const fills = []; let bothMin = 0; let minutes = 0; let famMin = 0; let fairGapSum = 0;
      const mid = (t) => { const b = bookAt(candles, t, { i: 0 }); return b && b[1] > 0 && b[2] < 1 ? (b[1] + b[2]) / 2 : null; };
      const midSeries = candles.filter((c) => c[1] > 0 && c[2] < 1).map((c) => [c[0], (c[1] + c[2]) / 2]);
      const midNear = (t) => { let lo = 0; let hi = midSeries.length - 1; let ans = null; while (lo <= hi) { const k = (lo + hi) >> 1; if (midSeries[k][0] <= t) { ans = midSeries[k][1]; lo = k + 1; } else hi = k - 1; } return ans; };
      const cap = S;
      for (let k = Math.ceil(R.start / 60) * 60; k < R.end; k += 60) {
        minutes += 1;
        const b = bookAt(candles, k, cur);
        while (ti < trades.length && trades[ti].t < k) { lastTrade = trades[ti].yes; ti += 1; }
        const bb = b && b[1] > 0 ? b[1] : null; const aa = b && b[2] < 1 ? b[2] : null;
        const fa0 = margin > 0 ? fairAt(k) : null;
        const M = bb !== null && aa !== null ? (bb + aa) / 2 : (lastTrade ?? (fa0 ? Math.min(0.97, Math.max(0.03, fa0.fair)) : null));
        let wantBid = null; let wantAsk = null;
        if (M !== null) {
          wantBid = bb ?? Math.max(0.01, Math.round((M - 0.02) * 100) / 100); wantAsk = aa ?? Math.min(0.99, Math.round((M + 0.02) * 100) / 100);
          if (wantAsk <= wantBid) { wantBid = null; wantAsk = null; }
        }
        if (margin > 0 && wantBid !== null) {
          const fa = fairAt(k); const F = fa ? fa.fair : M; if (fa) { famMin += 1; if (fa.mid !== null) fairGapSum += Math.abs(fa.fair - fa.mid); }
          if (F - wantBid < margin - 1e-9) wantBid = null;
          if (wantAsk !== null && wantAsk - F < margin - 1e-9) wantAsk = null;
        }
        if (inv >= cap) wantBid = null; if (inv <= -cap) wantAsk = null;
        const place = (cur0, want, touch, size) => {
          if (want === null) return null;
          if (cur0 && Math.abs(cur0.price - want) < 1e-9 && cur0.size > 1e-9) return cur0;
          return { price: want, size, ahead: touch !== null && Math.abs(want - touch) < 1e-9 ? Q : (touch !== null && want > touch ? 0 : Q) };
        };
        bid = place(bid && bid.size > 0 ? bid : null, wantBid, bb, Math.min(S, cap - inv));
        ask = place(ask && ask.size > 0 ? ask : null, wantAsk, aa === null ? null : 1 - aa, Math.min(S, cap + inv));
        if (bid && ask) bothMin += 1;
        // trades in the minute
        const stop = k + 60; const mine = [];
        while (ti < trades.length && trades[ti].t < stop) { mine.push(trades[ti]); lastTrade = trades[ti].yes; ti += 1; }
        if (bid) { const r = restBid({ ...bid }, mine); bid.ahead = r.ahead; for (const fl of r.fills) { fills.push({ t: fl.t, side: 'b', price: bid.price, size: fl.size }); bid.size -= fl.size; } }
        if (ask) { // a YES ask at a is a NO bid at 1-a; takers buying YES (takerSide yes) at yes >= a hit it
          const mirrored = mine.map((tr) => ({ ...tr, yes: 1 - tr.yes, takerSide: tr.takerSide === 'yes' ? 'no' : 'yes' }));
          const r = restBid({ price: 1 - ask.price, size: ask.size, ahead: ask.ahead }, mirrored); ask.ahead = r.ahead;
          for (const fl of r.fills) { fills.push({ t: fl.t, side: 'a', price: ask.price, size: fl.size }); ask.size -= fl.size; }
        }
        for (const fl of fills.filter((x) => !x.done)) {
          fl.done = true; const sgn = fl.side === 'b' ? 1 : -1; inv += sgn * fl.size; cash -= sgn * fl.size * fl.price; fees += feeOf(makerFee, fl.size, fl.price);
          maxInv = Math.max(maxInv, inv); invMin = Math.min(invMin, inv);
        }
      }
      // marks
      const mk = (h) => fills.reduce((a, fl) => { const m2 = midNear(fl.t + h); if (m2 === null) return a; return a + (fl.side === 'b' ? m2 - fl.price : fl.price - m2) * fl.size; }, 0);
      const filled = fills.reduce((a, f2) => a + f2.size, 0);
      const settle = fills.reduce((a, fl) => a + (fl.side === 'b' ? y - fl.price : fl.price - y) * fl.size, 0);
      const bothFrac = minutes ? bothMin / minutes : 0;
      const sh = Number.isFinite(shareBySer[S][seriesOf(p.t)]) ? shareBySer[S][seriesOf(p.t)] : shareAll[S];
      const reward = (p.r / durDays) * sh * bothFrac * durDays; // pool share while both sides quoted, over the program window
      results.push({ medSpread, t: p.t, ev: eventOf(p.t), ser: seriesOf(p.t), S, q: qn, v: vn, days: durDays, filled, nFills: fills.length, settle, fees, m1: mk(60), m5: mk(300), m30: mk(1800), maxInv, invMin, bothFrac, reward, poolDay: p.r / durDays, share: sh, tradeVol: trades.reduce((a, x) => a + x.count, 0), tradePages: R.tradePages, famFrac: minutes ? famMin / minutes : 0, capital: S * (1 - 0.04) });
    }
  }
  writeFileSync(join(CACHE, 'sim.json'), JSON.stringify({ touchMed, shareAll, results }));
  console.log(`sim rows ${results.length} touchMed ${touchMed}`);
}

// ------------------------------------------------------------------ stage: report

function report() {
  const P = JSON.parse(readFileSync(join(CACHE, 'programs.json'), 'utf8'));
  const NOWd = JSON.parse(readFileSync(join(CACHE, 'now.json'), 'utf8'));
  const lines = [];
  const L = (s = '') => lines.push(s);
  const grp = (arr, keyf) => { const m = {}; for (const x of arr) (m[keyf(x)] ??= []).push(x); return m; };
  L('## Programs (GET /incentive_programs, ' + P.fetched + ')'); L();
  L('| status | kind | programs | markets | pool $ | median pool $ | median days | target | discount |'); L('|---|---|---|---|---|---|---|---|---|');
  const medf = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  for (const st of ['active', 'upcoming']) for (const [k, v] of Object.entries(grp(P[st], (p) => p.d || 'adhoc'))) L(`| ${st} | ${k} | ${v.length} | ${new Set(v.map((p) => p.t)).size} | ${v.reduce((a, p) => a + p.r, 0).toFixed(0)} | ${medf(v.map((p) => p.r))} | ${medf(v.map(days)).toFixed(1)} | ${[...new Set(v.map((p) => p.ts))].join('/')} | ${[...new Set(v.map((p) => p.df))].join('/')} |`);
  L(); L(`closed programs seen: ${P.closedCount} (complete: ${P.closedComplete}); by end month: ${Object.entries(P.closedByMonth).sort().map(([m, n]) => `${m}:${n}`).join(' ')}`);
  const act = P.active; const perDay = act.reduce((a, p) => a + p.r / Math.max(days(p), 1 / 24), 0);
  L(); L(`active pool run-rate ~$${perDay.toFixed(0)}/day across ${act.length} programs (sum of pool/duration).`);
  const ser = grp(act, (p) => seriesOf(p.t)); const topS = Object.entries(ser).map(([k, v]) => [k, v.length, v.reduce((a, p) => a + p.r / days(p), 0)]).sort((a, b) => b[2] - a[2]).slice(0, 15);
  L(); L('Top series by $/day: ' + topS.map(([k, n, d]) => `${k} (${n} mkts, $${d.toFixed(0)}/d)`).join('; '));
  // now
  const R = NOWd.rows; L(); L(`## Covered markets now (${R.length} sampled of ${NOWd.liveCount} live programs; ${NOWd.at})`); L();
  const th = R.filter((r) => r.spread !== null);
  L(`two-sided books ${th.length}; spread>6c: ${th.filter((r) => r.spread > 0.06).length}; no bid or no ask: ${R.length - th.length}; median touch size ${medf(R.flatMap((r) => [r.bidSz, r.askSz]).filter((x) => x > 0))}`);
  L(`books already meeting target on both sides without us: ${R.filter((r) => r.share[1000].baseQualified).length}; in a coherent family: ${R.filter((r) => r.famKind).length}`);
  L(); L('| ticker | $/day | spread | touch sz (b/a) | qualifies w/o us | share@1000 | est $/day @1000 | capital | fair-mid |'); L('|---|---|---|---|---|---|---|---|---|');
  const est = (r) => r.perDay * r.share[1000].share;
  for (const r of [...R].sort((a, b) => est(b) - est(a)).slice(0, 25)) L(`| ${r.t} | ${r.perDay.toFixed(1)} | ${r.spread === null ? 'n/a' : (r.spread * 100).toFixed(0) + 'c'} | ${r.bidSz}/${r.askSz} | ${r.share[1000].baseQualified ? 'yes' : 'no'} | ${(r.share[1000].share * 100).toFixed(0)}% | ${est(r).toFixed(2)} | $${r.share[1000].capital.toFixed(0)} | ${r.fairGap === undefined ? '-' : (r.fairGap * 100).toFixed(1) + 'c'} |`);
  const tot = (S) => R.reduce((a, r) => a + r.perDay * r.share[S].share, 0);
  L(); L(`Sampled-set sum of est. reward/day at join-touch: S=100 $${tot(100).toFixed(1)}, S=1000 $${tot(1000).toFixed(1)}; capital S=1000 ~ $${(R.reduce((a, r) => a + r.share[1000].capital, 0)).toFixed(0)}`);
  if (existsSync(join(CACHE, 'sim.json'))) {
    const SIM = JSON.parse(readFileSync(join(CACHE, 'sim.json'), 'utf8'));
    L(); L(`## Shadow (${new Set(SIM.results.map((r) => r.t)).size} settled markets, ${new Set(SIM.results.map((r) => r.ev)).size} events; touchMed=${SIM.touchMed})`); L();
    L('Per market-day, $ (delete-one-event jackknife SE across events). spread+settle = settlement P&L of fills; mo = mark-out of fills (+/- = vs mid after 1/5/30 min).'); L();
    L('reward = pool share while both sides are quoted, using the live join-touch share vs today\'s resting book (an upper bound: rivals who also post full size at the touch split it). net@c = settle - fees + c * reward.'); L();
    L('| S | queue | rule | fills/mkt-day | settle P&L | fees | mark1 | mark5 | mark30 | reward (c=1) | net@0 | net@0.25 (SE) | net@1 (SE) | ret/day@0.25 |'); L('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const S of [100, 1000]) for (const q of ['q0', 'qmed', 'q3']) for (const v of ['J', 'F1', 'F2']) {
      const rs = SIM.results.filter((r) => r.S === S && r.q === q && r.v === v); if (!rs.length) continue;
      const evs = grp(rs, (r) => r.ev); const per = (f) => Object.values(evs).map((a) => a.reduce((x, r) => x + f(r), 0) / a.reduce((x, r) => x + r.days, 0));
      const J = (f) => jackknife(per(f)); const m = (f) => J(f).mean;
      const n0 = J((r) => r.settle - r.fees); const n25 = J((r) => r.settle - r.fees + 0.25 * r.reward); const n1 = J((r) => r.settle - r.fees + r.reward);
      L(`| ${S} | ${q} | ${v} | ${m((r) => r.nFills).toFixed(2)} | ${m((r) => r.settle).toFixed(2)} | ${m((r) => r.fees).toFixed(2)} | ${m((r) => r.m1).toFixed(2)} | ${m((r) => r.m5).toFixed(2)} | ${m((r) => r.m30).toFixed(2)} | ${m((r) => r.reward).toFixed(2)} | ${n0.mean.toFixed(2)} | ${n25.mean.toFixed(2)} (${n25.se.toFixed(2)}) | ${n1.mean.toFixed(2)} (${n1.se.toFixed(2)}) | ${(n25.mean / (S * 0.96) * 100).toFixed(2)}% |`);
    }
    L(); L('Thin (median two-sided spread > 6c) vs thicker books, S=1000, qmed, per market-day (jackknife by event):'); L();
    L('| books | rule | markets | events | fills/day | settle-fees | net@0.25 (SE) | net@1 (SE) |'); L('|---|---|---|---|---|---|---|---|');
    for (const [nm, ok] of [['thin >6c', (r) => r.medSpread !== null && r.medSpread > 0.06], ['thick <=6c', (r) => r.medSpread !== null && r.medSpread <= 0.06], ['no two-sided quote', (r) => r.medSpread === null]]) for (const v of ['J', 'F1', 'F2']) {
      const rs = SIM.results.filter((r) => r.S === 1000 && r.q === 'qmed' && r.v === v && ok(r)); if (!rs.length) continue;
      const evs = grp(rs, (r) => r.ev); const per = (f) => Object.values(evs).map((a) => a.reduce((x, r) => x + f(r), 0) / a.reduce((x, r) => x + r.days, 0));
      const n0 = jackknife(per((r) => r.settle - r.fees)); const n25 = jackknife(per((r) => r.settle - r.fees + 0.25 * r.reward)); const n1 = jackknife(per((r) => r.settle - r.fees + r.reward)); const fl = jackknife(per((r) => r.nFills));
      L(`| ${nm} | ${v} | ${rs.length} | ${Object.keys(evs).length} | ${fl.mean.toFixed(2)} | ${n0.mean.toFixed(2)} (${n0.se.toFixed(2)}) | ${n25.mean.toFixed(2)} (${n25.se.toFixed(2)}) | ${n1.mean.toFixed(2)} (${n1.se.toFixed(2)}) |`);
    }
  }
  console.log(lines.join('\n'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const run = { programs, now, history, simulate, report }[cmd];
  if (!run) { console.error('usage: maker-incentives-study.mjs programs|now|history|simulate|report'); process.exit(2); }
  mkdirSync(CACHE, { recursive: true });
  await run();
}
