// Prop-market coherence: pathwise constraints between the player-prop markets of ONE game.
//
// Frame: a quantifier market ("player X records >= k of stat S") is adjoint to its witnesses -- the event
// {S_X >= k} is a subset of worlds, and every rulebook fact "S_X >= k implies T_X >= j" is an inclusion of
// those subsets, hence the linear inequality  Y_{S,k} <= Y_{T,j}  on the {0,1} payoffs Y, valid in EVERY world
// the rules allow. This module only encodes inclusions / counting facts that hold pathwise by the stat definitions
// (see RULES below for the quoted settlement text each rests on). Nothing statistical is assumed.
//
// Every constraint is the linear inequality  sum_i w_i Y_i <= b  (w in {+1,-1}, b integer), kinds:
//   ladder       Y_{S,k+1} <= Y_{S,k}                        ("at least k" ladders are nested)
//   implication  Y_{S,k}   <= Y_{T,j}                        (stat identity/inequality between series, same player)
//   sum          Y_{S,a} + Y_{T,b} - Y_{U,a+b} <= 1          (U = S + T pathwise: Frechet lower bound on the sum market)
//                Y_{S,a}+Y_{T,b}+Y_{V,c} - Y_{U,a+b+c} <= 2
//   exclusive    sum_{X listed} Y_{first TD of X} (+ No-TD) <= 1   (at most one first touchdown / one "no touchdown")
//   notd         Y_{TD,X,1+} + Y_{NoTD} <= 1                 (a game with no touchdown has no scorer)
//
// Pure: no I/O, no clock, no network.
import { identity, priceIdentity, fee } from './pathwise-identities.mjs';

// Quotes from the settlement text of each series (rules_primary / rules_secondary as served 2026-10-07).
export const RULES = {
  KXNFLTD: 'If <P> scores at least N+ touchdowns in the <game>, then the market resolves to Yes. ... Once <P> takes at least one snap, even if nullified by penalty, the market settles based on touchdowns scored. (rung 1+ = anytime TD; D/ST entries "TB Buccaneers D/ST: 1+" are the same ladder for the defence/special teams)',
  KXNFLFIRSTTD: 'If <P> scores the first touchdown in the <game>, then the market resolves to Yes. ... If no touchdowns are scored in the game, the No Touchdown market resolves to Yes and all other player markets resolve to No.',
  KXNFLPASSTDS: 'If <P> records N+ passing touchdowns in the <game> ... settles based on passing touchdowns recorded.',
  KXNFLPASSCOMP: 'If <P> records N+ pass completions ... settles based on pass completions recorded.',
  KXNFLPASSATT: 'If <P> records N+ pass attempts ... settles based on pass attempts recorded.',
  KXMLBHIT: 'If <P> records N+ hits in the <game>, then the market resolves to Yes. If <P> is scratched / starts but has no plate appearance, the market will resolve to the fair market price.',
  KXMLBHR: 'If <P> records N+ home runs in the <game> ... (same participation clause)',
  KXMLBTB: 'If <P> records N+ total bases in the <game> ... (same participation clause)',
  KXMLBHRR: 'If <P> records N+ total hits + runs + rbis in the <game> ... (same participation clause)',
  KXNHLGOAL: 'If <P> records N+ goals in the <game>, then the market resolves to Yes. ... Once a player enters the game, the market settles based on the player\'s goals recorded.',
  KXNHLPTS: 'If <P> records N+ points in the <game>, then the market resolves to Yes. ... settles based on the player\'s points recorded.',
  KXNHLAST: 'If <P> records N+ assists in the <game> ... settles based on the player\'s assists recorded.',
};

// ------------------------------------------------------------------ normalisation

/**
 * API market object (live or settled) -> flat record. `rung` = integer threshold k of a "k+" market (null otherwise).
 * role: 'rung' (greater/at-least ladder market), 'first' (first-TD scorer), 'notd' (No Touchdown), 'other'.
 * Prices in dollars; bid/ask 0/1 mean "no quote".
 */
