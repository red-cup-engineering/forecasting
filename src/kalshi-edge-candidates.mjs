// Pure core of the Kalshi edge-candidate search: given settled markets and their pre-close
// candlesticks, measure -- per (series family, hours before close, price bucket, side, mode) --
// how often the contract paid versus what it cost, net of Kalshi's fee, and name the cells whose
// edge survives a held-out half of the window. No I/O here; scripts/derive-set-of-kalshi-edge-candidates.mjs
// does the fetching and writing. Paper research only: nothing here places an order.
//
// Honest limits, stated once: a "maker" trade assumes the resting order fills at the quoted
// bid/ask (an upper bound -- real fills are adverse-selected); quotes are hourly candle closes;
// one week of settled markets is a short window, so a candidate is a hypothesis to forward-test,
// not a proven edge. The test half is chosen after seeing the data's time span, not the results.

import { orderFeePerContract } from './fees.mjs';
export const HORIZONS_HOURS = [1, 2, 6, 24];
/** Price paid per contract, in whole cents, grouped into bands (inclusive). */
export const PRICE_BUCKETS = [[1, 5], [6, 10], [11, 20], [21, 35], [36, 50], [51, 65], [66, 80], [81, 90], [91, 95], [96, 99]];
export const MODES = ['taker', 'maker'];
export const SIDES = ['yes', 'no'];

/** Kalshi taker fee for one order of `count` contracts at `price` dollars: ceil-to-cent of 0.07*mult*C*P*(1-P); per contract. */
export const kalshiTakerFee = (price, { count = 10, multiplier = 1 } = {}) => orderFeePerContract(count, price, { multiplier });

/** Maker fee per contract: free on plain 'quadratic' series, 0.0175*mult*P*(1-P) (ceil-to-cent per order) where the series charges makers. */
export const kalshiMakerFee = (price, { count = 10, multiplier = 1, feeType = 'quadratic' } = {}) => orderFeePerContract(count, price, { multiplier, maker: true, feeType });

/** Index into PRICE_BUCKETS for a price in dollars, or -1. */
export function priceBucketIndex(price) {
  const cents = Math.round(price * 100);
  return PRICE_BUCKETS.findIndex(([lo, hi]) => cents >= lo && cents <= hi);
}

