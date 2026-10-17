#!/usr/bin/env node
/**
 * The maker's fair value and margin, fitted on the first half of October and scored on the second.
 *
 * Fair value given the fill (Glosten-Milgrom). A resting quote fills only when a taker chooses to trade against it,
 * so its value is the contract's expectation given that choice, not the unconditional one. The desk's YES bid is
 * filled by takers selling YES (the tape's taker side "no"); its NO bid by takers buying YES (taker side "yes").
 * Per lead bucket and per quote side, logistic stacking fits P(YES) = sigmoid(a logit q + b logit p + c) on the
 * trades of that taker side (q the model, p the market's last trade before this one), weighted by contracts, by
 * Newton's method on the log likelihood. The two fits differ by exactly the information a taker's direction carries.
 * A side without enough support in a bucket is a side to abstain in.
 *
 * Margin. A maker resting at its fair value minus m is filled by the takers who disagree with it by at least m. Per
 * lead bucket and side the margin is the one (whole cents, 0-10) that earned the most against the takers, at that
 * side's fill-conditioned fair value. Hourly temperature series charge makers no fee, so the P&L is the settlement
 * value less the price. It is an upper bound: it assumes the quote stood first in its queue.
 *
 * Holding up. Two-fold cross-validation over the halves: the fit and margin chosen on each half are scored on the
 * other. A side quotes only when both held-out scores earned; then its coefficients and margin are fitted on both
 * halves together. A side that earns only on the half it was chosen on is a side to abstain in.
 *
 *   node scripts/stack-market.mjs --city nyc --split 2026-10-09
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
const clip = (p) => Math.min(0.995, Math.max(0.005, p)), logit = (p) => Math.log(clip(p) / (1 - clip(p))), sigmoid = (x) => 1 / (1 + Math.exp(-x));
const bucketOf = (lead) => BUCKETS.find((b) => lead < b) ?? 61;
const features = (r) => [logit(r.q), logit(r.previous), 1];

/** Weighted logistic regression by Newton's method (with a 1e-6 ridge for an uninformative feature). */
function logistic(data) {
  let beta = [1, 0, 0];
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const g = [0, 0, 0], h = [[1e-6, 0, 0], [0, 1e-6, 0], [0, 0, 1e-6]];
    for (const r of data) {
      const x = features(r), p = sigmoid(x[0] * beta[0] + x[1] * beta[1] + x[2] * beta[2]), w = r.count;
      for (let i = 0; i < 3; i += 1) { g[i] += w * (r.y - p) * x[i]; for (let j = 0; j < 3; j += 1) h[i][j] += w * p * (1 - p) * x[i] * x[j]; }
    }
    const step = solve(h, g);
    beta = beta.map((b, i) => b + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return beta;
}
function solve(a, b) {
  const m = a.map((row, i) => [...row, b[i]]), n = b.length;
  for (let c = 0; c < n; c += 1) {
    let p = c; for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    [m[c], m[p]] = [m[p], m[c]];
    for (let r = 0; r < n; r += 1) if (r !== c) { const f = m[r][c] / m[c][c]; for (let k = c; k <= n; k += 1) m[r][k] -= f * m[c][k]; }
  }
  return m.map((row, i) => row[n] / row[i]);
}
const logLoss = (data, f) => { let s = 0, w = 0; for (const r of data) { const p = clip(f(r)); s -= r.count * (r.y ? Math.log(p) : Math.log(1 - p)); w += r.count; } return w ? s / w : null; };
/** Maker P&L ($) and contracts on one quote side against the takers who disagree with fair value f by at least m cents. */
function maker(data, f, m) {
  let pnl = 0, contracts = 0;
  for (const r of data) {
    const fair = f(r), edge = r.taker === 'yes' ? r.price - fair : fair - r.price;
    if (edge * 100 < m) continue;
    pnl += r.count * (r.taker === 'yes' ? r.price - r.y : r.y - r.price); contracts += r.count;
  }
  return { pnl, contracts };
}
// The quote side a taker fills: a taker selling YES fills the desk's YES bid, one buying YES fills its NO bid.
const SIDES = { yes: 'no', no: 'yes' };

const report = { city: values.city, split: values.split, buckets: {} };
for (const bucket of BUCKETS) {
  const inBucket = rows.filter((r) => bucketOf(r.lead) === bucket && r.previous !== null);
  const sides = {};
  for (const [side, taker] of Object.entries(SIDES)) {
    const ofSide = inBucket.filter((r) => r.taker === taker), halves = [ofSide.filter((r) => r.at < split), ofSide.filter((r) => r.at >= split)];
    if (halves[0].length < 200 || halves[1].length < 200) { sides[side] = { trades: halves.map((h) => h.length), coefficients: null, marginCents: null }; continue; }
    const choose = (data) => {
      const beta = logistic(data), stacked = (r) => sigmoid(features(r).reduce((s, x, i) => s + x * beta[i], 0));
      const best = MARGINS.map((m) => ({ m, ...maker(data, stacked, m) })).reduce((a, b) => (b.pnl > a.pnl ? b : a));
      return { beta, stacked, best };
    };
    const folds = [0, 1].map((i) => {
      const chosen = choose(halves[i]), held = halves[1 - i];
      const scored = chosen.best.pnl > 0 ? maker(held, chosen.stacked, chosen.best.m) : { pnl: 0, contracts: 0 };
      return { marginCents: chosen.best.pnl > 0 ? chosen.best.m : null, heldUsd: Math.round(scored.pnl), heldContracts: Math.round(scored.contracts),
        heldCentsPerContract: scored.contracts ? Math.round((10000 * scored.pnl) / scored.contracts) / 100 : null,
        heldLogLoss: { model: logLoss(held, (r) => r.q), marketPrevious: logLoss(held, (r) => r.previous), stacked: logLoss(held, chosen.stacked), tradePrice: logLoss(held, (r) => r.price) } };
    });
    const holds = folds.every((f) => f.marginCents !== null && f.heldUsd > 0), all = choose(ofSide);
    sides[side] = {
      trades: halves.map((h) => h.length), folds, coefficients: { model: all.beta[0], market: all.beta[1], intercept: all.beta[2] },
      marginCents: holds && all.best.pnl > 0 ? all.best.m : null,
    };
  }
  report.buckets[`<${bucket}`] = sides;
}
await writeFile(join(here, '..', 'results', `stack-${values.city}.json`), JSON.stringify(report, null, 2) + '\n');
for (const [b, sides] of Object.entries(report.buckets)) for (const [side, r] of Object.entries(sides)) {
  if (!r.folds) { process.stdout.write(`${b.padStart(4)} ${side.padEnd(3)} too few trades (${r.trades.join('/')})\n`); continue; }
  const held = r.folds.map((f) => (f.marginCents === null ? 'abstain' : `${f.marginCents}c: ${f.heldCentsPerContract}c x ${f.heldContracts} = $${f.heldUsd}`)).join(' | ');
  process.stdout.write(`${b.padStart(4)} ${side.padEnd(3)} ${r.marginCents === null ? 'ABSTAIN' : `quote at ${r.marginCents}c`.padEnd(7)}  held out: ${held}\n`);
}
