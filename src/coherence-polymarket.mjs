/**
 * Cross-venue legs: Polymarket US daily-high brackets for the stations both venues list,
 * matched to Kalshi's by the polymarket-services-section logger's own matching
 * (CITIES, eventSlug, polymarketBracket). Public gateway only; no credential, no order.
 * First-pass quotes come from the event's best bid/ask with a provisional size (1000);
 * `polymarketDepth` reads the real book for the legs of a violation.
 */
import { CITIES, eventSlug, polymarketBracket, PM_TAKER } from '../../../../polymarket-services-section/src/cross-weather.mjs';
import { createPolymarketUsClient } from '../../../../polymarket-services-section/src/us-client.mjs';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const kalshiDateToken = (iso) => `-${iso.slice(2, 4)}${MON[Number(iso.slice(5, 7)) - 1]}${iso.slice(8, 10)}`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

let client;
const pm = () => (client ??= createPolymarketUsClient({ credentials: null }));

export async function polymarketExtras({ events }, { days = [0, 1, 2], throttleMs = 3200 } = {}) {
  const out = new Map();
  const stationOf = new Map();
  for (const e of events) {
    const city = CITIES.find((c) => c.high === e.series_ticker);
    const st = /\((CLI[A-Z0-9]+)\)/u.exec(e.markets[0]?.rules_primary ?? '')?.[1];
    if (city && st) stationOf.set(city.code, st);
  }
  const today = new Date(Date.now() - 8 * 3600_000);
  for (const city of CITIES) {
    const station = stationOf.get(city.code);
    if (!station) continue;
    for (const d of days) {
      const iso = new Date(today.getTime() + d * 86400_000).toISOString().slice(0, 10);
      let ev;
      try { ev = await pm().getEvent(eventSlug(city, 'high', iso)); } catch { await pause(throttleMs); continue; }
      await pause(throttleMs);
      const quotes = [];
      for (const m of ev?.markets ?? []) {
        if (m.closed || m.active === false) continue;
        const b = polymarketBracket(m.title ?? m.titleShort);
        if (!b) continue;
        const bid = num(m.bestBidQuote?.value ?? m.bestBidQuote); const ask = num(m.bestAskQuote?.value ?? m.bestAskQuote);
        quotes.push({
          id: m.slug, venue: 'polymarket', theta: PM_TAKER, interval: { lo: b.lo ?? -Infinity, hi: b.hi ?? Infinity },
          bids: bid && bid > 0 ? [{ price: bid, size: 1000 }] : [], asks: ask && ask < 1 ? [{ price: ask, size: 1000 }] : [],
        });
      }
      if (quotes.length) out.set(`${station}|${kalshiDateToken(iso)}`, { high: quotes, low: [] });
    }
  }
  return out;
}

/** The book of one Polymarket US market slug as YES-side levels. */
export async function polymarketDepth(slug) {
  const book = await pm().getBook(slug);
  const lv = (rows) => (rows ?? []).map((r) => ({ price: num(r.px?.value ?? r.px), size: num(r.qty?.value ?? r.qty) })).filter((x) => x.price !== null && x.size > 0);
  return { bids: lv(book?.bids).sort((a, b) => b.price - a.price), asks: lv(book?.offers).sort((a, b) => a.price - b.price) };
}
