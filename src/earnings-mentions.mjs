/**
 * Earnings-call mention markets, pure: strike parsing, quote extraction from candlesticks, no-lookahead
 * history features, a ridge logistic model, scoring, taker-fee economics and an event-clustered bootstrap.
 * Knowledge before the event: every feature of a market uses only calls that started strictly earlier.
 */

import { orderFee } from './fees.mjs';
export const isEarningsSeries = (t) => /^(KXEARNINGSMENTION|KXMENTIONEARN)/u.test(t);

export const normWord = (w) => String(w ?? '').toLowerCase().replace(/\s+/gu, ' ').trim();

/** Strike-type flags from the strike text. */
export function strikeFlags(word) {
  const w = normWord(word);
  return {
    isCount: /\(?\d+\s*\+\s*times?\)?|\d+\+/u.test(w) || /at least \d+/u.test(w),
    multiWord: /\s/u.test(w.replace(/\(.*?\)/gu, '').trim()),
    hasSlash: /\//u.test(w),
  };
}

const num = (x) => (x === null || x === undefined || x === '' ? null : Number(x));
const field = (o, k) => num(o?.[`${k}_dollars`] ?? o?.[k]);

/**
 * Executable yes quote at time tMs: the last candle ending at or before tMs that carries both a bid
 * and an ask, rejecting empty books (bid 0 / ask 1). Returns {bid, ask, mid, ageS, vol1m}.
 */
export function quoteAt(candles, tMs, maxAgeS = 6 * 3600) {
  const t = tMs / 1000;
  let best = null;
  for (const c of candles) {
    if (c.end_period_ts > t) break;
    best = c;
  }
  if (!best) return null;
  for (let i = candles.indexOf(best); i >= 0; i -= 1) {
    const c = candles[i];
    if (t - c.end_period_ts > maxAgeS) return null;
    const bid = field(c.yes_bid, 'close');
    const ask = field(c.yes_ask, 'close');
    if (bid === null || ask === null || ask <= bid - 1e-9 || (bid <= 0 && ask >= 1)) continue;
    return { bid, ask, mid: (bid + ask) / 2, ageS: t - c.end_period_ts, vol1m: num(c.volume_fp ?? c.volume) ?? 0 };
  }
  return null;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const logit = (p) => { const q = Math.min(1 - 1e-4, Math.max(1e-4, p)); return Math.log(q / (1 - q)); };

/**
 * No-lookahead history features. `rows`: {event, company, word, callStart, result:'yes'|'no'}.
 * Events are processed in call-start order; an event's features see only events with strictly
 * earlier callStart. Returns the rows with `.x` (feature object) added, in input order.
 */
export function buildFeatures(rows, { kCw = 2, kCo = 5, kWord = 5 } = {}) {
  const byEvent = new Map();
  for (const r of rows) { if (!byEvent.has(r.event)) byEvent.set(r.event, []); byEvent.get(r.event).push(r); }
  const events = [...byEvent.entries()].map(([event, rs]) => ({ event, callStart: rs[0].callStart, company: rs[0].company, rows: rs }))
    .sort((a, b) => a.callStart - b.callStart || (a.event < b.event ? -1 : 1));
  const companyEvents = new Map(); // company -> [{callStart, words:Map word->0/1}]
  const wordStat = new Map(); // word -> {y,n}
  const compStat = new Map(); // company -> {y,n}
  const glob = { y: 0, n: 0 };
  // Events sharing a callStart must not see each other: apply updates after the whole tie group.
  let i = 0;
  while (i < events.length) {
    let j = i;
    while (j < events.length && events[j].callStart === events[i].callStart) j += 1;
    const group = events.slice(i, j);
    for (const ev of group) {
      const hist = companyEvents.get(ev.company) ?? [];
      const gRate = glob.y + glob.n ? (glob.y + 1) / (glob.y + glob.n + 2) : 0.5;
      const co = compStat.get(ev.company) ?? { y: 0, n: 0 };
      const coRate = (co.y + kCo * gRate) / (co.y + co.n + kCo);
      for (const r of ev.rows) {
        const w = normWord(r.word);
        const ws = wordStat.get(w) ?? { y: 0, n: 0 };
        const wRate = (ws.y + kWord * gRate) / (ws.y + ws.n + kWord);
        let cwY = 0; let cwN = 0;
        for (const h of hist) { const v = h.words.get(w); if (v === 1) cwY += 1; else if (v === 0) cwN += 1; }
        const cwRate = (cwY + kCw * wRate) / (cwY + cwN + kCw);
        const prev = (k) => { const h = hist[hist.length - k]; if (!h) return 0; const v = h.words.get(w); return v === undefined ? 0 : v === 1 ? 1 : -1; };
        r.x = {
          lCw: logit(cwRate), nCw: Math.min(cwY + cwN, 4) / 4, p1: prev(1), p2: prev(2), p4: prev(4),
          lCo: logit(coRate), lWord: logit(wRate), nHist: Math.min(hist.length, 4) / 4,
          ...Object.fromEntries(Object.entries(strikeFlags(r.word)).map(([k, v]) => [k, v ? 1 : 0])),
        };
      }
    }
    for (const ev of group) {
      const hist = companyEvents.get(ev.company) ?? [];
      const words = new Map();
      for (const r of ev.rows) {
        const w = normWord(r.word); const y = r.result === 'yes' ? 1 : 0;
        words.set(w, y);
        const ws = wordStat.get(w) ?? { y: 0, n: 0 }; ws[y ? 'y' : 'n'] += 1; wordStat.set(w, ws);
        const co = compStat.get(ev.company) ?? { y: 0, n: 0 }; co[y ? 'y' : 'n'] += 1; compStat.set(ev.company, co);
        glob[y ? 'y' : 'n'] += 1;
      }
      hist.push({ callStart: ev.callStart, words }); companyEvents.set(ev.company, hist);
    }
    i = j;
  }
  return rows;
}

/**
 * Occurrences of a strike in a press-release text under Kalshi's rule shape: exact word/phrase or its
 * plural/possessive, any "A / B" alternative, parentheticals ("(5+ times)") dropped from the phrase.
 * Returns {count, need} where need is the N of an "N+ times" strike (1 otherwise).
 */
export function releaseMentions(word, text) {
  const w = normWord(word);
  const need = Number(/(\d+)\s*\+/u.exec(w)?.[1] ?? /at least (\d+)/u.exec(w)?.[1] ?? 1);
  const phrase = w.replace(/\(.*?\)/gu, ' ').replace(/\bat least \d+\b/gu, ' ').trim();
  const t = ` ${String(text).toLowerCase().replace(/[\u2018\u2019]/gu, "'").replace(/[^a-z0-9'&$%.\- ]/gu, ' ')} `;
  let count = 0;
  for (const alt of phrase.split('/').map((a) => a.trim()).filter(Boolean)) {
    const esc = alt.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/\s+/gu, '\\s+');
    count += (t.match(new RegExp(`(?<![a-z0-9])${esc}(?:s|es|'s|s')?(?![a-z0-9])`, 'gu')) ?? []).length;
  }
  return { count, need };
}

