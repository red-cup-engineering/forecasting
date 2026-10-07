#!/usr/bin/env node
// Read-only measurement: do Kalshi crypto-15M combo prints reflect cross-asset correlation, and does a
// spot-driven Gaussian-copula model beat them (Brier / log-loss)?  Never places orders.
//   node scripts/crypto-combo-measure.mjs --spot spot.json [--state DIR] [--json out.json]
import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { comboStateDir } from '../src/combo-pricer.mjs';
import { windowOf, spotMarginal, correlationFromReturns, jointFair, barMean, WINDOW_MIN } from '../src/crypto-joint.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const D = arg('state', comboStateDir());
const spot = JSON.parse(readFileSync(arg('spot'), 'utf8'));
const SAMPLES = +arg('samples', 8000);
const is15M = (t) => /^KX[A-Z0-9]+15M-/u.test(t);

async function lines(file, filter, fn) {
  const rl = createInterface({ input: createReadStream(join(D, file)), crlfDelay: Infinity });
  for await (const line of rl) { if (filter(line)) { try { fn(JSON.parse(line)); } catch { /* skip */ } } }
}

// ------------------------------------------------------------------ load tape
const combos = new Map(); // ticker -> legs [{ticker, asset, side, w}]
await lines('rfqs.jsonl', (l) => l.startsWith('{"k":"rfq"') && l.includes('15M-'), (r) => {
  if (combos.has(r.ticker) || !r.legs?.length || !r.legs.every(([t]) => is15M(t))) return;
  const legs = r.legs.map(([t, side]) => ({ ticker: t, side, w: windowOf(t) }));
  if (legs.some((l) => !l.w) || new Set(legs.map((l) => l.w.closeMs)).size !== 1 || new Set(legs.map((l) => l.w.asset)).size !== legs.length) return;
  combos.set(r.ticker, legs.map((l) => ({ ...l, asset: l.w.asset })));
});
const legRes = new Map(); const comboRes = new Map();
await lines('results.jsonl', (l) => l.includes('"res"'), (r) => { if (is15M(r.ticker)) legRes.set(r.ticker, r.result); else if (combos.has(r.ticker)) comboRes.set(r.ticker, r.result); });
const book = new Map(); // legTicker -> [{t,bid,ask}] ascending t
await lines('legs.jsonl', (l) => l.includes('"event":"KX') && l.includes('15M-'), (r) => {
  for (const m of r.markets ?? []) if (is15M(m.ticker)) { const a = book.get(m.ticker) ?? book.set(m.ticker, []).get(m.ticker); a.push({ t: r.t, bid: m.bid, ask: m.ask }); }
});
for (const a of book.values()) a.sort((x, y) => x.t - y.t);
const prints = [];
await lines('trades.jsonl', (l) => l.includes('KXMVE'), (r) => { if (combos.has(r.ticker)) prints.push({ ticker: r.ticker, t: Date.parse(r.created_time), price: +r.yes_price_dollars, count: +r.count_fp, taker: r.taker_outcome_side }); });
prints.sort((a, b) => a.t - b.t);

// ------------------------------------------------------------------ spot helpers
const bars = spot; const barIdx = {};
for (const a of Object.keys(bars)) barIdx[a] = new Map(bars[a].map((b) => [b[0], b]));
const spotState = (asset, w, tMs) => {
  const barEnd = Math.floor(tMs / 60000) * 60000; // last bar closed at or before t is the one starting barEnd-60000
  const refBar = barIdx[asset].get(w.openMs - 60000); const cur = barIdx[asset].get(barEnd - 60000);
  if (!refBar || !cur) return null;
  const ref = barMean(refBar);
  if (barEnd >= w.openMs) return { S_t: cur[4], ref, minutesLeft: (w.closeMs - barEnd) / 60000, refKnown: true };
  return { S_t: ref, ref, minutesLeft: WINDOW_MIN, refKnown: false };
};
const rhoCache = new Map();
const rhoAt = (tMs) => { const k = Math.floor(tMs / 60000) * 60000; if (!rhoCache.has(k)) rhoCache.set(k, correlationFromReturns(bars, k, 1440)); return rhoCache.get(k); };
const lastBefore = (arr, t) => { let lo = 0; let hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t <= t) lo = m + 1; else hi = m; } return lo ? arr[lo - 1] : null; };
const mid = (s) => Math.min(0.99, Math.max(0.01, (s.bid + s.ask) / 2));

