// Resumable collector: books (+ taker tape + the desk's resting-order queue positions) for the desk's
// candidate universe. Read-only. Usage: node collect.mjs [--until ISO] [--every 300] [--once]
// Output (append-only NDJSON, data/): books-YYYY-MM-DD.ndjson, trades-YYYY-MM-DD.ndjson, desk-queue-YYYY-MM-DD.ndjson,
// universe.json, collect-state.json (resume point: last trade timestamp per ticker).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeClient, sleep, cents, levels, tradesFor, slimTrade, appendNdjson, dataDir, weatherSeries, gasSeriesAll } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] ?? true; };
const until = arg('until') ? Date.parse(arg('until')) : Infinity;
const every = Number(arg('every', 300)) * 1000;
const once = process.argv.includes('--once');
const pace = Number(arg('pace', 130));
const client = makeClient();
const stateFile = join(dataDir, 'collect-state.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { lastTradeTs: {}, seen: {}, universeAt: 0, universe: [] };
const day = () => new Date().toISOString().slice(0, 10);
const save = () => writeFileSync(stateFile, JSON.stringify(state));

/** Candidate markets: the desk sells YES on cheap tails (ask 2-6c) and buys favourites (bid 94-98c), within ~2 days of close. */
async function discover() {
  const out = [];
  const now = Date.now();
  for (const [kind, list] of [['weather', weatherSeries], ['gas', gasSeriesAll]]) {
    for (const s of list) {
      let ms = [];
      try { ms = await client.getMarkets({ series_ticker: s, status: 'open' }); } catch (e) { console.error('discover', s, e.message); }
      await sleep(pace);
      for (const m of ms) {
        const close = Date.parse(m.close_time);
        if (close < now - 3600e3 || close > now + 40 * 3600e3) continue;
        const yb = cents(m.yes_bid_dollars), ya = cents(m.yes_ask_dollars);
        const tail = (ya >= 2 && ya <= 8) || (yb >= 1 && yb <= 7);   // near the desk's sell prices (2-6c)
        const fav = yb >= 90 && yb <= 98;                  // near the desk's favourite bids (94-98c)
        if (tail || fav) out.push({ tk: m.ticker, kind, series: s, close: m.close_time, strike: m.floor_strike ?? m.cap_strike ?? null });
      }
    }
  }
  state.universe = out; state.universeAt = now; save();
  console.log(new Date().toISOString(), 'universe', out.length);
}

/** Active liquidity-incentive programs for the universe's tickers (public), hourly; windows open and close during the day. */
async function incentives(t) {
  if (Date.now() - (state.incentivesAt ?? 0) < 55 * 60e3) return;
  state.incentivesAt = Date.now();
  const want = new Set(state.universe.map((u) => u.tk));
  const rows = [];
  let cursor;
  try {
    for (let i = 0; i < 60; i += 1) {
      const p = await client.call('GET', '/incentive_programs', { query: { status: 'active', limit: 200, cursor }, signed: false });
      for (const g of p.incentive_programs ?? []) if (want.has(g.market_ticker) || /^KX(HIGH|LOWT)/.test(g.market_ticker)) rows.push({ t, tk: g.market_ticker, start: g.start_date, end: g.end_date, reward: g.period_reward, target: Number(g.target_size_fp), disc: g.discount_factor_bps });
      cursor = p.next_cursor;
      if (!cursor || !(p.incentive_programs ?? []).length) break;
      await sleep(pace);
    }
  } catch (e) { console.error('incentives', e.message); }
  appendNdjson(join(dataDir, `incentive-windows-${day()}.ndjson`), rows);
}

async function deskQueue(t) {
  if (!client.signed) return;
  try {
    const orders = await client.getOrders({ status: 'resting' });
    const rows = [];
    for (const o of orders) {
      let q = null;
      try { q = Number((await client.call('GET', `/portfolio/orders/${o.order_id}/queue_position`)).queue_position_fp); } catch { /* order gone */ }
      rows.push({ t, id: o.order_id, tk: o.ticker, side: o.book_side, p: cents(o.yes_price_dollars), n: Number(o.initial_count_fp), rem: Number(o.remaining_count_fp), created: o.created_time, q });
      await sleep(pace);
    }
    appendNdjson(join(dataDir, `desk-queue-${day()}.ndjson`), rows);
  } catch (e) { console.error('deskQueue', e.message); }
}

async function cycle() {
  const t = new Date().toISOString();
  if (Date.now() - state.universeAt > 30 * 60e3) await discover();
  const books = [], trades = [];
  for (const u of state.universe) {
    try {
      const ob = await client.getOrderbook(u.tk, 12);
      const { bids, asks } = levels(ob);
      books.push({ t, tk: u.tk, bids: bids.slice(0, 12), asks: asks.slice(0, 12) });
    } catch (e) { console.error('book', u.tk, e.message); }
    await sleep(pace);
    try {
      const minTs = state.lastTradeTs[u.tk] ?? Math.floor(Date.now() / 1000) - 3 * 3600;
      const rows = await tradesFor(client, u.tk, { minTs: minTs + 0, maxPages: 5 });
      for (const r of rows) {
        if (state.seen[r.trade_id]) continue;
        state.seen[r.trade_id] = 1;
        trades.push(slimTrade(r));
      }
      if (rows.length) state.lastTradeTs[u.tk] = Math.max(minTs, ...rows.map((r) => Math.floor(Date.parse(r.created_time) / 1000)));
    } catch (e) { console.error('trades', u.tk, e.message); }
    await sleep(pace);
  }
  appendNdjson(join(dataDir, `books-${day()}.ndjson`), books);
  appendNdjson(join(dataDir, `trades-${day()}.ndjson`), trades);
  await deskQueue(t);
  await incentives(t);
  // trim the seen set: keep ids only for tickers still in the universe (ids are unique; a bounded memory set)
  const ids = Object.keys(state.seen); if (ids.length > 60000) for (const k of ids.slice(0, ids.length - 30000)) delete state.seen[k];
  save();
  console.log(t, 'books', books.length, 'trades', trades.length);
}

while (Date.now() < until) {
  const started = Date.now();
  try { await cycle(); } catch (e) { console.error('cycle', e.message); }
  if (once) break;
  await sleep(Math.max(5000, every - (Date.now() - started)));
}
