/**
 * The entry-rule vocabulary, evaluated on a tape. Pure: a tape row is a settled market with the quote the
 * snapshot spec asked for, and nothing else is consulted. See schema.mjs for the spec.
 *
 * tape row: { ticker, event, close, occ?, result: 'yes'|'no', multiplier, quote: {ts, bid, ask} | null }
 *   ts is the ISO instant of the quote (the candle's end), bid/ask are YES-side dollars.
 */
import { netPerContract } from './stats.mjs';

export class RegistrationError extends Error { constructor(what, at, registeredAt) { super(`${what} at ${at} precedes registration ${registeredAt}`); } }

/** Refuse (throw) when an instant precedes the hypothesis's registeredAt. */
export function requireAfterRegistration(h, at, what = 'observation') {
  if (!(Date.parse(at) >= Date.parse(h.registeredAt))) throw new RegistrationError(what, at, h.registeredAt);
}

export const snapshotKey = (s) => `quote:${s.anchor}:${s.offsetMinutes}`;
const anchorMs = (row, anchor) => Date.parse(anchor === 'close' ? row.close : row.occ);
/** The instant (ms) a market's snapshot is taken, or NaN when the anchor is unknown. */
export const snapshotTarget = (row, s) => anchorMs(row, s.anchor) + s.offsetMinutes * 60000;

function isoWeek(dateIso) {
  const d = new Date(Date.parse(`${dateIso.slice(0, 10)}T00:00:00Z`));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d - first) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
}
export const clusterOf = (unit, row) => (unit === 'day' ? row.close.slice(0, 10) : unit === 'week' ? isoWeek(row.close) : row.event);

const twoSided = (q) => q && q.bid > 0 && q.ask < 1 && q.ask > q.bid - 1e-12 && q.ask > 0;
const mid = (q) => (q.bid + q.ask) / 2;
const fieldValue = (field, side, q) => (field === 'yes_ask' ? q.ask : field === 'yes_bid' ? q.bid : field === 'yes_mid' ? mid(q) : side === 'yes' ? q.ask : 1 - q.bid);
export const fillPrice = (side, q) => (side === 'yes' ? q.ask : Math.round((1 - q.bid) * 1e4) / 1e4);

/** Does a live two-sided quote satisfy the entry rule's price band? (used by the desk-side model lookup) */
export function quoteQualifies(entry, quote) {
  if (!twoSided(quote)) return false;
  const v = fieldValue(entry.price.field, entry.side, quote);
  return (entry.price.min === undefined || v >= entry.price.min - 1e-9) && (entry.price.max === undefined || v <= entry.price.max + 1e-9);
}

/**
 * Entries of one hypothesis on a tape.
 * @returns {{entries: object[], refused: number, noQuote: number, considered: number}}
 *   refused: rows whose quote or close precedes registeredAt (never judged).
 */
export function entriesFromTape(h, tape) {
  const registered = Date.parse(h.registeredAt), en = h.entry;
  const byEvent = new Map();
  let refused = 0, noQuote = 0, considered = 0;
  for (const row of tape) {
    if (row.result !== 'yes' && row.result !== 'no') continue;
    if (Date.parse(row.close) < registered) { refused += 1; continue; }
    if (!twoSided(row.quote)) { noQuote += 1; continue; }
    if (Date.parse(row.quote.ts) < registered) { refused += 1; continue; }
    considered += 1;
    if (!quoteQualifies(en, row.quote)) continue;
    if (!byEvent.has(row.event)) byEvent.set(row.event, []);
    byEvent.get(row.event).push(row);
  }
  const chosen = [];
  for (const rows of byEvent.values()) {
    rows.sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
    if (en.choose !== 'all') {
      const { target } = en.choose.nearest;
      rows.sort((a, b) => Math.abs(mid(a.quote) - target) - Math.abs(mid(b.quote) - target) || (a.ticker < b.ticker ? -1 : 1));
    }
    chosen.push(...(en.oncePer === 'event' ? rows.slice(0, 1) : rows));
  }
  const entries = chosen.map((row) => {
    const price = fillPrice(en.side, row.quote), won = row.result === en.side;
    const mult = h.fee.multiplier === 'series' ? row.multiplier : h.fee.multiplier;
    return { g: clusterOf(h.cluster, row), ticker: row.ticker, event: row.event, side: en.side, price, at: row.quote.ts, date: row.close, won, x: netPerContract({ won, price, multiplier: mult, fee: h.fee }) };
  }).sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
  return { entries, refused, noQuote, considered };
}
