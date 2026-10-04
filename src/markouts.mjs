/**
 * Maker mark-outs on the recorded Kalshi trade tape, pure. The adverse-selection term of making a market in play.
 *
 * Every trade has a taker (taker_outcome_side) and a maker on the other side. In YES-price terms a maker whose
 * counterparty took YES sold YES at p; one whose counterparty took NO bought YES at p. Marked at horizon h
 * against the first later trade on the same market at or after t+h (accepted within a tolerance of
 * max(h/2, 1 s), so a stale tape is not read as a zero move):
 *
 *   markout = -(p_later - p)  if the taker bought YES        (maker short YES)
 *           = +(p_later - p)  if the taker bought NO         (maker long YES)
 *
 * in dollars per contract; negative is adverse selection, the cost of being picked off. The mean is the per-trade
 * mean, the size-weighted mean weights by contracts. The 95% interval is normal on the per-trade mean and treats
 * trades as independent, which a burst of sweep fills is not: it is a lower bound on the uncertainty.
 */
export const HORIZONS = [1000, 5000, 30000, 120000];

/** @param {{r: number, p: number}[]} sorted one market's trades, ascending r. @returns first index with r >= t, or length */
function lowerBound(sorted, t) {
  let lo = 0; let hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].r < t) lo = mid + 1; else hi = mid; }
  return lo;
}

/**
 * @param {{ticker: string, r: number, p: number, count: number, takerYes: boolean}[]} trades any order
 * @returns rows {ticker, r, p, count, takerYes, mo: {[h]: number|null}}
 */
export function markouts(trades, horizons = HORIZONS) {
  const byMarket = new Map();
  for (const t of trades) (byMarket.get(t.ticker) ?? byMarket.set(t.ticker, []).get(t.ticker)).push(t);
  const rows = [];
  for (const list of byMarket.values()) {
    list.sort((a, b) => a.r - b.r);
    for (const t of list) {
      const mo = {};
      for (const h of horizons) {
        const i = lowerBound(list, t.r + h);
        const later = list[i];
        mo[h] = later && later.r - (t.r + h) <= Math.max(h / 2, 1000) ? (t.takerYes ? -1 : 1) * (later.p - t.p) : null;
      }
      rows.push({ ticker: t.ticker, r: t.r, p: t.p, count: t.count, takerYes: t.takerYes, mo });
    }
  }
  return rows;
}

/** Mean, size-weighted mean and 95% CI of the non-null values. */
export function meanCi(values) {
  const xs = values.filter((v) => v.x !== null && Number.isFinite(v.x));
  const n = xs.length; if (!n) return { n: 0, mean: null, lo: null, hi: null, wmean: null };
  const mean = xs.reduce((s, v) => s + v.x, 0) / n;
  const w = xs.reduce((s, v) => s + v.w, 0);
  const wmean = w > 0 ? xs.reduce((s, v) => s + v.x * v.w, 0) / w : null;
  if (n < 2) return { n, mean, lo: null, hi: null, wmean };
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v.x - mean) ** 2, 0) / (n - 1));
  const half = 1.96 * sd / Math.sqrt(n);
  return { n, mean, lo: mean - half, hi: mean + half, wmean };
}

/** Group mark-out rows by `keyFn(row)` and summarise each horizon. @returns {[key: string]: {[h]: meanCi}} */
export function summarize(rows, keyFn, horizons = HORIZONS) {
  const groups = new Map();
  for (const r of rows) { const k = keyFn(r); (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
  const out = {};
  for (const [k, g] of [...groups].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    out[k] = { trades: g.length, contracts: g.reduce((s, r) => s + r.count, 0) };
    for (const h of horizons) out[k][h] = meanCi(g.map((r) => ({ x: r.mo[h], w: r.count })));
  }
  return out;
}

/** The game phase of a feed row: ESPN `state` when the row has it, else derived from the status name (rows before 2026-10-04 PM). */
export function phaseOfRow(row) {
  if (row.state) return row.state;
  const s = row.status ?? '';
  return /SCHEDULED|PRE/u.test(s) ? 'pre' : /FINAL|FULL_TIME|POSTPONED|CANCEL/u.test(s) ? 'post' : 'in';
}

/**
 * Index feed rows by game code for `phaseAt`. Rows carry `code` (new recorder) or `event` (original recorder).
 * @returns {Map<string, {r: number, phase: string}[]>} ascending by r
 */
export function phaseIndex(feedRows) {
  const idx = new Map();
  for (const f of feedRows) {
    const code = f.code ?? (f.event ? f.event.split('-').slice(1).join('-') : null); if (!code) continue;
    (idx.get(code) ?? idx.set(code, []).get(code)).push({ r: f.r, phase: phaseOfRow(f) });
  }
  for (const l of idx.values()) l.sort((a, b) => a.r - b.r);
  return idx;
}

/** 'pre-game' | 'in-play' | 'post-game' by ESPN status at time t, or 'no-feed' if no row for the game precedes t. */
export function phaseAt(idx, code, t) {
  const l = idx.get(code); if (!l) return 'no-feed';
  let lo = 0; let hi = l.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (l[mid].r <= t) lo = mid + 1; else hi = mid; }
  if (lo === 0) return 'no-feed';
  return { pre: 'pre-game', in: 'in-play', post: 'post-game' }[l[lo - 1].phase];
}

/** A recorded Kalshi `trade` message ({r, m}) as a trade row, or null. Prices are YES-side dollars. */
export function tradeOf(rec) {
  const m = rec?.m; if (m?.type !== 'trade' || !m.msg) return null;
  const x = m.msg; const p = Number(x.yes_price_dollars); const count = Number(x.count_fp);
  const side = x.taker_outcome_side ?? x.taker_side;
  if (!Number.isFinite(p) || (side !== 'yes' && side !== 'no')) return null;
  return { ticker: x.market_ticker, r: rec.r, p, count: Number.isFinite(count) ? count : 1, takerYes: side === 'yes', id: x.trade_id };
}

/** Series and game code of a market ticker KXMLBHIT-26OCT041600SDMIL-PLAYER-1. */
export function parseTicker(ticker) { const [series, ...rest] = ticker.split('-'); return { series, code: rest[0] ? `${rest[0]}` : null }; }