export function normMarket(m, { feeMultiplier = 1 } = {}) {
  const seg = m.ticker.split('-');
  const series = seg[0];
  const game = seg[1];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const base = {
    ticker: m.ticker, series, game, event: `${series}-${game}`,
    bid: num(m.yes_bid_dollars) ?? 0, ask: num(m.yes_ask_dollars) ?? 1,
    bidSize: num(m.yes_bid_size_fp), askSize: num(m.yes_ask_size_fp), last: num(m.last_price_dollars),
    theta: 0.07 * feeMultiplier, result: m.result ?? null,
    settle: num(m.settlement_value_dollars), title: m.yes_sub_title ?? m.title ?? '',
  };
  base.mid = base.ask < 1 && base.ask > 0 && base.bid <= base.ask ? (base.bid + base.ask) / 2 : null;
  if (m.strike_type === 'greater' && num(m.floor_strike) !== null) {
    return { ...base, key: seg[2], rung: Math.round(num(m.floor_strike) + 0.5), role: 'rung' };
  }
  if (/NO-TD$/u.test(m.ticker) || /^No Touchdown$/iu.test(m.yes_sub_title ?? '')) {
    return { ...base, key: 'NO-TD', rung: null, role: 'notd' };
  }
  if (series === 'KXNFLFIRSTTD') return { ...base, key: seg[2], rung: null, role: 'first' };
  return { ...base, key: seg.slice(2).join('-'), rung: null, role: 'other' };
}

// ------------------------------------------------------------------ the rulebook tables

// Stat implications for the SAME player: S >= k  =>  T >= f(k). Each is a counting identity of the sport.
//   MLB: a home run is a hit, 4 total bases, and (hit + run + RBI) = 3 hits+runs+RBIs; every hit is >= 1 base;
//        total bases <= 4 per hit so TB >= k needs >= ceil(k/4) hits; HRR >= H.
//   NHL: points = goals + assists, so each of goals, assists is <= points.
//   NFL: every passing TD is a completion; every completion and every interception is an attempt.
//   NBA: PR = P + R, PA = P + A, RA = R + A, PRA = P + R + A (all >= 0); STOCK = STL + BLK; a made three is 3 points,
//        a made free throw is 1 point.
export const IMPLICATIONS = [
  ['KXMLBHR', 'KXMLBHIT', (k) => k], ['KXMLBHR', 'KXMLBTB', (k) => 4 * k], ['KXMLBHR', 'KXMLBHRR', (k) => 3 * k],
  ['KXMLBHIT', 'KXMLBTB', (k) => k], ['KXMLBHIT', 'KXMLBHRR', (k) => k], ['KXMLBTB', 'KXMLBHIT', (k) => Math.ceil(k / 4)],
  ['KXNHLGOAL', 'KXNHLPTS', (k) => k], ['KXNHLAST', 'KXNHLPTS', (k) => k],
  ['KXNFLPASSTDS', 'KXNFLPASSCOMP', (k) => k], ['KXNFLPASSCOMP', 'KXNFLPASSATT', (k) => k], ['KXNFLPASSINT', 'KXNFLPASSATT', (k) => k],
  ['KXNBAPTS', 'KXNBAPR', (k) => k], ['KXNBAREB', 'KXNBAPR', (k) => k], ['KXNBAPTS', 'KXNBAPA', (k) => k], ['KXNBAAST', 'KXNBAPA', (k) => k],
  ['KXNBAREB', 'KXNBARA', (k) => k], ['KXNBAAST', 'KXNBARA', (k) => k],
  ['KXNBAPR', 'KXNBAPRA', (k) => k], ['KXNBAPA', 'KXNBAPRA', (k) => k], ['KXNBARA', 'KXNBAPRA', (k) => k],
  ['KXNBAPTS', 'KXNBAPRA', (k) => k], ['KXNBAREB', 'KXNBAPRA', (k) => k], ['KXNBAAST', 'KXNBAPRA', (k) => k],
  ['KXNBASTL', 'KXNBASTOCK', (k) => k], ['KXNBABLK', 'KXNBASTOCK', (k) => k],
  ['KXNBA3PT', 'KXNBAPTS', (k) => 3 * k], ['KXNBAFTM', 'KXNBAPTS', (k) => k],
];

