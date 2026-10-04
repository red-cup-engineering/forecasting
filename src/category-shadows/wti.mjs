// Family 5: KXWTI daily (ICE settle of the front-month WTI contract, 14:30 ET) vs a lognormal-style normal model on CL=F.
// Model and rule are the category-edges record's KXWTI backtest (data/records/2026-10-04-category-edges/scripts/commod.py, commod_dig.py), unchanged:
//   S_T ~ Normal(F + b, sig^2 + sb^2), F = last completed 5-minute CL=F close, b = previous settled event's (ICE settle - CL=F at that event's close),
//   sig = rms 5-minute log return over the trailing 5 days * sqrt(bars expected to the settle, counted in the same window 7 days earlier) * F,
//   sb = population std of the daily basis changes over all earlier events (needs >= 5 changes). Vol multiplier k = 1.0.
//   Taker rule: YES at the ask if p - ask - fee1(ask) > 0.03, else NO at 1 - bid if (1-p) - (1-bid) - fee1(1-bid) > 0.03 (fee1 = 1-lot fee, as the backtest). ask > bid required.
// Horizons are the pooled 12/6/3/1h before close; one snapshot of every bracket per event+horizon.
import { Phi, fee, hoursTo, makeRow, openMarkets, touch, round, num } from './common.mjs';

export const family = 'wti';
export const SERIES = 'KXWTI';
export const HORIZONS = [12, 6, 3, 1]; export const WINDOW_H = 1 / 3; // snapshot taken when hoursToClose in (h - 20min, h]
export const THRESHOLD = 0.03; export const VOL_MULT = 1.0; export const MIN_BASIS_CHANGES = 5;
export const isDailyEvent = (event) => /^KXWTI-\d{2}[A-Z]{3}\d{2}14$/.test(event ?? ''); // the 14:30 ET daily ladder, not the monthly

export const horizonFor = (hours) => HORIZONS.find((h) => hours <= h && hours > h - WINDOW_H) ?? null;

/** bars: { T: ascending epoch seconds (bar start), P: close }. */
export function parseChart(json) {
  const r = json?.chart?.result?.[0]; const T = []; const P = [];
  if (!r) return { T, P };
  const c = r.indicators.quote[0].close;
  r.timestamp.forEach((t, i) => { if (c[i] !== null && c[i] !== undefined && Number.isFinite(c[i])) { T.push(t); P.push(c[i]); } });
  return { T, P };
}
const upper = (T, x) => { let lo = 0; let hi = T.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (T[mid] <= x) lo = mid + 1; else hi = mid; } return lo; }; // searchsorted right
/** Last bar whose start + 300s <= t (completed), at most 3 days old. */
export function px({ T, P }, t) { const i = upper(T, t - 300) - 1; return i >= 0 && t - T[i] < 86400 * 3 ? { p: P[i], t: T[i] } : null; }
/** Rms 5-minute log return over the trailing `days` days (null with < 100 bars). */
export function sigBar({ T, P }, t, days = 5) {
  const lo = upper(T, t - days * 86400); const hi = upper(T, t - 300); const n = hi - lo; if (n < 100) return null;
  let s = 0; for (let i = lo + 1; i < hi; i += 1) s += Math.log(P[i] / P[i - 1]) ** 2;
  return Math.sqrt(s / (n - 1));
}
export const nBars = ({ T }, t0, t1) => upper(T, t1 - 1e-9) - upper(T, t0 - 1e-9); // T in [t0, t1)