export const EDGAR_FEATURES = ['relHit', 'relMiss', 'relLogCount'];
export const FEATURES = ['lCw', 'nCw', 'p1', 'p2', 'p4', 'lCo', 'lWord', 'nHist', 'isCount', 'multiWord', 'hasSlash'];
const vec = (x, names) => [1, ...names.map((n) => x[n])];

/** Ridge logistic regression by Newton steps; intercept unpenalised. Returns {names, w}. */
export function fitLogistic(xs, ys, { names = FEATURES, ridge = 1, iters = 30 } = {}) {
  const X = xs.map((x) => vec(x, names)); const d = X[0].length;
  let w = new Array(d).fill(0);
  for (let it = 0; it < iters; it += 1) {
    const g = new Array(d).fill(0); const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let n = 0; n < X.length; n += 1) {
      const p = sigmoid(X[n].reduce((s, v, k) => s + v * w[k], 0)); const e = p - ys[n]; const h = p * (1 - p);
      for (let a = 0; a < d; a += 1) { g[a] += e * X[n][a]; for (let b = 0; b < d; b += 1) H[a][b] += h * X[n][a] * X[n][b]; }
    }
    for (let a = 1; a < d; a += 1) { g[a] += ridge * w[a]; H[a][a] += ridge; }
    H[0][0] += 1e-9;
    const step = solve(H, g);
    w = w.map((v, k) => v - step[k]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return { names, w };
}

function solve(A, b) {
  const n = b.length; const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c += 1) {
    let p = c; for (let r = c + 1; r < n; r += 1) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r += 1) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k += 1) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) { let s = M[r][n]; for (let k = r + 1; k < n; k += 1) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

export const predictLogit = (model, x) => vec(x, model.names).reduce((s, v, k) => s + v * model.w[k], 0);
export const predict = (model, x) => sigmoid(predictLogit(model, x));

export const brier = (ps, ys) => ps.reduce((s, p, i) => s + (p - ys[i]) ** 2, 0) / ps.length;
export const logLoss = (ps, ys) => ps.reduce((s, p, i) => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return s - (ys[i] ? Math.log(q) : Math.log(1 - q)); }, 0) / ps.length;

/** Kalshi taker fee for an order of `count` contracts at price P (dollars): 0.07*count*P*(1-P), rounded up to the account's $0.0001 grid. */
export const takerFee = (count, price) => orderFee(count, price);
/** Fee per contract for orders of 10. */
export const feePerContract = (price, lot = 10) => takerFee(lot, price) / lot;

