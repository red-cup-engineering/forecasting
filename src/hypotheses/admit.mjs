/**
 * Passed hypotheses become surface models, in the exact shape forecast-surface.mjs admits:
 *   { id, p, band: {admitted, low, high}, details }
 * with a calibration band from the hypothesis's settled record, by the statistic weather-learning's bins use:
 * the mean of per-cluster win rates with a Wilson interval whose count is the number of clusters (the
 * independent unit), so repeated entries inside one cluster cannot narrow it.
 *
 * The file written for a passed hypothesis, `data/records/admitted-forecast-records/<id>.json`, is
 *   { model, applies: { series, entry } }
 * `model` is the surface model for any contract the rule applies to; `applies` says which contracts those are.
 *
 * THE integration point (desk side, not wired here): where the desk builds a contract's surface it calls
 *   hypothesisSurface({ dir, series, minutesToAnchor: {close, start}, quote: {bid, ask}, mid })
 * which returns fuseForecast({mid, models: admittedHypothesisModels(...)}) -- see lanes/forecast-edge.mjs.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fuseForecast } from '@red-cup-engineering/forecasting/forecast-surface';
import { quoteQualifies } from './entry.mjs';
import { modelDirectory } from './store.mjs';

/** Mean of cluster win rates with Wilson bounds over the cluster count (weather-learning bin statistic). */
export function clusterCalibration(entries) {
  const by = new Map();
  for (const e of entries) { const c = by.get(e.g) ?? { n: 0, w: 0 }; c.n += 1; c.w += e.won ? 1 : 0; by.set(e.g, c); }
  const rates = [...by.values()].map((c) => c.w / c.n), count = rates.length;
  if (!count) return null;
  const rate = rates.reduce((s, x) => s + x, 0) / count, z = 1.96, den = 1 + (z * z) / count, center = (rate + (z * z) / (2 * count)) / den;
  const half = (z * Math.sqrt((rate * (1 - rate)) / count + (z * z) / (4 * count * count))) / den;
  return { clusters: count, rate, low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

/** The surface model file body for a passed hypothesis, or null when the rule is not a declarative entry. */
export function surfaceModelFile(h, entries) {
  const cal = h.entry ? clusterCalibration(entries) : null;
  if (!cal) return null;
  const yes = h.entry.side === 'yes';
  const p = yes ? cal.rate : 1 - cal.rate, low = yes ? cal.low : 1 - cal.high, high = yes ? cal.high : 1 - cal.low;
  return {
    model: { id: `hypothesis:${h.id}`, p, band: { admitted: true, low, high }, details: { kind: 'hypothesis-rule', hypothesis: h.id, side: h.entry.side, clusters: cal.clusters, entries: entries.length, winRate: cal.rate, calibration: 'cluster-wilson-95' } },
    applies: { series: h.universe.series, entry: h.entry },
  };
}

export function writeAdmitted(dir, h, file) {
  mkdirSync(modelDirectory(dir), { recursive: true });
  const path = join(modelDirectory(dir), `${h.id}.json`), tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(file, null, 2)}\n`); renameSync(tmp, path);
  return path;
}
export function removeAdmitted(dir, id) { rmSync(join(modelDirectory(dir), `${id}.json`), { force: true }); }

/**
 * Surface models for one contract from every passed hypothesis whose rule applies to it now.
 * @param {{dir: string, series: string, quote: {bid: number, ask: number}, minutesToAnchor: {close?: number, start?: number}}} c
 */
export function admittedHypothesisModels({ dir, series, quote, minutesToAnchor }) {
  const folder = modelDirectory(dir);
  if (!existsSync(folder)) return [];
  const out = [];
  for (const f of readdirSync(folder).filter((x) => x.endsWith('.json')).sort()) {
    const { model, applies } = JSON.parse(readFileSync(join(folder, f), 'utf8')), s = applies.entry.snapshot;
    const minutes = minutesToAnchor?.[s.anchor];
    if (!applies.series.includes(series) || !Number.isFinite(minutes)) continue;
    if (Math.abs(minutes + s.offsetMinutes) > s.toleranceMinutes) continue; // minutes to anchor vs the rule's lead time
    if (quoteQualifies(applies.entry, quote)) out.push(model);
  }
  return out;
}

/** The fused surface for a contract with hypothesis models alone added to the mid; null when nothing informs it. */
export const hypothesisSurface = ({ mid, ...contract }) => fuseForecast({ mid, models: admittedHypothesisModels(contract) });
