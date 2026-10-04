// Family 1: KXGDP vs Atlanta Fed GDPNow. Decision window: from 21:00Z the evening before the advance release
// (the record's snapshot; KXGDP closes 12:29Z on release day, 15.5h later) until 10h before close.
// Rule (pre-registered, theta 0.05): reference P(YES) = 1 - Phi((X - nowcast)/sd), sd = trailing RMSE of the nowcast vs the advance estimate.
import { Phi, hoursTo, makeRow, openMarkets, touch, round } from './common.mjs';

export const family = 'gdp';
export const THETA = 0.05;
export const WINDOW_OPEN_H = 15.6; export const WINDOW_CLOSE_H = 10;
export const MAX_NOWCAST_AGE_DAYS = 10;

export const gdpRef = (strike, nowcast, sd) => 1 - Phi((strike - nowcast) / sd);
export function gdpTake(book, refP, theta = THETA) {
  if (book.ask !== null && book.ask < 1 && refP - book.ask >= theta) return 'yes';
  if (book.bid !== null && book.bid > 0 && book.bid - refP >= theta) return 'no';
  return null;
}

export async function tick({ client, now, seen, fetchers }) {
  const markets = (await openMarkets(client, 'KXGDP')).filter((m) => m.strike_type === 'greater' && m.floor_strike !== undefined);
  if (!markets.length) return { family, status: 'no-open-markets', rows: [], keys: [] };
  const first = [...new Set(markets.map((m) => m.close_time))].sort()[0];
  const ev = markets.filter((m) => m.close_time === first);
  const h = hoursTo(first, now);
  const eventTicker = ev[0].event_ticker;
  if (h > WINDOW_OPEN_H || h < WINDOW_CLOSE_H) {
    return { family, status: 'waiting', event: eventTicker, note: `next window ${(h > WINDOW_OPEN_H ? 'opens in ' + round(h - WINDOW_OPEN_H, 1) + 'h' : 'closed')}; release close ${first}`, rows: [], keys: [] };
  }
  const gn = await fetchers.gdpnow();
  const ageDays = (now - Date.parse(gn.date)) / 86400000;
  if (!(ageDays <= MAX_NOWCAST_AGE_DAYS)) return { family, status: 'stale-reference', event: eventTicker, note: `GDPNow ${gn.date} is ${round(ageDays, 1)}d old`, rows: [], keys: [] };
  const rows = []; const keys = [];
  for (const m of ev) {
    const key = `${m.ticker}|${first}`;
    if (seen.has(key)) continue;
    const book = touch(m); const refP = gdpRef(m.floor_strike, gn.nowcast, gn.sd);
    rows.push(makeRow({ family, now, window: first, market: m, book, take: gdpTake(book, refP), refP, ref: { nowcast: gn.nowcast, nowcastDate: gn.date, sd: gn.sd, quarter: gn.quarter }, extra: { hoursToClose: round(h, 2) } }));
    keys.push(key);
  }
  return { family, status: rows.length ? 'logged' : 'already-logged', event: eventTicker, rows, keys };
}
