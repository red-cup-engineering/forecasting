// Family 4: KXBTCD 4h upside tail. Cell from the record: 4h before close, strike 1 to 2 DVOL-sigma above spot, spread <= 6c, mid in [0.01, 0.99]; buy NO at the bid-side price.
// Reference: lognormal on DVOL (zero drift) and the same-time-of-day realised-variance lognormal (mean sum of squared 5-minute log returns over the same UTC window of the prior 30 days).
import { Phi, hoursTo, makeRow, openMarkets, touch, round } from './common.mjs';

export const family = 'btc';
export const WINDOW_LO_H = 3.5; export const WINDOW_HI_H = 4.0;
export const Z_BAND = [1, 2]; export const MAX_SPREAD = 0.06;

export function btcRefs({ strike, spot, dvol, hours, varTod }) {
  const T = hours / 8760; const x = Math.log(strike / spot);
  const sd = dvol * Math.sqrt(T);
  const out = { z: x / sd, pDvol: 1 - Phi((x + 0.5 * dvol * dvol * T) / sd), pTod: null, zTod: null };
  if (varTod > 0) { out.pTod = 1 - Phi((x + 0.5 * varTod) / Math.sqrt(varTod)); out.zTod = x / Math.sqrt(varTod); }
  return out;
}
export function btcTake(book, z) {
  if (book.mid === null || book.spread === null || book.spread > MAX_SPREAD || book.mid < 0.01 || book.mid > 0.99) return null;
  return z >= Z_BAND[0] && z < Z_BAND[1] ? 'no' : null;
}

export async function tick({ client, now, seen, fetchers }) {
  const lo = Math.floor(now / 1000 + WINDOW_LO_H * 3600); const hi = Math.ceil(now / 1000 + WINDOW_HI_H * 3600);
  const markets = (await openMarkets(client, 'KXBTCD', { min_close_ts: lo, max_close_ts: hi })).filter((m) => m.strike_type === 'greater' && hoursTo(m.close_time, now) > WINDOW_LO_H && hoursTo(m.close_time, now) <= WINDOW_HI_H);
  if (!markets.length) return { family, status: 'waiting', note: `no KXBTCD event closing in ${WINDOW_LO_H}-${WINDOW_HI_H}h`, rows: [], keys: [] };
  const fresh = markets.filter((m) => !seen.has(`${m.ticker}|${m.close_time}`));
  if (!fresh.length) return { family, status: 'already-logged', rows: [], keys: [] };
  const { spot, dvol } = await fetchers.btcSpotDvol();
  const rows = []; const keys = []; const tod = new Map();
  for (const m of fresh) {
    const h = hoursTo(m.close_time, now);
    if (!tod.has(m.close_time)) tod.set(m.close_time, await fetchers.varTod(Date.parse(m.close_time), 4).catch(() => null));
    const varTod = tod.get(m.close_time);
    const r = btcRefs({ strike: m.floor_strike, spot, dvol, hours: h, varTod });
    const book = touch(m); const take = btcTake(book, r.z);
    keys.push(`${m.ticker}|${m.close_time}`);
    if (!take) continue; // only cell hits are logged for this high-volume family
    rows.push(makeRow({ family, now, window: m.close_time, market: m, book, take, refP: r.pDvol, ref: { spot, dvol, z: round(r.z, 3), zTod: round(r.zTod, 3), pTod: round(r.pTod), varTod: round(varTod, 8), hours: round(h, 3) }, extra: { day: m.close_time.slice(0, 10) } }));
  }
  return { family, status: rows.length ? 'logged' : 'no-cell-hits', event: markets[0].event_ticker, note: `spot ${spot} dvol ${dvol} evaluated ${fresh.length}`, rows, keys };
}
