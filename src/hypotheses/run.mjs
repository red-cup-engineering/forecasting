/**
 * runHypotheses: the single function a scheduled operation calls. One pass:
 *
 *   1. load hypotheses (content/hypotheses/*.json, validated); killed ones are skipped, never fetched or judged
 *   2. sync    spend the caller's request budget on what is new: evaluator collect steps first (live data is
 *              perishable), then live registered-window quotes and settled markets since each registeredAt
 *   3. derive  entries and settled P&L from the observation store + the spec (all/verdict; discardable indexes)
 *   4. verdict delete-one-cluster jackknife -> FOUR reading -> status transition
 *   5. emit    a passed hypothesis writes its surface model to <state>/admitted/<id>.json
 *
 * Indexes written per hypothesis under <state>/<id>/: ledger.json (entries, a pure function of observations and
 * spec -- same input, same bytes) and status.json (the reading and the status; `asOf` is the run instant).
 * Delete them and the next run rebuilds them from the observations.
 */
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { surfaceModelFile, removeAdmitted, writeAdmitted } from './admit.mjs';
import { syncForwardQuotes, syncSeries, syncSettled, tapeFor } from './data.mjs';
import { entriesFromTape } from './entry.mjs';
import { EVALUATORS } from './evaluators.mjs';
import { SPORTS } from '../sport-feeds.mjs';
import { createFetcher } from './fetcher.mjs';
import { validateHypothesis } from './schema.mjs';
import { cacheDir, openStore, stateRoot } from './store.mjs';
import { nextStatus, readVerdict } from './verdict.mjs';

export const hypothesesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'hypotheses');

export function loadHypotheses(dir = hypothesesDir) {
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => validateHypothesis(JSON.parse(readFileSync(join(dir, f), 'utf8')), { evaluators: EVALUATORS }));
}

const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.tmp`; writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`); renameSync(tmp, path); };
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);

/** Items (or awaiting) for one hypothesis from the store alone. Pure over observations. */
export async function deriveItems(h, { store, externalDir }) {
  if (h.evaluator) {
    const r = await EVALUATORS[h.evaluator].derive({ h, store, externalDir });
    return { items: r.items, entries: r.items, awaiting: r.awaiting ?? null, notes: r.notes ?? {} };
  }
  const tape = tapeFor({ store, universe: h.universe.series, snapshot: h.entry.snapshot, notBeforeMs: Date.parse(h.registeredAt), requireForward: true });
  const { entries, refused, noQuote, considered } = entriesFromTape(h, tape);
  return { items: entries, entries, awaiting: null, notes: { refused, noQuote, considered, tape: tape.length } };
}

/**
 * @param {object} options
 * @param {number} options.requestBudget  requests this run may spend (required; the caller's resource decision)
 * @param {'all'|'sync'|'collect'|'verdict'} [options.mode]  verdict spends no requests
 * @param {string[]} [options.only]       restrict to these hypothesis ids
 * @param {() => number} [options.receiptClock] Internal post-fetch receipt clock for deterministic testing; the deployed operation never accepts a caller clock.
 */
