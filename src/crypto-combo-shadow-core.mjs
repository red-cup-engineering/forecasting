// Pure parts of the crypto combo shadow lane (scripts/crypto-combo-shadow.mjs). SHADOW ONLY: nothing here touches a venue.
import { windowOf, jointFair } from './crypto-joint.mjs';

export const ASSETS = ['BTC', 'ETH', 'XRP', 'DOGE', 'SOL', 'BNB', 'ZEC', 'HYPE', 'NEAR'];
export const QUOTE_EDGE = 0.02;
const num = (v) => { if (v === undefined || v === null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

export const fnv = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; };
export const sampled = (ticker, n) => n <= 1 || fnv(ticker) % n === 0;

/** An RFQ whose legs are all KX<ASSET>15M markets of ONE window (shared outcomes). Returns the compact row or null. */
export function cryptoRfq(q) {
  const legs = (q?.mve_selected_legs ?? []).map((l) => ({ m: l.market_ticker, side: l.side }));
  if (!legs.length || !q.market_ticker) return null;
  const ws = legs.map((l) => windowOf(l.m));
  if (ws.some((w) => !w || !ASSETS.includes(w.asset))) return null;
  if (new Set(ws.map((w) => w.closeMs)).size !== 1) return null;
  if (new Set(ws.map((w) => w.asset)).size !== legs.length) return null;
  return { id: q.id, ticker: q.market_ticker, created: q.created_ts, createdMs: Date.parse(q.created_ts), size: num(q.target_cost_dollars) ?? num(q.contracts_fp), legs: legs.map((l, i) => ({ ...l, asset: ws[i].asset })), openMs: ws[0].openMs, closeMs: ws[0].closeMs };
}

/** Mid of the YES book, or null when a side is empty. */
export function midOf(m) {
  const bid = num(m.yes_bid_dollars ?? m.bid); const ask = num(m.yes_ask_dollars ?? m.ask);
  if (!(ask > 0) || bid === null || !(ask >= bid) || (bid === 0 && ask >= 1)) return null;
  return { bid, ask, mid: (bid + ask) / 2 };
}

/** Shadow decision for one crypto RFQ given leg market rows (by ticker), rho {assets,rho}, and clocks. */
export function decide(rfq, marketsByTicker, rho, { now, fetchedAt = now, samples = 8000 } = {}) {
  const books = rfq.legs.map((l) => { const m = marketsByTicker[l.m]; return m ? midOf(m) : null; });
  const base = { rfqId: rfq.id, combo: rfq.ticker, t: now, created: rfq.created, closeMs: rfq.closeMs, openMs: rfq.openMs, size: rfq.size };
  if (now >= rfq.closeMs) return { ...base, skip: 'closed' };
  const bad = books.findIndex((b) => !b);
  if (bad >= 0) return { ...base, skip: `no-book:${rfq.legs[bad].m}` };
  const marg = books.map((b) => b.mid);
  const sideP = rfq.legs.map((l, i) => (l.side === 'yes' ? marg[i] : 1 - marg[i]));
  const midJoint = jointFair(rfq.legs, marg, rho, { samples });
  const indepMid = sideP.reduce((a, b) => a * b, 1);
  return { ...base, legs: rfq.legs.map((l, i) => ({ m: l.m, side: l.side, bid: books[i].bid, ask: books[i].ask, mid: marg[i] })), midJoint, indepMid, ourQuote: midJoint + QUOTE_EDGE, bookAgeMs: now - fetchedAt, rfqLagMs: now - rfq.createdMs };
}

/** Trade-poll schedule: offsets after creation, then every 10 min, then one last poll at close+30 s. */
export const POLL_OFFSETS_S = [4, 10, 20, 40, 80, 160, 320, 600];
export function nextPollAt(st) {
  if (st.final) return Infinity;
  const finalAt = st.closeMs + 30000;
  const regular = st.i < POLL_OFFSETS_S.length ? st.createdMs + POLL_OFFSETS_S[st.i] * 1000 : (st.last ?? st.createdMs) + 600000;
  return Math.min(regular, finalAt);
}

/** Combo outcome from leg results ({ticker: 'yes'|'no'|''}): true/false, or null while a leg is unsettled. */
export function comboOutcome(legs, results) {
  let all = true;
  for (const l of legs) { const r = results[l.m]; if (r !== 'yes' && r !== 'no') return null; if (r !== l.side) all = false; }
  return all;
}

// ------------------------------------------------------------------ scoring

/** Delete-one-group jackknife of stat(rows). Returns {est, se, groups}. */
export function jackknife(rows, groupOf, stat) {
  const est = stat(rows);
  const by = new Map(); for (const r of rows) { const g = groupOf(r); (by.get(g) ?? by.set(g, []).get(g)).push(r); }
  const gs = [...by.keys()]; const G = gs.length;
  if (G < 2) return { est, se: NaN, groups: G };
  const loo = gs.map((g) => stat(rows.filter((r) => groupOf(r) !== g)));
  const bar = loo.reduce((a, b) => a + b, 0) / G;
  return { est, se: Math.sqrt(((G - 1) / G) * loo.reduce((a, b) => a + (b - bar) ** 2, 0)), groups: G };
}
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export function slope(rows, y, x) {
  const mx = mean(rows.map(x)); const my = mean(rows.map(y));
  let sxy = 0; let sxx = 0; for (const r of rows) { sxy += (x(r) - mx) * (y(r) - my); sxx += (x(r) - mx) ** 2; }
  return sxx > 0 ? sxy / sxx : NaN;
}

/**
 * Settled rows -> score. rows: [{window, y (0/1), midJoint, indepMid, ourQuote, prints:[{p, takerYes, ms}]}] one per combo.
 * Print = first print; fill = first taker-bought-YES print at or above ourQuote (we sell YES at ourQuote).
 */
export function score(rows) {
  const matched = rows.filter((r) => r.prints.length).map((r) => ({ ...r, p: r.prints[0].p }));
  const filled = rows.map((r) => { const f = r.prints.find((x) => x.takerYes && x.p >= r.ourQuote); return f ? { ...r, p: f.p } : null; }).filter(Boolean);
  const g = (r) => r.window;
  const J = (rs, f) => jackknife(rs, g, (s) => mean(s.map(f)));
  const brier = (f) => (r) => (f(r) - r.y) ** 2;
  const t = (j) => (j.se > 0 ? j.est / j.se : NaN);
  const pnlQuote = J(filled, (r) => r.ourQuote - r.y); const pnlPrint = J(filled, (r) => r.p - r.y);
  const gap = J(matched, (r) => r.p - r.midJoint);
  return {
    rows: rows.length, matched: matched.length, filled: filled.length, windows: new Set(rows.map(g)).size, windowsMatched: new Set(matched.map(g)).size, windowsFilled: new Set(filled.map(g)).size,
    fillRate: matched.length ? filled.length / matched.length : NaN,
    gapPrintMinusMidJoint: { ...gap, t: t(gap) },
    gapPrintMinusIndep: J(matched, (r) => r.p - r.indepMid),
    slopePrintOnMidJoint: jackknife(matched, g, (s) => slope(s, (r) => r.p, (r) => r.midJoint)),
    brier: { print: J(matched, brier((r) => r.p)), midJoint: J(matched, brier((r) => r.midJoint)), indepMid: J(matched, brier((r) => r.indepMid)) },
    pnlAtQuote: { ...pnlQuote, t: t(pnlQuote) }, pnlAtPrint: { ...pnlPrint, t: t(pnlPrint) },
    hitRate: filled.length ? filled.filter((r) => r.y === 0).length / filled.length : NaN,
  };
}