/** prior: [{ closeSec, val }] settled daily events (any order). Returns the reference for an event closing at closeSec, seen at nowSec. */
export function wtiForecast({ bars, prior, closeSec, nowSec }) {
  const basis = prior.filter((e) => e.closeSec < closeSec && Number.isFinite(e.val)).sort((a, b) => a.closeSec - b.closeSec)
    .map((e) => { const q = px(bars, e.closeSec); return q ? e.val - q.p : null; }).filter((v) => v !== null);
  if (basis.length < MIN_BASIS_CHANGES + 1) return null;
  const d = []; for (let j = 1; j < basis.length; j += 1) d.push(basis[j] - basis[j - 1]);
  const mean = d.reduce((a, b) => a + b, 0) / d.length; const sb = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
  const q = px(bars, nowSec); const s5 = sigBar(bars, nowSec); if (!q || s5 === null) return null;
  let nb = nBars(bars, nowSec - 7 * 86400, closeSec - 7 * 86400); if (nb === 0) nb = Math.max(1, Math.floor(((closeSec - nowSec) / 3600) * 12 * 0.7));
  const b = basis.at(-1);
  return { F: q.p + b, p0: q.p, b, sig: s5 * Math.sqrt(nb) * q.p, sb, nb, s5 };
}
/** P(YES) for a bracket under Normal(F, sig^2 k^2 + sb^2). */
export function bracketProb(m, { F, sig, sb }, k = VOL_MULT) {
  const sd = Math.sqrt((sig * k) ** 2 + (sb ?? 0) ** 2); if (!(sd > 0)) return null;
  const c = (x) => Phi((x - F) / sd); const fl = num(m.floor_strike); const cp = num(m.cap_strike);
  if (m.strike_type === 'greater') return fl === null ? null : 1 - c(fl);
  if (m.strike_type === 'less') return cp === null ? null : c(cp);
  if (fl === null || cp === null) return null;
  return c(cp + (cp === Math.round(cp * 100) / 100 ? 0.005 : 0)) - c(fl);
}
/** The backtest's would-take rule (1-lot fee, threshold 3c after fee, ask > bid). */
export function wtiTake(book, refP, thr = THRESHOLD) {
  if (refP === null || book.bid === null || book.ask === null || !(book.ask > book.bid)) return null;
  if (refP - book.ask - fee(book.ask, 1) > thr) return 'yes';
  const no = 1 - book.bid; if ((1 - refP) - no - fee(no, 1) > thr) return 'no';
  return null;
}

export async function tick({ client, now, seen, fetchers }) {
  const lo = Math.floor(now / 1000); const hi = Math.ceil(now / 1000 + HORIZONS[0] * 3600);
  const open = (await openMarkets(client, SERIES, { min_close_ts: lo, max_close_ts: hi })).filter((m) => isDailyEvent(m.event_ticker));
  const byEvent = new Map();
  for (const m of open) { if (!byEvent.has(m.event_ticker)) byEvent.set(m.event_ticker, []); byEvent.get(m.event_ticker).push(m); }
  const due = [...byEvent.entries()].map(([ev, ms]) => ({ ev, ms, h: horizonFor(hoursTo(ms[0].close_time, now)) })).filter((x) => x.h !== null && !seen.has(`${x.ev}|h${x.h}`));
  if (!due.length) return { family, status: byEvent.size ? 'waiting' : 'no-open-markets', note: byEvent.size ? `next ${[...byEvent.keys()][0]}` : null, rows: [], keys: [] };
  const [bars, prior] = await Promise.all([fetchers.wtiBars(), fetchers.wtiSettled(client)]);
  const rows = []; const keys = []; const refs = [];
  for (const { ev, ms, h } of due) {
    const closeSec = Date.parse(ms[0].close_time) / 1000;
    const f = wtiForecast({ bars, prior, closeSec, nowSec: now / 1000 });
    if (!f) { refs.push({ event: ev, h, note: 'no reference (history short or bars stale)' }); continue; }
    refs.push({ event: ev, h, F: round(f.F, 3), p0: f.p0, basis: round(f.b, 3), sig: round(f.sig, 3), sb: round(f.sb, 3) });
    for (const m of ms) {
      const refP = bracketProb(m, f); if (refP === null) continue;
      const book = touch(m);
      rows.push(makeRow({ family, now, window: `${ev}|h${h}`, market: m, book, take: wtiTake(book, refP), refP, ref: { F: round(f.F, 4), p0: f.p0, basis: round(f.b, 4), sig: round(f.sig, 4), sb: round(f.sb, 4), nBars: f.nb, strikeType: m.strike_type }, extra: { horizon: h, hoursToClose: round(hoursTo(m.close_time, now), 2), day: m.close_time.slice(0, 10) } }));
    }
    keys.push(`${ev}|h${h}`);
  }
  return { family, status: rows.length ? 'logged' : 'no-reference', event: due[0].ev, note: JSON.stringify(refs), rows, keys };
}
