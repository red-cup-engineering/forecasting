#!/usr/bin/env node
/**
 * The maker's fair value is the weather: the station lattice's own probability that the index settles above a
 * strike, which knows what the stations, the diurnal climatology and the guidance make physically reachable in the
 * time left. What a fill adds is calibrated, not stacked with the market's price.
 *
 * Calibration given the fill. A resting quote fills only when a taker chooses to trade against it. The desk's YES
 * bid fills when a taker sells YES (the tape's taker side "no"), its NO bid when a taker buys YES (taker side "yes").
 * Per lead bucket and quote side, the realized frequency of YES on the trades of that taker side is fitted as a
 * monotone function of the model's probability q (weighted pool-adjacent-violators over fixed q bins): P(YES | q,
 * a fill of this side). Where the model is calibrated it returns q; where it is overconfident (the index falling
 * when a station leaves the average, a marine layer) it returns what actually happened.
 *
 * Evidence is counted in events, not contracts: every trade on one ladder shares one outcome (a farther strike is
 * settled by the same index as a nearer one), so a bin's evidence is the number of distinct ladders that traded in
 * it, and its value is the Jeffreys posterior mean (k + 1/2) / (n + 1) over them at the bin's contract-weighted
 * rate. A bin that never saw YES is not certain: log utility staking on a value of exactly zero would stake
 * everything.
 *
 * Where to quote. The tape's long-shot buyers pay 2-5 cents for strikes the weather has already put out of reach;
 * mid-range the model adds less. So the decision is made per band of q: [0, .01), [.01, .1), [.1, .9), [.9, .99),
 * [.99, 1]. In each band and side, a maker resting at its calibrated value less m is filled by the takers who pay
 * at least m beyond it; the margin m (whole cents, 0-10) is the one that earned most. Two-fold cross-validation over
 * the halves of October: the curve and margin chosen on each half are scored on the other, and a band quotes only
 * when both held-out scores earned. Then its curve and margin are fitted on both halves together. Hourly
 * temperature series charge makers no fee. The P&L is an upper bound in one way (it assumes the quote stood first
 * in its queue) and none in another (a maker resting there would have been filled by takers the tape never saw).
 *
 *   node scripts/calibrate-model.mjs --city nyc --split 2026-10-09
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { city: { type: 'string' }, split: { type: 'string', default: '2026-10-09' } } });
const here = dirname(fileURLToPath(import.meta.url));
const rows = (await readFile(join(here, '..', 'data', `scored-${values.city}.jsonl`), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
const split = Date.parse(`${values.split}T00:00:00Z`);
const BUCKETS = [5, 10, 20, 30, 45, 61], MARGINS = Array.from({ length: 11 }, (_, i) => i);
// Calibration bins of q, finest where the weather decides (near 0 and 1).
export const EDGES = [0, 0.001, 0.003, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.997, 0.999, 1.000001];
export const BANDS = [0, 0.01, 0.1, 0.9, 0.99, 1.000001];
const bucketOf = (lead) => BUCKETS.find((b) => lead < b) ?? 61;
const binOf = (edges, q) => { let i = 0; while (i < edges.length - 2 && q >= edges[i + 1]) i += 1; return i; };
// The quote side a taker fills: a taker selling YES fills the desk's YES bid, one buying YES fills its NO bid.
const SIDES = { yes: 'no', no: 'yes' };

/** Monotone (non-decreasing in q) calibration over the bins, weighted by contracts; empty bins take their neighbours'. */
const ladderOf = (ticker) => ticker.replace(/-T[\d.]+$/u, '');
function calibrate(data) {
  const n = EDGES.length - 1, w = new Array(n).fill(0), y = new Array(n).fill(0), events = Array.from({ length: n }, () => new Set());
  for (const r of data) { const i = binOf(EDGES, r.q); w[i] += r.count; y[i] += r.count * r.y; events[i].add(ladderOf(r.ticker)); }
  const blocks = [];
  for (let i = 0; i < n; i += 1) {
    if (!w[i]) continue;
    // n events at the bin's contract-weighted rate, as k successes: the Jeffreys posterior's evidence
    const e = events[i].size, k = (y[i] / w[i]) * e;
    blocks.push({ from: i, to: i, w: e + 1, y: k + 0.5 });
    while (blocks.length > 1 && blocks.at(-2).y / blocks.at(-2).w > blocks.at(-1).y / blocks.at(-1).w) { const b = blocks.pop(); const a = blocks.at(-1); a.to = b.to; a.w += b.w; a.y += b.y; }
  }
  const values = new Array(n).fill(null);
  for (const b of blocks) for (let i = b.from; i <= b.to; i += 1) values[i] = b.y / b.w;
  for (let i = 0; i < n; i += 1) if (values[i] === null) values[i] = values.slice(0, i).reverse().find((v) => v !== null) ?? values.slice(i).find((v) => v !== null) ?? null;
  return values;
}
const valueOf = (values, q) => values[binOf(EDGES, q)];
/** Maker P&L ($) and contracts on one side, in one band, against the takers who pay at least m cents beyond its value. */
function maker(data, values, m) {
  let pnl = 0, contracts = 0;
  for (const r of data) {
    const fair = valueOf(values, r.q), edge = r.taker === 'yes' ? r.price - fair : fair - r.price;
    if (edge * 100 < m) continue;
    pnl += r.count * (r.taker === 'yes' ? r.price - r.y : r.y - r.price); contracts += r.count;
  }
  return { pnl, contracts };
}
const bandOf = (q) => binOf(BANDS, q);