// ------------------------------------------------------------------ per-print records
const rows = []; const drop = { noOutcome: 0, noBook: 0, noSpot: 0, afterClose: 0 };
for (const p of prints) {
  const legs = combos.get(p.ticker); const w = legs[0].w;
  if (p.t >= w.closeMs) { drop.afterClose += 1; continue; }
  let outcome = null;
  if (comboRes.has(p.ticker)) outcome = comboRes.get(p.ticker) === 'yes' ? 1 : 0;
  else {
    const hits = legs.map((l) => (legRes.has(l.ticker) ? (legRes.get(l.ticker) === l.side ? 1 : 0) : null));
    if (hits.includes(0)) outcome = 0; else if (!hits.includes(null)) outcome = 1;
  }
  const snaps = legs.map((l) => lastBefore(book.get(l.ticker) ?? [], p.t));
  if (snaps.some((s) => !s)) { drop.noBook += 1; if (outcome === null) drop.noOutcome += 1; continue; }
  const st = legs.map((l) => spotState(l.asset, w, p.t));
  if (st.some((s) => !s)) { drop.noSpot += 1; (drop.ex ??= []).length < 3 && drop.ex.push([p.ticker, new Date(p.t).toISOString(), legs.map((l) => l.asset + ':' + new Date(l.w.openMs).toISOString())]); continue; }
  const rho = rhoAt(p.t);
  const sub = legs.map((l) => ({ asset: l.asset, side: l.side }));
  const spotP = st.map((s, i) => spotMarginal({ ...s, sigmaPerMin: rho.sigma[legs[i].asset] }));
  const midP = snaps.map((s, i) => { const m = mid(s); return legs[i].side === 'yes' ? m : 1 - m; }); // P(leg on its side)
  const midYes = snaps.map(mid);
  const sideP = (pYes) => pYes.map((q, i) => (legs[i].side === 'yes' ? q : 1 - q));
  rows.push({
    ticker: p.ticker, win: w.closeMs, t: p.t, count: p.count, taker: p.taker, nLegs: legs.length, outcome,
    print: p.price,
    indepMid: midP.reduce((a, b) => a * b, 1),
    spotIndep: sideP(spotP).reduce((a, b) => a * b, 1),
    spotJoint: jointFair(sub, spotP, rho, { samples: SAMPLES }),
    midJoint: jointFair(sub, midYes, rho, { samples: SAMPLES }),
    age: Math.max(...snaps.map((s) => p.t - s.t)) / 1000,
    maxSpread: Math.max(...snaps.map((s) => s.ask - s.bid)),
  });
}
const settled = rows.filter((r) => r.outcome !== null);

// ------------------------------------------------------------------ stats
const clamp = (p) => Math.min(0.999, Math.max(0.001, p));
const brier = (p, y) => (p - y) ** 2;
const logloss = (p, y) => -(y ? Math.log(clamp(p)) : Math.log(1 - clamp(p)));
/** ratio statistic sum(num)/sum(den) with delete-one-cluster jackknife SE (cluster = 15-min window). */
function jack(items, clusterOf, numF, denF = () => 1) {
  const g = new Map();
  for (const it of items) { const k = clusterOf(it); const c = g.get(k) ?? g.set(k, [0, 0]).get(k); c[0] += numF(it); c[1] += denF(it); }
  const N = [...g.values()].reduce((a, c) => a + c[0], 0); const Dn = [...g.values()].reduce((a, c) => a + c[1], 0);
  const est = N / Dn; const G = g.size; if (G < 2) return { est, se: NaN, G };
  const th = [...g.values()].map((c) => (N - c[0]) / (Dn - c[1])); const mean = th.reduce((a, b) => a + b, 0) / G;
  return { est, se: Math.sqrt(((G - 1) / G) * th.reduce((a, b) => a + (b - mean) ** 2, 0)), G };
}
const f = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'nan');
const pm = (j, d = 4) => `${f(j.est, d)} ±${f(j.se, d)}`;
const out = {}; const L = [];
const say = (s = '') => { L.push(s); console.log(s); };