/**
 * Decide and settle one market: buys the favoured side at its ask when edge (model prob minus ask) > thr.
 * Returns null (no trade) or {side, price, edge, pnl} with pnl per contract net of fee.
 */
export function tradeOutcome({ p, bid, ask, yes }, thr) {
  const yesEdge = p - ask; const noAsk = 1 - bid; const noEdge = (1 - p) - noAsk;
  let side = null;
  if (yesEdge > thr && yesEdge >= noEdge) side = 'yes'; else if (noEdge > thr) side = 'no';
  if (!side) return null;
  const price = side === 'yes' ? ask : noAsk;
  if (price <= 0 || price >= 1) return null;
  const win = side === 'yes' ? yes : 1 - yes;
  return { side, price, edge: side === 'yes' ? yesEdge : noEdge, pnl: win - price - feePerContract(price) };
}

/** Seeded RNG for reproducible bootstraps. */
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Mean of `value` over items, bootstrapped by resampling clusters (events). Returns {mean, lo, hi}. */
export function clusterBootstrap(items, clusterOf, value, { draws = 2000, seed = 7 } = {}) {
  const groups = new Map();
  for (const it of items) { const k = clusterOf(it); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(value(it)); }
  const gs = [...groups.values()].map((v) => ({ s: v.reduce((a, b) => a + b, 0), n: v.length }));
  const mean = gs.reduce((a, g) => a + g.s, 0) / Math.max(1, gs.reduce((a, g) => a + g.n, 0));
  const r = rng(seed); const means = [];
  for (let d = 0; d < draws; d += 1) { let s = 0; let n = 0; for (let k = 0; k < gs.length; k += 1) { const g = gs[Math.floor(r() * gs.length)]; s += g.s; n += g.n; } means.push(n ? s / n : 0); }
  means.sort((a, b) => a - b);
  return { mean, lo: means[Math.floor(draws * 0.025)], hi: means[Math.floor(draws * 0.975)], clusters: gs.length };
}

/** Distinct events of rows sorted by call start. */
export function eventOrder(rows) {
  const m = new Map(); for (const r of rows) if (!m.has(r.event)) m.set(r.event, r.callStart);
  return [...m.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([e]) => e);
}

const stack = (rs, qk) => ({ x: { m: logit(rs.q[qk].mid), g: logit(rs.p) } });

/**
 * Time-split backtest. `rows`: every settled market with {event, company, word, callStart, result,
 * quotes:{h24,h1,m5}} (quotes may be null). Features are computed over ALL rows (history), scoring uses
 * rows that have a quote at `scoreAt` (default h1). Split: median call start of scoreable events.
 *
 * Fit half is split in two temporal folds A, B. Model trained on A gives out-of-fold predictions on B,
 * from which the stacking weights and the trade threshold are chosen; the final model is trained on A+B
 * and applied to the untouched test half.
 */