// Additive stats: U = S + T (+ V) pathwise  =>  Y_U(a+b) >= Y_S(a) + Y_T(b) - 1 (Frechet lower bound for the sum market).
export const SUMS = [
  ['KXNHLPTS', ['KXNHLGOAL', 'KXNHLAST']],
  ['KXNBAPR', ['KXNBAPTS', 'KXNBAREB']], ['KXNBAPA', ['KXNBAPTS', 'KXNBAAST']], ['KXNBARA', ['KXNBAREB', 'KXNBAAST']],
  ['KXNBAPRA', ['KXNBAPTS', 'KXNBAREB', 'KXNBAAST']], ['KXNBASTOCK', ['KXNBASTL', 'KXNBABLK']],
];

// ------------------------------------------------------------------ constraints

function cons(id, kind, terms, rhs, rule) { return { id, kind, terms, rhs, rule }; }

/**
 * All pathwise constraints among the given markets of ONE game (any subset: constraints are built from the
 * markets present, which is sound because ladders are transitive and a partial exclusive family still sums <= 1).
 * Returns [{id, kind, terms:[{ticker,w}], rhs, rule}]  meaning  sum w*Y <= rhs  in every world.
 */
export function buildConstraints(markets) {
  const out = [];
  const bySeriesKey = new Map(); // series -> key -> rung-sorted markets
  for (const m of markets) {
    if (m.role !== 'rung') continue;
    if (!bySeriesKey.has(m.series)) bySeriesKey.set(m.series, new Map());
    const km = bySeriesKey.get(m.series);
    if (!km.has(m.key)) km.set(m.key, []);
    km.get(m.key).push(m);
  }
  for (const km of bySeriesKey.values()) for (const l of km.values()) l.sort((a, b) => a.rung - b.rung);
  const rungs = (series, key) => bySeriesKey.get(series)?.get(key) ?? [];
  const at = (series, key, k) => rungs(series, key).find((m) => m.rung === k);
  // tightest listed rung of `series` at or below threshold j (event {T>=j} is contained in {T>=j'} for j' <= j)
  const floorRung = (series, key, j) => { let best = null; for (const m of rungs(series, key)) if (m.rung <= j) best = m; return best; };

  // ladders
  for (const [series, km] of bySeriesKey) for (const [key, l] of km) {
    for (let i = 0; i + 1 < l.length; i++) {
      out.push(cons(`ladder:${series}:${key}:${l[i + 1].rung}<=${l[i].rung}`, 'ladder', [{ ticker: l[i + 1].ticker, w: 1 }, { ticker: l[i].ticker, w: -1 }], 0,
        '"at least k+1" implies "at least k" (same stat, same player)'));
    }
  }
  // cross-series implications
  for (const [S, T, f] of IMPLICATIONS) {
    const km = bySeriesKey.get(S); if (!km) continue;
    for (const [key, l] of km) for (const m of l) {
      const t = floorRung(T, key, f(m.rung));
      if (!t || t.ticker === m.ticker) continue;
      out.push(cons(`impl:${S}${m.rung}=>${T}${t.rung}:${key}`, 'implication', [{ ticker: m.ticker, w: 1 }, { ticker: t.ticker, w: -1 }], 0,
        `${S}>=${m.rung} implies ${T}>=${f(m.rung)} (stat identity); tightest listed rung ${t.rung}`));
    }
  }
  // additive (Frechet) sums
  for (const [U, parts] of SUMS) {
    const keys = bySeriesKey.get(U); if (!keys) continue;
    for (const [key, ul] of keys) {
      const lists = parts.map((p) => rungs(p, key));
      if (lists.some((l) => l.length === 0)) continue;
      const rec = (i, picked) => {
        if (i === parts.length) {
          const tot = picked.reduce((s, m) => s + m.rung, 0);
          const u = ul.find((m) => m.rung === tot);
          if (u) out.push(cons(`sum:${U}${tot}:${key}:${picked.map((m) => m.series.slice(5) + m.rung).join('+')}`, 'sum',
            [...picked.map((m) => ({ ticker: m.ticker, w: 1 })), { ticker: u.ticker, w: -1 }], parts.length - 1,
            `${U} = ${parts.join(' + ')} pathwise, so all parts at their rungs forces ${U}>=${tot}: Y_U >= sum Y_i - ${parts.length - 1}`));
          return;
        }
        for (const m of lists[i]) rec(i + 1, [...picked, m]);
      };
      rec(0, []);
    }
  }
  // first touchdown: exclusive family + No TD + anytime/first
  const byEvent = new Map();
  for (const m of markets) if (m.series === 'KXNFLFIRSTTD') { if (!byEvent.has(m.event)) byEvent.set(m.event, []); byEvent.get(m.event).push(m); }
  for (const [ev, ms] of byEvent) {
    if (ms.length > 1) out.push(cons(`excl:${ev}`, 'exclusive', ms.map((m) => ({ ticker: m.ticker, w: 1 })), 1, 'at most one first touchdown; "No Touchdown" resolves Yes only if no touchdown (all player markets then No)'));
    for (const m of ms) {
      if (m.role !== 'first') continue;
      const td = at('KXNFLTD', m.key, 1);
      if (td) out.push(cons(`first<=any:${ev}:${m.key}`, 'implication', [{ ticker: m.ticker, w: 1 }, { ticker: td.ticker, w: -1 }], 0, 'first TD scorer scored a touchdown (1+ TD)'));
    }
    const notd = ms.find((m) => m.role === 'notd');
    if (notd) for (const [key, l] of bySeriesKey.get('KXNFLTD') ?? []) {
      const r1 = l.find((m) => m.rung === 1 && m.game === notd.game);
      if (r1) out.push(cons(`notd:${ev}:${key}`, 'notd', [{ ticker: notd.ticker, w: 1 }, { ticker: r1.ticker, w: 1 }], 1, 'No Touchdown and a player scoring a touchdown are incompatible'));
    }
  }
  return out;
}