const FC = ['print', 'indepMid', 'spotIndep', 'spotJoint', 'midJoint'];
function scoreTable(title, set) {
  say(`\n## ${title}: n prints=${set.length}, n windows=${new Set(set.map((r) => r.win)).size}, base rate=${f(set.reduce((a, r) => a + r.outcome, 0) / set.length, 3)}`);
  say('forecaster   Brier(±jk)         dBrier vs print(±jk)   logloss(±jk)       Brier(count-wtd)');
  const res = {};
  for (const k of FC) {
    const b = jack(set, (r) => r.win, (r) => brier(r[k], r.outcome)); const ll = jack(set, (r) => r.win, (r) => logloss(r[k], r.outcome));
    const d = jack(set, (r) => r.win, (r) => brier(r[k], r.outcome) - brier(r.print, r.outcome));
    const bw = jack(set, (r) => r.win, (r) => r.count * brier(r[k], r.outcome), (r) => r.count);
    say(`${k.padEnd(12)} ${pm(b)}   ${k === 'print' ? '-'.padEnd(20) : pm(d).padEnd(20)}   ${pm(ll)}   ${f(bw.est)}`);
    res[k] = { brier: b, dBrier: d, logloss: ll, brierCountWeighted: bw.est };
  }
  return res;
}
say(`# crypto-combo-measure  state=${D}`);
say(`combos(all-15M)=${combos.size}  prints=${prints.length}  scored rows=${rows.length}  settled=${settled.length}  dropped=${JSON.stringify(drop)}`);
const ages = rows.map((r) => r.age).sort((a, b) => a - b); const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
say(`leg-snapshot staleness at print (max over legs, s): p10=${f(q(ages, 0.1), 0)} p50=${f(q(ages, 0.5), 0)} p90=${f(q(ages, 0.9), 0)} max=${f(ages.at(-1), 0)}`);
out.main = scoreTable('ALL settled prints', settled);
const clean = settled.filter((r) => r.age <= 120 && r.maxSpread <= 0.1);
out.clean = scoreTable('CLEAN subset (all leg snapshots <=120 s old, all leg spreads <=0.10)', clean);
const fresh = settled.filter((r) => r.age <= 30);
out.fresh = scoreTable('FRESH subset (snapshots <=30 s old)', fresh);
for (const [lo, hi] of [[2, 2], [3, 4], [5, 9]]) {
  const sub = settled.filter((r) => r.nLegs >= lo && r.nLegs <= hi);
  if (sub.length > 20) out[`legs${lo}-${hi}`] = scoreTable(`legs ${lo}-${hi}`, sub);
}

// ------------------------------------------------------------------ dependence: do prints carry the correlation?
{
  const lift = (k) => settled.reduce((a, r) => a + Math.log(clamp(r[k]) / clamp(r.spotIndep)), 0) / settled.length;
  say('\n## Dependence');
  say(`mean ln(spotJoint/spotIndep)=${f(lift('spotJoint'))}  mean ln(midJoint/indepMid)=${f(settled.reduce((a, r) => a + Math.log(clamp(r.midJoint) / clamp(r.indepMid)), 0) / settled.length)}  mean ln(print/indepMid)=${f(settled.reduce((a, r) => a + Math.log(clamp(r.print) / clamp(r.indepMid)), 0) / settled.length)}`);
  // regress print on indepMid and midJoint (all rows incl. unsettled): share of the independence->copula gap that prints close
  const xs = rows.filter((r) => r.nLegs >= 2 && r.midJoint - r.indepMid !== 0);
  const num = xs.reduce((a, r) => a + (r.print - r.indepMid) * (r.midJoint - r.indepMid), 0); const den = xs.reduce((a, r) => a + (r.midJoint - r.indepMid) ** 2, 0);
  say(`print = indepMid + beta*(midJoint-indepMid): beta=${f(num / den, 3)} over ${xs.length} prints (0 = prints ignore correlation, 1 = prints match the copula)`);
  const gap = jack(rows, (r) => r.win, (r) => (r.print - r.indepMid) * (r.midJoint - r.indepMid), (r) => (r.midJoint - r.indepMid) ** 2);
  say(`  beta jackknife by window: ${pm(gap, 3)}`);
  out.beta = gap;
  const pairs = {}; // mean off-diagonal rho over the prior-24h matrices actually used
  let sumOff = 0; let cnt = 0; let minOff = 1; let maxOff = -1;
  for (const rr of rhoCache.values()) for (let i = 0; i < rr.assets.length; i += 1) for (let j = 0; j < i; j += 1) { const v = rr.rho[i][j]; sumOff += v; cnt += 1; minOff = Math.min(minOff, v); maxOff = Math.max(maxOff, v); pairs[`${rr.assets[i]}-${rr.assets[j]}`] = (pairs[`${rr.assets[i]}-${rr.assets[j]}`] ?? 0) + v / rhoCache.size; }
  say(`rho (1-min log returns, prior 24h, ${rhoCache.size} distinct matrices): mean off-diagonal=${f(sumOff / cnt, 3)} min=${f(minOff, 3)} max=${f(maxOff, 3)}`);
  const sorted = Object.entries(pairs).sort((a, b) => b[1] - a[1]); say(`  highest: ${sorted.slice(0, 4).map(([k, v]) => `${k} ${f(v, 2)}`).join(', ')}; lowest: ${sorted.slice(-4).map(([k, v]) => `${k} ${f(v, 2)}`).join(', ')}`);
  const mid1 = [...rhoCache.values()][Math.floor(rhoCache.size / 2)]; say(`  sigma/min (median matrix): ${mid1.assets.map((a) => `${a} ${(mid1.sigma[a] * 1e4).toFixed(1)}bp`).join(' ')}`);
  out.rho = { mean: sumOff / cnt, min: minOff, max: maxOff, pairs };
}