/** Wilson score interval for `successes` (may be fractional) out of `n`. */
export function wilsonInterval(successes, n, z = 1.96) {
  if (!(n > 0)) return { low: null, high: null };
  const p = successes / n, denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Standard normal quantile (Acklam's rational approximation). */
export function normalQuantile(p) {
  if (!(p > 0 && p < 1)) throw new RangeError('normalQuantile: p must be in (0,1)');
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const lowCut = 0.02425;
  if (p < lowCut) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - lowCut) return -normalQuantile(1 - p);
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * The bid and ask at the last candle ending at or before `horizonHours` before close, or null
 * when there is no usable two-sided quote (crossed, one-sided, spread wider than maxSpread, or stale).
 * @param {{end_period_ts:number, yes_bid:{close_dollars:string}, yes_ask:{close_dollars:string}}[]} candles ascending
 */
export function quoteAt(candles, closeSeconds, horizonHours, { maxSpread = 0.1, maxStaleSeconds = 4 * 3600 } = {}) {
  const at = closeSeconds - horizonHours * 3600;
  let pick = null;
  for (const candle of candles ?? []) { if (candle.end_period_ts <= at) pick = candle; else break; }
  if (!pick || at - pick.end_period_ts > maxStaleSeconds) return null;
  const bid = Number(pick.yes_bid?.close_dollars || 0), ask = Number(pick.yes_ask?.close_dollars || 0);
  if (!(bid > 0 && bid < ask && ask < 1) || ask - bid > maxSpread) return null;
  return { bid, ask };
}

/**
 * The eight single-contract trades a two-sided quote offers: buy YES or NO, at the touch (taker)
 * or resting on our side (maker). Each carries its entry cost, its payoff and its fee.
 * @returns {{side:string, mode:string, cost:number, win:number, fee:number, bucket:number}[]}
 */
export function tradesFromQuote({ bid, ask }, yesWon, { feeType = 'quadratic', multiplier = 1, orderSize = 10 } = {}) {
  const trades = [];
  const push = (side, mode, cost) => {
    const bucket = priceBucketIndex(cost);
    if (bucket < 0) return;
    const win = (side === 'yes') === yesWon ? 1 : 0;
    const fee = mode === 'taker' ? kalshiTakerFee(cost, { count: orderSize, multiplier }) : kalshiMakerFee(cost, { count: orderSize, multiplier, feeType });
    trades.push({ side, mode, cost, win, fee, bucket });
  };
  push('yes', 'taker', ask);
  push('no', 'taker', 1 - bid);
  push('yes', 'maker', bid);
  push('no', 'maker', 1 - ask);
  return trades;
}

/** Stable 32-bit FNV-1a hash, for deterministic event sampling. */
export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Prefix families discovered from the series tickers themselves: the shortest prefix (>= 6
 * characters) shared by at least `minSeries` series, so KXHIGHNY and KXHIGHCHI fall in KXHIGH.
 * Series with no such prefix get no prefix family. Pure.
 * @param {string[]} seriesTickers
 * @returns {Map<string,string>} series ticker -> prefix family name ("KXHIGH*")
 */
export function derivePrefixFamilies(seriesTickers, { minSeries = 3, minLength = 6 } = {}) {
  const unique = [...new Set(seriesTickers)];
  const count = new Map();
  for (const ticker of unique) for (let n = minLength; n < ticker.length; n += 1) count.set(ticker.slice(0, n), (count.get(ticker.slice(0, n)) ?? 0) + 1);
  const result = new Map();
  for (const ticker of unique) {
    for (let n = minLength; n < ticker.length; n += 1) {
      const prefix = ticker.slice(0, n);
      if ((count.get(prefix) ?? 0) >= minSeries) { result.set(ticker, `${prefix}*`); break; }
    }
  }
  return result;
}

const cellKey = (family, horizon, bucket, side, mode) => `${family}\u0001${horizon}\u0001${bucket}\u0001${side}\u0001${mode}`;

/** A fresh accumulator for event-level aggregation (so correlated markets of one event count once). */
export function newEventAccumulator(firstCloseSeconds) {
  return { firstClose: firstCloseSeconds, cells: new Map() };
}

/** Add one market's trades to its event's accumulator under every family label that applies. */
export function addMarketToEvent(accumulator, families, horizon, trades) {
  for (const trade of trades) {
    for (const family of families) {
      const key = cellKey(family, horizon, trade.bucket, trade.side, trade.mode);
      const cell = accumulator.cells.get(key) ?? { n: 0, win: 0, cost: 0, fee: 0 };
      cell.n += 1; cell.win += trade.win; cell.cost += trade.cost; cell.fee += trade.fee;
      accumulator.cells.set(key, cell);
    }
  }
}

/** The empty book of cells, keyed by half ('fit' | 'test'). */
export function newCellBook() {
  return { fit: new Map(), test: new Map() };
}

/** Fold a finished event into the book: each cell contributes the event's mean win, cost and fee as one unit. */
export function foldEvent(book, accumulator, cutoffSeconds) {
  const half = accumulator.firstClose < cutoffSeconds ? 'fit' : 'test';
  const target = book[half];
  for (const [key, cell] of accumulator.cells) {
    const w = cell.win / cell.n, c = cell.cost / cell.n, f = cell.fee / cell.n, pnl = w - c - f;
    const agg = target.get(key) ?? { events: 0, markets: 0, win: 0, cost: 0, fee: 0, pnl: 0, pnl2: 0 };
    agg.events += 1; agg.markets += cell.n; agg.win += w; agg.cost += c; agg.fee += f; agg.pnl += pnl; agg.pnl2 += pnl * pnl;
    target.set(key, agg);
  }
}

/** Summarise one half-cell: win rate with Wilson interval, mean cost and fee, EV per contract with lower bounds. */
export function summariseCell(agg, z) {
  if (!agg || agg.events === 0) return null;
  const n = agg.events, winRate = agg.win / n, meanCost = agg.cost / n, meanFee = agg.fee / n;
  const wilson = wilsonInterval(agg.win, n, z);
  const ev = winRate - meanCost - meanFee;
  const variance = n > 1 ? Math.max(0, (agg.pnl2 - (agg.pnl * agg.pnl) / n) / (n - 1)) : 0;
  return {
    events: n, markets: agg.markets, winRate, winLow: wilson.low, winHigh: wilson.high, meanCost, meanFee,
    ev, evLowerWilson: wilson.low - meanCost - meanFee, evLowerCluster: ev - (z * Math.sqrt(variance / n)),
  };
}

/**
 * Join the fit and test halves per cell and rank the lanes: a candidate has >= minEvents distinct
 * events in the TEST half, a positive TEST lower bound on EV per contract, and a positive FIT-half
 * EV (the same direction it was found in). Cells are also graded against a Bonferroni-corrected z
 * over every cell that reached minEvents, so a reader sees which survive the multiple-comparisons bite.
 * @returns {{tested: number, zBonferroni: number, cells: object[], candidates: object[]}}
 */
export function evaluateCells(book, { z = 1.96, minEvents = 30 } = {}) {
  const keys = new Set([...book.fit.keys(), ...book.test.keys()]);
  const rows = [];
  for (const key of keys) {
    const [family, horizon, bucket, side, mode] = key.split('\u0001');
    const test = summariseCell(book.test.get(key), z), fit = summariseCell(book.fit.get(key), z);
    if (!test || test.events < minEvents) continue;
    rows.push({ family, horizonHours: Number(horizon), bucket: PRICE_BUCKETS[Number(bucket)], side, mode, fit, test, key });
  }
  const tested = rows.length;
  const zBonferroni = tested > 0 ? normalQuantile(1 - 0.025 / tested) : z;
  for (const row of rows) {
    const bonf = summariseCell(book.test.get(row.key), zBonferroni);
    row.test.evLowerBonferroni = bonf.evLowerWilson;
    row.survivesBonferroni = bonf.evLowerWilson > 0 && (row.fit?.ev ?? -1) > 0;
    row.isCandidate = row.test.evLowerWilson > 0 && (row.fit?.ev ?? -1) > 0 && (row.fit?.events ?? 0) > 0;
    delete row.key;
  }
  rows.sort((a, b) => b.test.evLowerWilson - a.test.evLowerWilson);
  return { tested, zBonferroni, cells: rows, candidates: rows.filter((row) => row.isCandidate) };
}

const pct = (x, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const cents = (x, digits = 2) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}c`;

/** A plain-language statement of a lane's rule. */
export function describeRule(row) {
  const [lo, hi] = row.bucket;
  const how = row.mode === 'taker' ? 'at the current offer (taker)' : `by resting an order at your own side of the spread (maker; assumes it fills)`;
  const scope = row.family.startsWith('category:') ? `any ${row.family.slice(9)} market` : row.family.startsWith('series:') ? `a ${row.family.slice(7)} market` : `a market in the ${row.family} family`;
  return `About ${row.horizonHours}h before close, in ${scope}, buy ${row.side.toUpperCase()} ${how} when the price you pay is ${lo}-${hi}c. `
    + `Held-out half: it paid ${pct(row.test.winRate)} of the time over ${row.test.events} distinct events (Wilson low ${pct(row.test.winLow)}) against an average cost of ${(row.test.meanCost * 100).toFixed(1)}c plus ${(row.test.meanFee * 100).toFixed(2)}c fee `
    + `-> EV ${cents(row.test.ev)} per contract, lower bound ${cents(row.test.evLowerWilson)}. Fit half: EV ${cents(row.fit.ev)} over ${row.fit.events} events.`;
}

/** Markdown README for a run: window, method, top candidates (or the honest absence of any). */
export function renderCandidatesReadme({ asOf, window, counts, evaluation, topN = 15, params }) {
  const lines = [];
  lines.push(`# Kalshi edge candidates, ${asOf.slice(0, 10)}`, '');
  lines.push(`Window: settled non-combo markets closing ${window.from} .. ${window.to} (fit half to ${window.cutoff}, test half after). Paper research; nothing was traded.`, '');
  lines.push(`Markets read ${counts.marketsRead}, with a usable quote at some horizon ${counts.marketsQuoted}, events ${counts.events}. Cells with >= ${params.minEvents} distinct test events: ${evaluation.tested}; candidates: ${evaluation.candidates.length}; surviving a Bonferroni z of ${evaluation.zBonferroni.toFixed(2)}: ${evaluation.candidates.filter((c) => c.survivesBonferroni).length}.`, '');
  lines.push('A candidate lane is a (family, horizon, price bucket, side, mode) whose TEST-half lower confidence bound (Wilson on event-level win rate, z=' + params.z + ') of EV per contract after fee is above zero with >= ' + params.minEvents + ' distinct events, and whose FIT-half EV was also positive. Taker fee: 0.07*P*(1-P) rounded up to the cent per order of ' + params.orderSize + '. Maker trades are free on "quadratic" series and assume the resting order fills (an upper bound).', '');
  if (evaluation.candidates.length === 0) lines.push('**No candidate survived this window.** That is a finding: at this sample size no cell cleared its held-out lower bound.', '');
  else {
    lines.push(`## Top ${Math.min(topN, evaluation.candidates.length)} by test-half lower bound`, '');
    evaluation.candidates.slice(0, topN).forEach((row, i) => {
      lines.push(`${i + 1}. **${row.family}** ${row.horizonHours}h ${row.side.toUpperCase()} ${row.mode} ${row.bucket[0]}-${row.bucket[1]}c${row.survivesBonferroni ? ' (survives Bonferroni)' : ''}`, `   ${describeRule(row)}`, '');
    });
  }
  lines.push('## Cautions', '', '- One week is short: sports and crypto dominate the event counts; a lane that wins here may be a regime of this week.', '- Quotes are hourly candle closes, not tradeable fills; a favourite at 99c may have no depth.', '- Cells overlap (a series sits inside its prefix family and its category); the candidates are correlated, not independent.', '- Admit a lane only by forward-testing it on markets that had not closed when it was named.', '');
  return lines.join('\n');
}
