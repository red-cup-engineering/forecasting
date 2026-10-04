/**
 * Constraint families for the coherence engine: each builder turns markets into a
 * family (see coherence.mjs) whose linear relations are the logical relations among
 * the contracts' events.
 *
 *  1. interval-ladder  one numeric variable, markets are intervals of it (brackets
 *                      "between", tails "less"/"greater", cumulative ">= X"): brackets of an
 *                      event partition the line (sum to 1) and ">= X" prices are monotone,
 *                      both as set containment over cells.
 *  2. exclusive-set    a mutually exclusive event with non-numeric outcomes: at most one yes;
 *                      a sports game with two or three listed sides is taken as exhaustive
 *                      (flagged void-or-tie-risk).
 *  3. station-day      a day's KXHIGH and KXLOWT ladders for one station on the joint outcome
 *                      space (high, low): high >= low, so cells with high < low are impossible.
 *                      Polymarket US brackets for the same station/day join as extra markets.
 *  4. window-union     "rain on any day in a window" vs the same station's daily rain markets:
 *                      window = OR(days), as containment and cover.
 */
import { KALSHI_THETA } from './coherence.mjs';

const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** Top-of-book legs of a Kalshi event-embedded market row. */
export function quoteOf(m) {
  const bid = num(m.yes_bid_dollars); const ask = num(m.yes_ask_dollars);
  const bs = num(m.yes_bid_size_fp) ?? 0; const as = num(m.yes_ask_size_fp) ?? 0;
  return {
    bids: bid && bid > 0 && bs > 0 ? [{ price: bid, size: bs }] : [],
    asks: ask && ask < 1 && as > 0 ? [{ price: ask, size: as }] : [],
  };
}

export const thetaOf = (series) => KALSHI_THETA * (num(series?.fee_multiplier) ?? 1);

/** Closed interval [lo, hi] of the underlying variable for a numeric strike market, or null. */
export function strikeInterval(m, step) {
  const f = num(m.floor_strike); const c = num(m.cap_strike);
  switch (m.strike_type) {
    case 'less': return c === null ? null : { lo: -Infinity, hi: round6(c - step) };
    case 'less_or_equal': return c === null ? null : { lo: -Infinity, hi: c };
    case 'greater': return f === null ? null : { lo: round6(f + step), hi: Infinity };
    case 'greater_or_equal': return f === null ? null : { lo: f, hi: Infinity };
    case 'between': return f === null || c === null ? null : { lo: f, hi: c };
    default: return null;
  }
}

const NUMERIC_STRIKES = new Set(['less', 'less_or_equal', 'greater', 'greater_or_equal', 'between']);
export const isNumericStrike = (m) => NUMERIC_STRIKES.has(m.strike_type);

/** Cells (half-open ranges of the variable) induced by intervals, and each interval's cell set. */
export function cellsFor(intervals, step) {
  const pts = new Set();
  for (const { lo, hi } of intervals) { if (Number.isFinite(lo)) pts.add(round6(lo)); if (Number.isFinite(hi)) pts.add(round6(hi + step)); }
  const b = [...pts].sort((x, y) => x - y);
  const cells = [];
  let start = -Infinity;
  for (const p of b) { cells.push({ start, end: p }); start = p; }
  cells.push({ start, end: Infinity });
  const within = ({ lo, hi }) => cells.map((c, i) => (c.start >= lo - 1e-9 && c.end <= round6(hi + step) + 1e-9 ? i : -1)).filter((i) => i >= 0);
  return { cells, within };
}

const isInteger = (x) => !Number.isFinite(x) || Math.abs(x - Math.round(x)) < 1e-9;

/**
 * Group an event's numeric-strike markets by subject (ticker part between the event and the
 * strike token, plus any letter prefix of the token), so player props and per-team spreads
 * with the same threshold do not collide.
 */