// ------------------------------------------------------------------ calibration deciles
function calib(k, set) {
  const s = [...set].sort((a, b) => a[k] - b[k]); const n = s.length; const rowsC = [];
  for (let d = 0; d < 10; d += 1) { const c = s.slice(Math.floor(d * n / 10), Math.floor((d + 1) * n / 10)); if (!c.length) continue; rowsC.push({ d: d + 1, n: c.length, pred: c.reduce((a, r) => a + r[k], 0) / c.length, obs: c.reduce((a, r) => a + r.outcome, 0) / c.length }); }
  return rowsC;
}
say('\n## Calibration deciles (settled prints; equal-count bins of the forecaster)');
const cp = calib('print', settled); const cs = calib('spotJoint', settled);
say('dec |  print: n   mean_pred  obs_freq |  spotJoint: n   mean_pred  obs_freq');
for (let i = 0; i < 10; i += 1) say(`${String(i + 1).padStart(3)} | ${String(cp[i]?.n ?? '').padStart(12)} ${f(cp[i]?.pred, 3).padStart(10)} ${f(cp[i]?.obs, 3).padStart(9)} | ${String(cs[i]?.n ?? '').padStart(14)} ${f(cs[i]?.pred, 3).padStart(10)} ${f(cs[i]?.obs, 3).padStart(9)}`);
out.calib = { print: cp, spotJoint: cs };

// ------------------------------------------------------------------ shadow maker
say('\n## Shadow maker (we take the other side of the executed print at its price; maker fee = 0 assumed; per-contract P&L in $)');
say('Sell YES at print when print > spotJoint + m (pnl = print - outcome); buy YES when print < spotJoint - m (pnl = outcome - print).');
out.maker = {};
for (const ref of ['spotJoint', 'midJoint']) for (const m of [0.02, 0.05]) {
  const trades = settled.filter((r) => Math.abs(r.print - r[ref]) > m).map((r) => ({ ...r, side: r.print > r[ref] ? -1 : 1, pnl: r.print > r[ref] ? r.print - r.outcome : r.outcome - r.print }));
  if (!trades.length) { say(`${ref} m=${m}: no trades`); continue; }
  const pp = jack(trades, (r) => r.win, (r) => r.pnl); const pw = jack(trades, (r) => r.win, (r) => r.count * r.pnl, (r) => r.count);
  const sells = trades.filter((r) => r.side < 0); const buys = trades.filter((r) => r.side > 0);
  const sub = (a) => (a.length ? `${f(a.reduce((x, r) => x + r.pnl, 0) / a.length)}(n=${a.length})` : 'n/a');
  say(`${ref} m=${m}: trades=${trades.length} windows=${pp.G}  per-print mean pnl=${pm(pp)} (t=${f(pp.est / pp.se, 2)})  count-weighted=${pm(pw)}  total$=${f(trades.reduce((a, r) => a + r.count * r.pnl, 0), 1)} on ${f(trades.reduce((a, r) => a + r.count, 0), 0)} contracts  | sells ${sub(sells)} buys ${sub(buys)}`);
  out.maker[`${ref}@${m}`] = { n: trades.length, perPrint: pp, countWeighted: pw };
}

