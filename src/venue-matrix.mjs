/**
 * Evaluation matrix over venues, pure. Rows are claims (a game outcome: side wins / draw), columns are venues and
 * forecasters, entries are an interval [lo, hi] of the claim's price in dollars per $1 payout.
 *
 *   - An executable venue (an order book) gives [best bid, best ask]: you can sell YES at lo and buy it at hi.
 *   - An odds-only source (a sportsbook line, an AMM quote read as odds) gives a point after proportional de-vig;
 *     it is a forecaster, not a counterparty, so it never enters the consensus.
 *
 * The consensus is the intersection of the executable intervals. When it is empty one venue's bid is above
 * another's ask: buy there, sell here. `crossVenueGap` sizes that after each venue's taker fee. `coverEdge` is the
 * whole-game version: buy every outcome of the game's partition at its cheapest venue; the payoff is exactly $1
 * (a tie that Kalshi settles at $0.50 per team still pays $1 across the pair), so cost < 1 after fees is a Dutch book.
 *
 * Each column's FOUR reading is read through four.mjs. Told-for: the entry lies wholly above the reference interval
 * (the column says the claim costs more than the rest of the executable market allows). Told-against: wholly below.
 * Told-both: the reference is empty (the other venues disagree among themselves) or the entry is itself crossed.
 * Told-neither: the entry overlaps the reference or there is no reference to read against.
 *
 * Fees (taker; makers pay none on either venue):
 *   Kalshi      fee = 0.07 * series.fee_multiplier * C * P * (1 - P), rounded up to the cent per order
 *               (https://kalshi.com/docs/kalshi-fee-schedule.pdf; fee_multiplier read live from GET /series/{ticker}).
 *   Polymarket  fee = feeSchedule.rate * C * P * (1 - P)  (https://docs.polymarket.com/trading/fees); the rate is read
 *               live from each market's feeSchedule (NFL/CFB 0.03; other sports 0.05 as the fee page documents).
 * The per-share continuous form is used here; cent rounding is a per-order effect that vanishes at size.
 */
import { readingOfSides, sidesOfReading } from '@red-cup-engineering/computer-data-services-section/four';

const EPS = 1e-9;
const num = (v) => { const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v); return Number.isFinite(n) ? n : null; };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ---------------------------------------------------------------- odds, de-vig

