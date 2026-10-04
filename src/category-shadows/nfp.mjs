// Family 3: KXPAYROLLS longshot YES. Rule from the record: at ~15.4h before close, spread <= 10c, buy YES at the ask when mid is in [0.15, 0.35).
// No external reference exists; the reference is the book's own mid (the claim under test is that mid-band longshots resolve YES more often than priced).
import { hoursTo, makeRow, openMarkets, touch, round } from './common.mjs';

export const family = 'nfp';
export const WINDOW_OPEN_H = 15.6; export const WINDOW_CLOSE_H = 12;
export const MAX_SPREAD = 0.10; export const BAND = [0.15, 0.35];

export function nfpTake(book) {
  if (book.mid === null || book.spread === null || book.spread > MAX_SPREAD) return null;
  return book.mid >= BAND[0] && book.mid < BAND[1] ? 'yes' : null;
}

export async function tick({ client, now, seen }) {
  const markets = (await openMarkets(client, 'KXPAYROLLS')).filter((m) => m.strike_type === 'greater');
  if (!markets.length) return { family, status: 'no-open-markets', rows: [], keys: [] };
  const first = [...new Set(markets.map((m) => m.close_time))].sort()[0];
  const ev = markets.filter((m) => m.close_time === first); const h = hoursTo(first, now);
  if (h > WINDOW_OPEN_H || h < WINDOW_CLOSE_H) return { family, status: 'waiting', event: ev[0].event_ticker, note: `window opens in ${round(h - WINDOW_OPEN_H, 1)}h (close ${first})`, rows: [], keys: [] };
  const rows = []; const keys = [];
  for (const m of ev) {
    const key = `${m.ticker}|${first}`; if (seen.has(key)) continue;
    const book = touch(m);
    rows.push(makeRow({ family, now, window: first, market: m, book, take: nfpTake(book), refP: book.mid ?? 0, ref: { kind: 'book-mid', band: BAND }, extra: { hoursToClose: round(h, 2) } }));
    keys.push(key);
  }
  return { family, status: rows.length ? 'logged' : 'already-logged', event: ev[0].event_ticker, rows, keys };
}