// ------------------------------------------------------------------ single legs: spot marginal vs book mid at snapshot time
let singleItems = [];
{
  const legSet = new Set(); for (const legs of combos.values()) for (const l of legs) legSet.add(l.ticker);
  for (const t of legRes.keys()) legSet.add(t); // all settled crypto legs with books
  const items = [];
  for (const t of legSet) {
    if (!legRes.has(t) || !book.has(t)) continue; const w = windowOf(t); if (!w || !bars[w.asset]) continue;
    const y = legRes.get(t) === 'yes' ? 1 : 0; const lastMin = new Map();
    for (const s of book.get(t)) if (s.t < w.closeMs && s.t >= w.openMs - 15 * 60000) lastMin.set(Math.floor(s.t / 60000), s); // thin: last snapshot per minute
    for (const s of lastMin.values()) {
      const st = spotState(w.asset, w, s.t); if (!st) continue; const sig = rhoAt(s.t).sigma[w.asset];
      const sp = spotMarginal({ ...st, sigmaPerMin: sig }); const sp13 = spotMarginal({ ...st, sigmaPerMin: sig, minutesLeft: st.minutesLeft + (st.refKnown ? 1 / 3 : 0) });
      const spotAge = (s.t - Math.floor(s.t / 60000) * 60000) / 1000; const byK = [0.6, 0.8, 1.2, 1.5].map((k) => spotMarginal({ ...st, sigmaPerMin: sig * k }));
      items.push({ win: w.closeMs, spotAge, byK, y, mid: mid(s), spot: sp, spot13: sp13, phase: s.t < w.openMs ? 'pre-open' : (w.closeMs - s.t) > 10 * 60000 ? 'first 5 min' : (w.closeMs - s.t) > 5 * 60000 ? 'mid 5 min' : 'last 5 min', spread: s.ask - s.bid });
    }
  }
  singleItems = items;
  say(`\n## Single legs (settled crypto-15M legs, last book snapshot per leg-minute): n=${items.length} snapshots, ${new Set(items.map((i) => i.win)).size} windows, ${new Set(items.map((i) => i.y)).size > 0 ? 'legs=' + new Set(legSet).size : ''}`);
  say('subset              n      Brier mid(±jk)    Brier spot(±jk)   d(spot-mid)(±jk)   logloss mid  logloss spot   Brier spot with tau=L-1/3');
  out.legs = {};
  for (const ph of ['all', 'pre-open', 'first 5 min', 'mid 5 min', 'last 5 min', 'spread<=0.05', 'spot age<=10s (in-window)']) {
    const set = items.filter((i) => (ph === 'all' ? true : ph.startsWith('spot age') ? i.spotAge <= 10 && i.phase !== 'pre-open' : ph === 'spread<=0.05' ? i.spread <= 0.05 && i.phase !== 'pre-open' : i.phase === ph)); if (set.length < 5) continue;
    const bm = jack(set, (i) => i.win, (i) => brier(i.mid, i.y)); const bs = jack(set, (i) => i.win, (i) => brier(i.spot, i.y)); const d = jack(set, (i) => i.win, (i) => brier(i.spot, i.y) - brier(i.mid, i.y));
    const lm = jack(set, (i) => i.win, (i) => logloss(i.mid, i.y)); const ls = jack(set, (i) => i.win, (i) => logloss(i.spot, i.y)); const b13 = jack(set, (i) => i.win, (i) => brier(i.spot13, i.y));
    say(`${ph.padEnd(18)} ${String(set.length).padStart(6)}  ${pm(bm)}  ${pm(bs)}  ${pm(d)}  ${f(lm.est)}  ${f(ls.est)}  ${f(b13.est)}`);
    out.legs[ph] = { n: set.length, mid: bm, spot: bs, d, lmid: lm.est, lspot: ls.est };
  }
}
say('\nsigma-scale check on single-leg spot Brier (in-window snapshots): k x sigma_24h');
{ const set = singleItems.filter((i) => i.phase !== 'pre-open'); const ks = [0.6, 0.8, 1, 1.2, 1.5];
  say(ks.map((k) => `k=${k}: ${f(set.reduce((a, i) => a + brier(k === 1 ? i.spot : i.byK[[0.6, 0.8, 1.2, 1.5].indexOf(k)], i.y), 0) / set.length)}`).join('  ') + `   (book mid ${f(set.reduce((a, i) => a + brier(i.mid, i.y), 0) / set.length)})`); }
say('\n## Taker side (settled prints): print bias = mean(print - outcome) and Brier');
for (const side of ['yes', 'no']) { const set = settled.filter((r) => r.taker === side); if (!set.length) continue;
  const bias = jack(set, (r) => r.win, (r) => r.print - r.outcome); const bp = jack(set, (r) => r.win, (r) => brier(r.print, r.outcome)); const bm = jack(set, (r) => r.win, (r) => brier(r.midJoint, r.outcome));
  say(`taker=${side}: n=${set.length} bias=${pm(bias)} Brier print=${pm(bp)} midJoint=${pm(bm)}`); }
const o = arg('json'); if (o) writeFileSync(o, JSON.stringify(out, null, 1));