/** American moneyline (-470, "+360", 400) to the implied probability including vig. */
export function americanToProb(odds) {
  const o = num(String(odds).replace(/^\+/u, ''));
  if (o === null || o === 0) return null;
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

/** Decimal odds (1.58) to the implied probability including vig. */
export function decimalToProb(d) { const x = num(d); return x !== null && x > 1 ? 1 / x : null; }

/** Proportional de-vig of one market's implied probabilities. vig = overround - 1. */
export function devig(raw) {
  if (!raw.length || raw.some((p) => p === null || !(p > 0))) return null;
  const sum = raw.reduce((a, b) => a + b, 0);
  return { probs: raw.map((p) => p / sum), vig: sum - 1 };
}

// ---------------------------------------------------------------- fees

export const KALSHI_RATE = 0.07;
/** Fee per share bought at price p on a venue whose fee is `{rate}` (quadratic: rate * p * (1 - p)). */
export const feePerShare = (fee, p) => (fee ? fee.rate * p * (1 - p) : 0);
export const kalshiFee = (multiplier = 1) => ({ venue: 'kalshi', rate: KALSHI_RATE * multiplier });
export const polymarketFee = (rate) => ({ venue: 'polymarket', rate });

// ---------------------------------------------------------------- entries

/**
 * An executable entry from a book's best bid/ask (0 or null bid = no bid, so the lower bound is 0; null ask = 1).
 * @returns {{venue, claim, lo, hi, executable: true, fee, crossed: boolean, bidSize?, askSize?}}
 */
export function bookEntry({ venue, claim, bid, ask, fee, bidSize = null, askSize = null }) {
  const lo = clamp01(num(bid) ?? 0); const hi = clamp01(num(ask) ?? 1);
  return { venue, claim, lo, hi, executable: true, fee, crossed: lo > hi + EPS, hasBid: (num(bid) ?? 0) > 0, hasAsk: num(ask) !== null && num(ask) < 1, bidSize, askSize };
}

/** An odds-only entry: the de-vigged point, with the source's vig kept on the entry. */
export function pointEntry({ venue, claim, p, vig = null }) {
  return { venue, claim, lo: p, hi: p, executable: false, fee: null, crossed: false, vig };
}

/** Complement of an interval: the claim "not this" (used to price the other side of a two-way book). */
export const complement = (e, claim) => ({ ...e, claim, lo: 1 - e.hi, hi: 1 - e.lo, hasBid: e.hasAsk, hasAsk: e.hasBid, bidSize: e.askSize, askSize: e.bidSize });

// ---------------------------------------------------------------- consensus

/** Intersection of intervals; `empty` when the largest lo exceeds the smallest hi, with `size` = how far apart. */
export function intersect(intervals) {
  if (!intervals.length) return null;
  const lo = Math.max(...intervals.map((i) => i.lo)); const hi = Math.min(...intervals.map((i) => i.hi));
  return { lo, hi, empty: lo > hi + EPS, size: Math.max(0, lo - hi) };
}

const sound = (entries) => entries.filter((e) => e.executable && !e.crossed);

/** The consensus of a claim's executable entries (null when fewer than one). */
export const consensus = (entries) => intersect(sound(entries));

/**
 * The cross-venue gap on one claim: the largest bid-over-ask pair of different venues. Buy the claim at venue X's
 * ask and sell it (buy its complement) at venue Y's bid; the gross edge is bid_Y - ask_X per share and the net edge
 * subtracts both taker fees. Null when fewer than two executable venues have a bid and an ask.
 */
export function crossVenueGap(entries) {
  const ex = sound(entries); let best = null;
  for (const x of ex) for (const y of ex) {
    if (x.venue === y.venue || !x.hasAsk || !y.hasBid) continue;
    const gross = y.lo - x.hi;
    if (best === null || gross > best.gross) best = { buy: x.venue, sell: y.venue, buyAt: x.hi, sellAt: y.lo, gross, net: gross - feePerShare(x.fee, x.hi) - feePerShare(y.fee, y.lo) };
  }
  return best;
}

/**
 * The whole-game cover: one claim per outcome of a partition. Each outcome is bought at the venue with the lowest
 * ask-plus-fee; edge = 1 - sum(cost). `crossVenue` is true when the cheapest legs sit on more than one venue.
 * Null if any outcome has no executable ask.
 */
export function coverEdge(claims) {
  const legs = [];
  for (const entries of claims) {
    let best = null;
    for (const e of sound(entries)) {
      if (!e.hasAsk) continue;
      const cost = e.hi + feePerShare(e.fee, e.hi);
      if (best === null || cost < best.cost) best = { venue: e.venue, claim: e.claim, ask: e.hi, cost };
    }
    if (best === null) return null;
    legs.push(best);
  }
  const gross = 1 - legs.reduce((a, l) => a + l.ask, 0);
  const net = 1 - legs.reduce((a, l) => a + l.cost, 0);
  return { legs, gross, net, crossVenue: new Set(legs.map((l) => l.venue)).size > 1 };
}

// ---------------------------------------------------------------- readings

/** The reference interval an entry is read against: the other executable venues' consensus (all of them for a point). */
export function referenceFor(entry, entries) {
  return consensus(entries.filter((e) => e.venue !== entry.venue));
}

/**
 * The FOUR reading of one entry against its reference, and which way it sits.
 * @returns {{reading: string, direction: 'above'|'below'|'inside'|'none', gap: number}}
 */
export function readEntry(entry, entries) {
  if (entry.crossed) return { reading: readingOfSides('told', true, true), direction: 'none', gap: 0 };
  const ref = referenceFor(entry, entries);
  if (ref === null) return { reading: readingOfSides('told', false, false), direction: 'none', gap: 0 };
  if (ref.empty) return { reading: readingOfSides('told', true, true), direction: 'none', gap: ref.size };
  const above = entry.lo > ref.hi + EPS; const below = entry.hi < ref.lo - EPS;
  return {
    reading: readingOfSides('told', above, below),
    direction: above ? 'above' : below ? 'below' : 'inside',
    gap: above ? entry.lo - ref.hi : below ? ref.lo - entry.hi : 0,
  };
}

/** One claim row: the entries, consensus, cross-venue gap and a reading per column. */
export function claimRow(claim, entries) {
  const cons = consensus(entries);
  return { claim, entries, consensus: cons, gap: crossVenueGap(entries), readings: Object.fromEntries(entries.map((e) => [e.venue, readEntry(e, entries)])) };
}

/**
 * Per-column scores over rows: how often a column is told outside its reference, in which direction, and the mean
 * distance when it is. Columns with no reference in a row are not counted in `read`.
 */
export function columnScores(rows) {
  const out = {};
  for (const row of rows) for (const [venue, r] of Object.entries(row.readings)) {
    const s = (out[venue] ??= { venue, rows: 0, read: 0, outside: 0, above: 0, below: 0, contested: 0, gapSum: 0 });
    s.rows += 1;
    const [forTold, againstTold] = sidesOfReading(r.reading);
    if (r.direction === 'none' && !(forTold && againstTold)) continue;
    s.read += 1;
    if (forTold && againstTold) { s.contested += 1; continue; }
    if (forTold) { s.outside += 1; s.above += 1; s.gapSum += r.gap; }
    if (againstTold) { s.outside += 1; s.below += 1; s.gapSum += r.gap; }
  }
  for (const s of Object.values(out)) s.meanGap = s.outside ? s.gapSum / s.outside : 0;
  return out;
}