const report = { city: values.city, split: values.split, edges: EDGES, bands: BANDS, buckets: {} };
for (const bucket of BUCKETS) {
  const inBucket = rows.filter((r) => bucketOf(r.lead) === bucket);
  const sides = {};
  for (const [side, taker] of Object.entries(SIDES)) {
    const ofSide = inBucket.filter((r) => r.taker === taker), halves = [ofSide.filter((r) => r.at < split), ofSide.filter((r) => r.at >= split)];
    const curves = halves.map(calibrate), all = calibrate(ofSide);
    const bands = BANDS.slice(0, -1).map((from, b) => {
      const inBand = (data) => data.filter((r) => bandOf(r.q) === b);
      const choose = (data, values) => MARGINS.map((m) => ({ m, ...maker(data, values, m) })).reduce((a, x) => (x.pnl > a.pnl ? x : a));
      const folds = [0, 1].map((i) => {
        const fit = inBand(halves[i]), held = inBand(halves[1 - i]);
        if (fit.length < 50 || held.length < 50) return { marginCents: null, trades: [fit.length, held.length] };
        const best = choose(fit, curves[i]);
        const scored = best.pnl > 0 ? maker(held, curves[i], best.m) : { pnl: 0, contracts: 0 };
        return { marginCents: best.pnl > 0 ? best.m : null, heldUsd: Math.round(scored.pnl), heldContracts: Math.round(scored.contracts), heldCentsPerContract: scored.contracts ? Math.round((10000 * scored.pnl) / scored.contracts) / 100 : null };
      });
      const holds = folds.every((f) => f.marginCents !== null && f.heldUsd > 0), best = holds ? choose(inBand(ofSide), all) : null;
      return { from, to: BANDS[b + 1], marginCents: best && best.pnl > 0 ? best.m : null, folds };
    });
    sides[side] = { trades: halves.map((h) => h.length), calibration: all, bands };
  }
  report.buckets[`<${bucket}`] = sides;
}
await writeFile(join(here, '..', 'results', `calibration-${values.city}.json`), JSON.stringify(report, null, 1) + '\n');
for (const [b, sides] of Object.entries(report.buckets)) for (const [side, s] of Object.entries(sides)) {
  const line = s.bands.map((band) => (band.marginCents === null ? '   -   ' : `${band.marginCents}c:${band.folds.map((f) => f.heldCentsPerContract).join('/')}`.padEnd(7))).join(' | ');
  process.stdout.write(`${b.padStart(4)} ${side.padEnd(3)} ${line}\n`);
}