export function backtest(rows, { names = FEATURES, scoreAt = 'h1', thresholds = [0.05, 0.08, 0.1, 0.15, 0.2, 0.25], ridge = 1, extra = null, entries = ['h24', 'h1', 'm5'], draws = 2000 } = {}) {
  buildFeatures(rows);
  if (extra) for (const r of rows) Object.assign(r.x, extra(r));
  for (const r of rows) r.y = r.result === 'yes' ? 1 : 0;
  const scoreable = rows.filter((r) => r.quotes?.[scoreAt]);
  const order = eventOrder(scoreable);
  const split = order.length >> 1;
  const rank = new Map(order.map((e, i) => [e, i]));
  const testEvents = new Set(order.slice(split));
  const splitStart = rows.find((r) => r.event === order[split]).callStart;
  const foldB = new Set(order.slice(split >> 1, split));
  const startB = rows.find((r) => r.event === order[split >> 1]).callStart;
  const trainA = rows.filter((r) => r.callStart < startB);
  const trainAB = rows.filter((r) => r.callStart < splitStart);
  const fit = (rs) => fitLogistic(rs.map((r) => r.x), rs.map((r) => r.y), { ridge, names });
  const modelA = fit(trainA); const modelAB = fit(trainAB);
  const B = scoreable.filter((r) => foldB.has(r.event)); const T = scoreable.filter((r) => testEvents.has(r.event));
  for (const r of B) r.p = predict(modelA, r.x);
  for (const r of T) r.p = predict(modelAB, r.x);
  const out = { counts: { rows: rows.length, events: new Set(rows.map((r) => r.event)).size, scoreable: scoreable.length, scoreableEvents: order.length, trainA: trainA.length, foldB: B.length, test: T.length, testEvents: testEvents.size, splitCallStart: new Date(splitStart).toISOString() } };
  out.baseRate = { fit: trainAB.reduce((s, r) => s + r.y, 0) / trainAB.length, test: T.reduce((s, r) => s + r.y, 0) / T.length };
  out.model = Object.fromEntries(['intercept', ...names].map((n, i) => [n, +modelAB.w[i].toFixed(3)]));
  const score = (rs, pf) => { const ps = rs.map(pf); const ys = rs.map((r) => r.y); return { n: rs.length, brier: brier(ps, ys), logLoss: logLoss(ps, ys) }; };
  const baseP = out.baseRate.fit;
  const mid = (r) => r.quotes[scoreAt].mid;
  // Stacking weights from fold B (out-of-fold model predictions), applied to test.
  const stackFit = fitLogistic(B.map((r) => ({ m: logit(mid(r)), g: logit(r.p) })), B.map((r) => r.y), { names: ['m', 'g'], ridge: 0.1 });
  const stackP = (r) => predict(stackFit, { m: logit(mid(r)), g: logit(r.p) });
  out.stack = { weights: { intercept: +stackFit.w[0].toFixed(3), market: +stackFit.w[1].toFixed(3), model: +stackFit.w[2].toFixed(3) } };
  out.score = {
    test: { base: score(T, () => baseP), market: score(T, mid), model: score(T, (r) => r.p), stacked: score(T, stackP) },
    foldB: { market: score(B, mid), model: score(B, (r) => r.p) },
  };
  // Does the model add information given the market: Brier gain of stacked over market, event-bootstrapped.
  const gain = (r) => (mid(r) - r.y) ** 2 - (stackP(r) - r.y) ** 2;
  out.score.stackGainBrier = clusterBootstrap(T, (r) => r.event, gain, { draws });
  const gainLL = (r) => { const l = (p) => -Math.log(Math.min(1 - 1e-6, Math.max(1e-6, r.y ? p : 1 - p))); return l(mid(r)) - l(stackP(r)); };
  out.score.stackGainLogLoss = clusterBootstrap(T, (r) => r.event, gainLL, { draws });
  const modelVsMktBrier = clusterBootstrap(T, (r) => r.event, (r) => (mid(r) - r.y) ** 2 - (r.p - r.y) ** 2, { draws });
  out.score.modelGainOverMarketBrier = modelVsMktBrier;
  // Economics. Threshold chosen on fold B out-of-fold predictions at the scoring entry.
  const evFor = (rs, thr, at) => rs.map((r) => { const q = r.quotes?.[at]; return q ? tradeOutcome({ p: r.p, bid: q.bid, ask: q.ask, yes: r.y }, thr) : null; });
  const grid = thresholds.map((thr) => { const t = evFor(B, thr, scoreAt).filter(Boolean); return { thr, n: t.length, ev: t.length ? t.reduce((s, x) => s + x.pnl, 0) / t.length : null }; });
  out.thresholdGrid = grid;
  const viable = grid.filter((g) => g.n >= 30 && g.ev !== null);
  const chosen = (viable.length ? viable.reduce((a, b) => (b.ev > a.ev ? b : a)) : grid[grid.length - 1]).thr;
  out.threshold = chosen;
  out.economics = {};
  out.trades = [];
  for (const at of entries) {
    const pairs = T.map((r) => ({ r, t: r.quotes?.[at] ? tradeOutcome({ p: r.p, bid: r.quotes[at].bid, ask: r.quotes[at].ask, yes: r.y }, chosen) : null })).filter((x) => x.t);
    const items = pairs.map(({ r, t }) => ({ event: r.event, ticker: r.ticker, ...t }));
    if (at === scoreAt) out.trades = pairs.map(({ r, t }) => ({ event: r.event, ticker: r.ticker, word: r.word, callStart: r.callStart, p: r.p, y: r.y, ...t }));
    out.economics[at] = items.length ? { n: items.length, events: new Set(items.map((i) => i.event)).size, hit: items.filter((i) => i.pnl + i.price > 0.5).length / items.length, meanPrice: items.reduce((s, i) => s + i.price, 0) / items.length, ev: clusterBootstrap(items, (i) => i.event, (i) => i.pnl, { draws }), yesShare: items.filter((i) => i.side === 'yes').length / items.length } : { n: 0 };
  }
  // Calibration table of the model on test.
  const bins = [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1.0001];
  out.calibration = bins.slice(0, -1).map((lo, i) => { const rs = T.filter((r) => r.p >= lo && r.p < bins[i + 1]); return { bin: `${lo}-${Math.min(1, bins[i + 1])}`, n: rs.length, meanModel: rs.length ? rs.reduce((s, r) => s + r.p, 0) / rs.length : null, meanMarket: rs.length ? rs.reduce((s, r) => s + mid(r), 0) / rs.length : null, freq: rs.length ? rs.reduce((s, r) => s + r.y, 0) / rs.length : null }; });
  out._testRows = T; out._stackFit = stackFit; out._model = modelAB;
  return out;
}