export async function runHypotheses({ requestBudget, mode = 'all', only = null, root = stateRoot(), contentDir = hypothesesDir, externalDir = join(root, 'external'), now = Date.now(), fetcher = null, receiptClock = () => Date.now() } = {}) {
  if (!['all', 'sync', 'collect', 'verdict'].includes(mode)) throw new TypeError('runHypotheses: unknown mode');
  const syncing = mode !== 'verdict';
  if (syncing && (!Number.isSafeInteger(requestBudget) || requestBudget < 0)) throw new TypeError('runHypotheses: nonnegative safe integer requestBudget is required');
  const all = loadHypotheses(contentDir).filter((h) => !only || only.includes(h.id));
  const prior = new Map(all.map((h) => [h.id, readJson(join(root, h.id, 'status.json'))]));
  const standing = (h) => (h.status === 'killed' || h.status === 'admitted' ? h.status : prior.get(h.id)?.status === 'killed' ? 'killed' : prior.get(h.id)?.status === 'passed' ? 'passed' : h.status);
  const live = all.filter((h) => standing(h) !== 'killed');
  const report = { at: new Date(now).toISOString(), mode, orderEffect: false, skipped: all.filter((h) => standing(h) === 'killed').map((h) => h.id), partial: false, hypotheses: [] };
  const store = openStore(cacheDir(root)), nowIso = new Date(now).toISOString();
  const f = syncing ? (fetcher ?? createFetcher({ budget: requestBudget })) : null;

  if (syncing) {
    const sync = {};
    const generic = live.filter((h) => h.entry);
    const feeSeries = new Set(generic.flatMap((h) => h.universe.series));
    if (live.some((h) => h.evaluator === 'deep-terminal')) for (const key of ['nfl', 'ncaaf', 'mlb']) feeSeries.add(SPORTS[key].game);
    await syncSeries({ store, fetcher: f, series: [...feeSeries], now: nowIso, report: sync });
    if (mode !== 'sync') for (const h of live.filter((x) => x.evaluator && EVALUATORS[x.evaluator].collect)) await EVALUATORS[h.evaluator].collect({ h, store, fetcher: f, now, report: sync });
    if (mode !== 'collect') {
      await syncForwardQuotes({ store, fetcher: f, hypotheses: generic, report: sync, receiptClock });
      for (const series of new Set(generic.flatMap((h) => h.universe.series))) {
        const since = Math.min(...generic.filter((h) => h.universe.series.includes(series)).map((h) => Date.parse(h.registeredAt)));
        await syncSettled({ store, fetcher: f, series, sinceMs: since, now: nowIso, report: sync });
      }
    }
    report.sync = { ...sync, requests: f.spent, budget: requestBudget };
    report.partial = Boolean(sync.partial);
  }

  // The fast collector appends perishable observations. Rebuilt indexes belong
  // to all/verdict passes, so concurrent collection never overwrites a verdict.
  if (mode === 'collect') return { ...report, hypotheses: readStatuses({ root, contentDir }) };

  for (const h of live) {
    const d = await deriveItems(h, { store, externalDir });
    const v = readVerdict(h, { items: d.items }, { now });
    const status = d.awaiting ? standing(h) : nextStatus(standing(h), v);
    const dir = join(root, h.id);
    writeJson(join(dir, 'ledger.json'), { id: h.id, registeredAt: h.registeredAt, entries: d.entries.map(({ g, ticker, side, price, at, won, x, arm }) => ({ g, ticker, side, price, at, won, x, arm })) });
    let admitted = null;
    if (status === 'passed' || status === 'admitted') {
      const file = surfaceModelFile(h, d.entries);
      if (file) admitted = writeAdmitted(root, h, file);
    } else removeAdmitted(root, h.id);
    const record = { id: h.id, status, reading: d.awaiting ? null : v.reading, sides: d.awaiting ? null : v.sides, awaiting: d.awaiting, clusters: v.clusters, minClusters: h.verdict.minClusters, mean: v.mean, se: v.se, t: v.t, comparison: v.comparison, holdout: v.holdout ? { holdout: v.holdout.holdout.mean, rest: v.holdout.rest.mean } : null, reasons: v.reasons, notes: d.notes, admittedModel: admitted, asOf: nowIso };
    writeJson(join(dir, 'status.json'), record);
    report.hypotheses.push(record);
  }
  for (const h of all.filter((x) => standing(x) === 'killed')) report.hypotheses.push({ id: h.id, status: 'killed', killed: h.killed ?? prior.get(h.id) ?? null });
  return report;
}

/** Statuses as last written (no fetching): killed hypotheses from their files, the rest from status.json. */
export function readStatuses({ root = stateRoot(), contentDir = hypothesesDir } = {}) {
  return loadHypotheses(contentDir).map((h) => (h.status === 'killed' ? { id: h.id, status: 'killed', killed: h.killed } : readJson(join(root, h.id, 'status.json')) ?? { id: h.id, status: h.status, reading: null, clusters: 0, minClusters: h.verdict.minClusters, reasons: ['not yet run'] }));
}
