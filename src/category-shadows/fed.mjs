// Family 2: KXFEDDECISION vs fed-funds futures. Daily (UTC day) log for the next 3 meetings.
// Reference as the record's fed_futures.py: month-average rate from the ZQ contract of the meeting month if >= 8 days remain after the
// decision, else the next month's contract; pre-meeting rate = EFFR for the first meeting, the previous meeting's implied post rate after that;
// the expected move is spread over the two adjacent 25bp outcomes. Rule: pure-futures, theta 0.02.
import { hoursTo, makeRow, openMarkets, touch, round } from './common.mjs';

export const family = 'fed';
export const THETA = 0.02; export const MEETINGS = 3; export const PRICE_BAND = [0.05, 0.95]; // taker price outside this is a 1-5c lottery/near-certainty, not an edge claim
const MONTH_CODE = 'FGHJKMNQUVXZ';
export const zqSymbol = (y, m) => `ZQ${MONTH_CODE[m - 1]}${String(y).slice(2)}.CBT`;
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Implied post-meeting rate (%) given a price lookup px(y, m) -> futures price, the meeting date and the pre rate. */
export function impliedAfter(meeting, preRate, px) {
  const y = meeting.getUTCFullYear(); const m = meeting.getUTCMonth() + 1; const N = dim(y, m); const d = meeting.getUTCDate(); const post = N - d;
  if (post >= 8) { const p = px(y, m); if (p != null) return ((100 - p) * N - preRate * d) / post; }
  const [y2, m2] = m < 12 ? [y, m + 1] : [y + 1, 1];
  const p2 = px(y2, m2); return p2 == null ? null : 100 - p2;
}
/** Expected change in 25bp steps -> probabilities on adjacent integer steps. */
export function stepDistribution(pre, post) {
  const delta = (post - pre) / 0.25; const k = Math.floor(delta); const f = delta - k; return { [k]: 1 - f, [k + 1]: f };
}
export function outcomeProb(dist, k) {
  let s = 0; for (const [j, v] of Object.entries(dist)) { const jj = Number(j); if (k === 2 ? jj >= 2 : k === -2 ? jj <= -2 : jj === k) s += v; } return s;
}
export function outcomeOf(m) {
  const cs = m.custom_strike ?? {}; const hike = cs.Hike; const cut = cs.Cut;
  if (hike === '>25') return 2; if (hike === '25') return 1; if (hike === '0') return 0; if (cut === '25') return -1; if (cut === '>25') return -2; return null;
}
export function fedTake(book, refP, theta = THETA) {
  const ok = (p) => p >= PRICE_BAND[0] && p <= PRICE_BAND[1];
  if (book.ask !== null && ok(book.ask) && refP - book.ask >= theta) return 'yes';
  if (book.bid !== null && ok(1 - book.bid) && book.bid - refP >= theta) return 'no';
  return null;
}

export async function tick({ client, now, seen, fetchers }) {
  const markets = await openMarkets(client, 'KXFEDDECISION');
  const byEvent = new Map();
  for (const m of markets) { if (!byEvent.has(m.event_ticker)) byEvent.set(m.event_ticker, []); byEvent.get(m.event_ticker).push(m); }
  const events = [...byEvent.entries()].map(([ev, ms]) => ({ ev, ms, close: ms[0].close_time })).sort((a, b) => a.close.localeCompare(b.close));
  if (!events.length) return { family, status: 'no-open-markets', rows: [], keys: [] };
  const day = new Date(now).toISOString().slice(0, 10);
  const target = events.slice(0, MEETINGS);
  const { effr, price } = await fetchers.fed(target.map((e) => new Date(e.close)));
  const rows = []; const keys = []; const refs = [];
  let pre = effr;
  for (const e of target) {
    const meeting = new Date(e.close);
    const post = impliedAfter(meeting, pre, price);
    if (post == null) { refs.push({ event: e.ev, note: 'no futures price' }); break; }
    const dist = stepDistribution(pre, post);
    refs.push({ event: e.ev, pre: round(pre, 4), post: round(post, 4), bp: round((post - pre) * 100, 2) });
    for (const m of e.ms) {
      const k = outcomeOf(m); if (k === null) continue;
      const key = `${m.ticker}|${day}`; if (seen.has(key)) continue;
      const book = touch(m); const refP = outcomeProb(dist, k);
      rows.push(makeRow({ family, now, window: day, market: m, book, take: fedTake(book, refP), refP, ref: { effr, preRate: round(pre, 4), impliedPost: round(post, 4), step: k }, extra: { hoursToClose: round(hoursTo(e.close, now), 1) } }));
      keys.push(key);
    }
    pre = post;
  }
  return { family, status: rows.length ? 'logged' : 'already-logged', event: target[0].ev, note: JSON.stringify(refs), rows, keys };
}