export function ladderGroups(event) {
  const groups = new Map();
  for (const m of event.markets) {
    if (!isNumericStrike(m)) continue;
    const tokens = m.ticker.slice(event.event_ticker.length).split('-').filter(Boolean);
    const strikeToken = tokens.pop() ?? '';
    // 'UCD25' -> team UCD; 'T88', 'B63.5', 'N1.0', '9.50' -> no subject prefix.
    const prefix = strikeToken.replace(/[TBN]?-?[\d.]+$/u, '');
    const subject = [tokens.join('-'), prefix].filter(Boolean).join('/');
    if (!groups.has(subject)) groups.set(subject, []);
    groups.get(subject).push(m);
  }
  return [...groups.entries()].filter(([, ms]) => ms.length >= 2);
}

/** Build a ladder object for one subject group, or {skipped}. */
export function buildLadder(event, subject, markets, series) {
  const raw = markets.map((m) => ({ f: num(m.floor_strike), c: num(m.cap_strike) }));
  const step = raw.every((r) => isInteger(r.f ?? 0) && isInteger(r.c ?? 0)) ? 1 : 1e-6;
  const quotes = [];
  const seen = new Set();
  for (const m of markets) {
    const interval = strikeInterval(m, step);
    if (!interval) return { skipped: 'no-interval' };
    const key = `${interval.lo}|${interval.hi}`;
    if (seen.has(key)) return { skipped: 'duplicate-strike' };
    seen.add(key);
    quotes.push({ id: m.ticker, venue: 'kalshi', theta: thetaOf(series), interval, ...quoteOf(m) });
  }
  return { id: `ladder:${event.event_ticker}${subject ? `/${subject}` : ''}`, kind: 'interval-ladder', step, quotes, event: event.event_ticker, series: event.series_ticker };
}

/** A family over the cells of one ladder (optionally with extra interval quotes from other venues). */
export function ladderFamily(ladder, extra = []) {
  const quotes = [...ladder.quotes, ...extra];
  const { cells, within } = cellsFor(quotes.map((q) => q.interval), ladder.step);
  return {
    id: ladder.id, kind: ladder.extraKind ?? ladder.kind, nCells: cells.length, blocks: [cells.map((_, i) => i)], couplings: [],
    markets: quotes.map((q) => ({ id: q.id, venue: q.venue, theta: q.theta, cells: within(q.interval), bids: q.bids, asks: q.asks })),
    meta: { event: ladder.event, series: ladder.series },
  };
}

/** Exclusive-set family; null when the event does not qualify. */
export function exclusiveFamily(event, series, { maxMarkets = 150 } = {}) {
  if (!event.mutually_exclusive) return null;
  const hasLadder = ladderGroups(event).length > 0;
  let ms = event.markets.filter((m) => !isNumericStrike(m) || !hasLadder);
  ms = ms.filter((m) => { const q = quoteOf(m); return q.bids.length || q.asks.length; });
  if (ms.length < 2) return null;
  const sports = event.category === 'Sports' && /GAME$/u.test(event.series_ticker ?? '') && event.markets.length <= 3 && ms.length === event.markets.length;
  if (ms.length > maxMarkets) ms = [...ms].sort((a, b) => (num(b.yes_bid_dollars) ?? 0) - (num(a.yes_bid_dollars) ?? 0)).slice(0, maxMarkets);
  const n = ms.length;
  const nCells = sports ? n : n + 1; // extra cell: none of the listed outcomes
  return {
    id: `exclusive:${event.event_ticker}`, kind: sports ? 'exclusive-exhaustive-assumed' : 'exclusive-set', nCells,
    blocks: [Array.from({ length: nCells }, (_, i) => i)], couplings: [],
    markets: ms.map((m, i) => ({ id: m.ticker, venue: 'kalshi', theta: thetaOf(series), cells: [i], ...quoteOf(m) })),
    meta: { event: event.event_ticker, series: event.series_ticker, sports },
  };
}

