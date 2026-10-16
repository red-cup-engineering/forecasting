#!/usr/bin/env node
/**
 * The maker's fair value and margin, fitted on the first half of October and scored on the second.
 *
 * Fair value. The model knows the stations; the market's last price knows what traders know (their own forecasts,
 * faster feeds). Per lead bucket, logistic stacking fits P(YES) = sigmoid(a logit q + b logit p + c) on the
 * scored trades (q the model, p the market's last trade before this one), weighted by contracts, by Newton's method
 * on the log likelihood. A bucket without enough support keeps the model alone.
 *
 * Margin. A maker resting at its fair value minus m is filled by the takers who disagree with it by at least m. Per
 * lead bucket the margin is the one (whole cents, 0-10) that earned the most against the fit half's takers, at the
 * stacked fair value; a bucket where no margin earned anything is a bucket to abstain in. Hourly temperature series
 * charge makers no fee, so the P&L is the settlement value less the price. It is an upper bound: it assumes the
 * quote stood first in its queue.
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
/** Maker P&L ($) and contracts against the takers who disagree with fair value f by at least m cents. */
function maker(data, f, m) {
  let pnl = 0, contracts = 0;
  for (const r of data) {
    const fair = f(r), edge = r.taker === 'yes' ? r.price - fair : fair - r.price;
    if (edge * 100 < m) continue;
    pnl += r.count * (r.taker === 'yes' ? r.price - r.y : r.y - r.price); contracts += r.count;
  }
  return { pnl, contracts };
}

const report = { city: values.city, split: values.split, buckets: {} };
for (const bucket of BUCKETS) {
  const inBucket = rows.filter((r) => bucketOf(r.lead) === bucket && r.previous !== null);
  const fit = inBucket.filter((r) => r.at < split), test = inBucket.filter((r) => r.at >= split);
  if (fit.length < 200 || test.length < 50) { report.buckets[`<${bucket}`] = { fitTrades: fit.length, testTrades: test.length, stacked: null }; continue; }
  const beta = logistic(fit), stacked = (r) => sigmoid(features(r).reduce((s, x, i) => s + x * beta[i], 0));
  const byMargin = MARGINS.map((m) => ({ m, ...maker(fit, stacked, m) }));
  const best = byMargin.reduce((a, b) => (b.pnl > a.pnl ? b : a));
  const held = best.pnl > 0 ? maker(test, stacked, best.m) : null;
  report.buckets[`<${bucket}`] = {
    fitTrades: fit.length, testTrades: test.length, coefficients: { model: beta[0], market: beta[1], intercept: beta[2] },
    testLogLoss: { model: logLoss(test, (r) => r.q), marketPrevious: logLoss(test, (r) => r.previous), stacked: logLoss(test, stacked), tradePrice: logLoss(test, (r) => r.price) },
    marginCents: best.pnl > 0 ? best.m : null, fitMakerUsd: Math.round(best.pnl), fitContracts: Math.round(best.contracts),
    testMaker: held && { usd: Math.round(held.pnl), contracts: Math.round(held.contracts), centsPerContract: held.contracts ? Math.round((10000 * held.pnl) / held.contracts) / 100 : null },
  };
}
await writeFile(join(here, '..', 'results', `stack-${values.city}.json`), JSON.stringify(report, null, 2) + '\n');
for (const [b, r] of Object.entries(report.buckets)) {
  if (!r.coefficients) { process.stdout.write(`${b.padStart(4)} too few trades (${r.fitTrades}/${r.testTrades})\n`); continue; }
  const l = r.testLogLoss;
  process.stdout.write(`${b.padStart(4)} logloss model ${l.model.toFixed(3)} market-prev ${l.marketPrevious.toFixed(3)} stacked ${l.stacked.toFixed(3)} (trade ${l.tradePrice.toFixed(3)}) | a ${r.coefficients.model.toFixed(2)} b ${r.coefficients.market.toFixed(2)} | margin ${r.marginCents ?? '-'}c test ${r.testMaker ? `${r.testMaker.centsPerContract}c x ${r.testMaker.contracts} = $${r.testMaker.usd}` : 'abstain'}\n`);
}