// ------------------------------------------------------------------ Dutch books at the touch

/**
 * Price each constraint at executable prices net of the Kalshi taker fee theta*P(1-P) (theta = 0.07*fee_multiplier,
 * linear, unrounded). A violation = selling the positive-weight legs at the bid and buying the negative-weight legs
 * at the ask collects more (after fees) than the constraint's maximum possible payout b: riskless in every world.
 * Returns [{id, kind, edge, ...}] for ALL constraints with a full set of quotes (edge > 0 = Dutch book per basket).
 * depth = baskets executable at the touch (min displayed size over legs), null when sizes are not known.
 */
export function checkConstraints(constraints, byTicker) {
  const res = [];
  for (const c of constraints) {
    const legs = c.terms.map((t) => byTicker.get(t.ticker));
    if (legs.some((l) => !l)) continue;
    const theta = legs[0].theta;
    const idn = identity({ id: c.id, kind: c.kind, markets: c.terms.map((t) => ({ ticker: t.ticker, weight: t.w })), payoff: { lo: c.rhs - c.terms.length - 1, hi: c.rhs, point: c.rhs } });
    const books = Object.fromEntries(legs.map((l) => [l.ticker, { bid: l.bid, ask: l.ask, bidSize: l.bidSize, askSize: l.askSize, last: l.last }]));
    // a leg we must sell with no bid / buy with no ask cannot be executed
    const executable = c.terms.every((t, i) => (t.w > 0 ? legs[i].bid > 0 : legs[i].ask < 1));
    const p = priceIdentity(idn, books, { theta });
    res.push({
      id: c.id, kind: c.kind, tickers: c.terms.map((t) => t.ticker), edge: p.sellEdge, rawEdge: p.sellEdge + p.feeSell, executable,
      depth: p.minBidSize, feePaid: p.feeSell, midsResidual: legs.some((l) => l.mid == null) ? null : c.terms.reduce((s, t) => s + t.w * byTicker.get(t.ticker).mid, 0) - c.rhs,
    });
  }
  return res;
}

