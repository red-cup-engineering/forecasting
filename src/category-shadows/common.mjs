// Shared pieces for the log-only category shadows. No orders, no credentials: public reads only.
import { THETA, orderFeePerContract } from '@red-cup-engineering/forecasting/fees';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const stateRoot = (env = process.env) => env.CATEGORY_SHADOWS_STATE
  ?? join(env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'category-shadows');
export const familyDir = (family, root = stateRoot()) => { const d = join(root, family); mkdirSync(d, { recursive: true }); return d; };

export const num = (v) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : n; };
export const round = (x, d = 5) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

// Normal cdf (Abramowitz-Stegun 7.1.26 erf; |err| < 1.5e-7).
export function Phi(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

// The taker fee per contract for an n-lot at price p (dollars) as the backtests these shadows forward-test charged it:
// ceil(0.07*n*p*(1-p) to the cent)/n (gridCents 1). The account pays on the $0.0001 grid, so a shadow is conservative.
export const fee = (p, n = 10, rate = THETA) => orderFeePerContract(n, p, { multiplier: rate / THETA, gridCents: 1 });

/** Book at the touch from a market record (dollars + _fp sizes). */
export function touch(m) {
  const bid = num(m.yes_bid_dollars); const ask = num(m.yes_ask_dollars);
  return {
    bid, ask, bidSize: num(m.yes_bid_size_fp), askSize: num(m.yes_ask_size_fp),
    spread: bid !== null && ask !== null ? round(ask - bid, 4) : null,
    mid: bid !== null && ask !== null ? (bid + ask) / 2 : null,
  };
}

/** Taker price, touch depth and fee for taking `side` ('yes' buys at the ask; 'no' buys at 1 - bid, depth = bid size). */
export function takerLeg(book, side) {
  if (side === 'yes') {
    if (book.ask === null || !(book.ask > 0 && book.ask < 1)) return null;
    return { price: book.ask, depth: book.askSize ?? 0, fee10: fee(book.ask) };
  }
  if (book.bid === null || !(book.bid > 0 && book.bid < 1)) return null;
  const price = round(1 - book.bid, 4);
  return { price, depth: book.bidSize ?? 0, fee10: fee(price) };
}

/** Build the common row. `take` is 'yes' | 'no' | null; ref carries the family reference. */
export function makeRow({ family, now, window, market, book, take, refP, ref, extra = {} }) {
  const leg = take ? takerLeg(book, take) : null;
  return {
    family, t: new Date(now).toISOString(), window, event: market.event_ticker, ticker: market.ticker, close: market.close_time,
    strike: market.floor_strike ?? market.custom_strike ?? null,
    bid: book.bid, ask: book.ask, bidSize: book.bidSize, askSize: book.askSize, spread: book.spread,
    refP: round(refP), ref,
    take: leg ? take : null,
    price: leg ? leg.price : null, depth: leg ? leg.depth : null, fill10: leg ? leg.depth >= 10 : null, fee10: leg ? leg.fee10 : null,
    edge: leg ? round((take === 'yes' ? refP : 1 - refP) - leg.price, 4) : null,
    ...extra,
  };
}

// Deduplication per market per decision window (family/seen.jsonl, one key per line).
export function loadSeen(family, root = stateRoot()) {
  const f = join(familyDir(family, root), 'seen.jsonl');
  return new Set(existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);
}
export function recordSeen(family, keys, root = stateRoot()) {
  if (keys.length) appendFileSync(join(familyDir(family, root), 'seen.jsonl'), keys.join('\n') + '\n');
}
export function appendRows(family, rows, now, root = stateRoot()) {
  if (!rows.length) return;
  const day = new Date(now).toISOString().slice(0, 10);
  appendFileSync(join(familyDir(family, root), `${day}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
export function readRows(family, root = stateRoot()) {
  const d = familyDir(family, root); const rows = [];
  for (const f of readdirSync(d).filter((x) => /^\d{4}-\d\d-\d\d\.jsonl$/.test(x)).sort()) {
    for (const line of readFileSync(join(d, f), 'utf8').split('\n')) { if (line) { try { rows.push(JSON.parse(line)); } catch { /* torn line */ } } }
  }
  return rows;
}

export const UA = { 'user-agent': 'Mozilla/5.0 561-group research (ops@561.group)', accept: 'application/json' };
export async function getJson(url, { timeoutMs = 20000, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`http-${res.status} ${url}`);
  return res.json();
}
export const hoursTo = (iso, now) => (Date.parse(iso) - now) / 3600000;

/** Open Kalshi markets for a series, public read. */
export async function openMarkets(client, series, query = {}) {
  return client.getMarkets({ series_ticker: series, status: 'open', ...query });
}
export { existsSync, mkdirSync, readFileSync, writeFileSync, join };