/** Joint (high, low) family from two ladders of the same station and date. */
export function stationDayFamily(high, low, highExtra = [], lowExtra = []) {
  const hq = [...high.quotes, ...highExtra];
  const lq = [...low.quotes, ...lowExtra];
  const step = Math.min(high.step, low.step);
  const H = cellsFor(hq.map((q) => q.interval), step);
  const L = cellsFor(lq.map((q) => q.interval), step);
  const idx = new Map();
  let n = 0;
  for (let i = 0; i < H.cells.length; i += 1) {
    for (let k = 0; k < L.cells.length; k += 1) {
      // possible iff some high value in H[i] is >= some low value in L[k]
      if (H.cells[i].end - step >= L.cells[k].start - 1e-9) { idx.set(`${i}|${k}`, n); n += 1; }
    }
  }
  const hCells = (q) => { const out = []; for (const i of H.within(q.interval)) for (let k = 0; k < L.cells.length; k += 1) if (idx.has(`${i}|${k}`)) out.push(idx.get(`${i}|${k}`)); return out; };
  const lCells = (q) => { const out = []; for (const k of L.within(q.interval)) for (let i = 0; i < H.cells.length; i += 1) if (idx.has(`${i}|${k}`)) out.push(idx.get(`${i}|${k}`)); return out; };
  return {
    id: `stationday:${high.event}+${low.event}`, kind: 'station-day', nCells: n, blocks: [Array.from({ length: n }, (_, i) => i)], couplings: [],
    markets: [
      ...hq.map((q) => ({ id: q.id, venue: q.venue, theta: q.theta, cells: hCells(q), bids: q.bids, asks: q.asks })),
      ...lq.map((q) => ({ id: q.id, venue: q.venue, theta: q.theta, cells: lCells(q), bids: q.bids, asks: q.asks })),
    ],
    meta: { high: high.event, low: low.event },
  };
}

/** Window-union family: W = rain on any of k days; joint outcomes are the 2^k day patterns (k <= 7). */
export function windowUnionFamily(windowQuote, dayQuotes, id) {
  const k = dayQuotes.length;
  const nCells = 1 << k;
  const all = Array.from({ length: nCells }, (_, s) => s);
  return {
    id, kind: 'window-union', nCells, blocks: [all], couplings: [],
    markets: [
      { ...windowQuote, cells: all.filter((s) => s > 0) },
      ...dayQuotes.map((q, i) => ({ ...q, cells: all.filter((s) => (s >> i) & 1) })),
    ],
  };
}

const MONTHS = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5, July: 6, August: 7, September: 8, October: 9, November: 10, December: 11, Jan: 0, Feb: 1, Mar: 2, Apr: 3, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Sept: 8, Oct: 9, Nov: 10, Dec: 11 };
const ymd = (y, mo, d) => `${y}-${String(mo + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
/** Parse a rain-style market's rule text: station phrase and date (or window). */
export function parseRainRule(rules) {
  const s = String(rules ?? '');
  const station = /precipitation at (\w+) in/u.exec(s)?.[1] ?? null;
  if (!station || !/strictly greater than 0 inches/u.test(s)) return null;
  const any = /on any day within ([A-Za-z]+) (\d+), (\d{4}) through ([A-Za-z]+) (\d+), (\d{4})/u.exec(s);
  if (any) return { station, kind: 'window', from: ymd(+any[3], MONTHS[any[1]], +any[2]), to: ymd(+any[6], MONTHS[any[4]], +any[5]) };
  const day = /in ([A-Za-z]+) (\d+), (\d{4})/u.exec(s);
  if (day && MONTHS[day[1]] !== undefined) return { station, kind: 'day', date: ymd(+day[3], MONTHS[day[1]], +day[2]) };
  return null;
}

export const datesBetween = (a, b) => {
  const out = [];
  for (let t = Date.parse(`${a}T00:00:00Z`); t <= Date.parse(`${b}T00:00:00Z`); t += 86400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