// ------------------------------------------------------------------ exact Euclidean projection

/**
 * Euclidean (Brier) projection of m onto C = { x in [0,1]^n : A x <= b } for sparse rows
 * rows[j] = {idx:[...], w:[...], b}. Hildreth's dual coordinate ascent on the dual QP (box constraints are rows);
 * it converges to the exact projection. Stops when every row is satisfied to `tol` and the dual step is below `tol`.
 * Works per connected component of the row graph. Returns { x, converged, sweeps, maxViolation }.
 */
export function projectQP(m, rows, { tol = 1e-11, maxSweeps = 200000 } = {}) {
  const n = m.length;
  const all = rows.slice();
  for (let i = 0; i < n; i++) { all.push({ idx: [i], w: [1], b: 1 }); all.push({ idx: [i], w: [-1], b: 0 }); }
  // components via union-find on constraint rows
  const par = Array.from({ length: n }, (_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (const r of rows) for (let i = 1; i < r.idx.length; i++) par[find(r.idx[i])] = find(r.idx[0]);
  const comp = new Map();
  for (let i = 0; i < n; i++) { const c = find(i); if (!comp.has(c)) comp.set(c, []); comp.get(c).push(i); }
  const rowsOf = new Map();
  for (const r of all) { const c = find(r.idx[0]); if (!rowsOf.has(c)) rowsOf.set(c, []); rowsOf.get(c).push(r); }
  const x = m.slice();
  let converged = true, maxSweepsUsed = 0, maxViolation = 0;
  for (const [c, vars] of comp) {
    const rs = rowsOf.get(c) ?? [];
    const nn = rs.map((r) => r.w.reduce((s, w) => s + w * w, 0));
    const lam = new Array(rs.length).fill(0);
    let sweep = 0, ok = false;
    for (; sweep < maxSweeps; sweep++) {
      let step = 0;
      for (let j = 0; j < rs.length; j++) {
        const r = rs[j];
        let ax = 0; for (let t = 0; t < r.idx.length; t++) ax += r.w[t] * x[r.idx[t]];
        let d = (ax - r.b) / nn[j];
        if (lam[j] + d < 0) d = -lam[j];
        if (d !== 0) { lam[j] += d; for (let t = 0; t < r.idx.length; t++) x[r.idx[t]] -= d * r.w[t]; step = Math.max(step, Math.abs(d)); }
      }
      if (step < tol * 1e-3) {
        let viol = 0; for (const r of rs) { let ax = 0; for (let t = 0; t < r.idx.length; t++) ax += r.w[t] * x[r.idx[t]]; viol = Math.max(viol, ax - r.b); }
        if (viol < tol) { ok = true; break; }
      }
    }
    let viol = 0; for (const r of rs) { let ax = 0; for (let t = 0; t < r.idx.length; t++) ax += r.w[t] * x[r.idx[t]]; viol = Math.max(viol, ax - r.b); }
    maxViolation = Math.max(maxViolation, viol);
    if (!ok && viol >= tol * 10) converged = false;
    maxSweepsUsed = Math.max(maxSweepsUsed, sweep);
    void vars;
  }
  return { x, converged, sweeps: maxSweepsUsed, maxViolation };
}

/**
 * Project the mids of `markets` (each with .ticker .mid) onto the constraint set. Constraints with a term outside
 * `markets` are skipped. Returns Map ticker -> projected probability, plus diagnostics.
 */
export function projectMids(markets, constraints, opts) {
  const idx = new Map(markets.map((m, i) => [m.ticker, i]));
  const rows = constraints.filter((c) => c.terms.every((t) => idx.has(t.ticker)))
    .map((c) => ({ idx: c.terms.map((t) => idx.get(t.ticker)), w: c.terms.map((t) => t.w), b: c.rhs }));
  const r = projectQP(markets.map((m) => m.mid), rows, opts);
  return { proj: new Map(markets.map((m, i) => [m.ticker, r.x[i]])), rows: rows.length, ...r };
}

export { fee };
