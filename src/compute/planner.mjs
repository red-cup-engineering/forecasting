// Placement is a measured decision, not a guess. The planner calibrates every backend per kernel (startup
// cost, fixed cost, per-work cost, numerical error against the pure reference on fixed seeds), caches the
// measurements as JSON, and `place()` picks the fastest backend whose measured error is within the caller's
// tolerance, correcting CPU-bound backends for the load actually present now. Anything unavailable, failing,
// or too imprecise is skipped with its reason; the CPU is the floor.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { availableParallelism, cpus, hostname, loadavg, homedir } from 'node:os';
import { KERNELS } from './kernels.mjs';
import { createCpuInline, createCpuPool } from './backends/cpu-pool.mjs';
import { createWebgpuWsl, createWebgpuWindows } from './backends/webgpu.mjs';
import { createWindowsOrt } from './backends/windows-ort.mjs';

export const DEFAULT_TOLERANCE = Object.freeze({ 'mvn-orthant': 1e-5, 'brier-grad': 1e-5 });
const CALIBRATION = Object.freeze({ 'mvn-orthant': [48, 192], 'brier-grad': [64, 512] });
export const defaultCachePath = (env = process.env) => env.COMPUTE_CALIBRATION ?? join(env.HOME ?? homedir(), '.cache', '561-group', 'compute-calibration.json');

export function defaultBackends() {
  return [
    createCpuInline(), createCpuPool(), createWebgpuWsl(), createWebgpuWindows(),
    createWindowsOrt({ id: 'ort-dml-fp32', provider: 'DmlExecutionProvider', dtype: 'fp32', device: 'gpu' }),
    createWindowsOrt({ id: 'ort-dml-fp16', provider: 'DmlExecutionProvider', dtype: 'fp16', device: 'gpu' }),
    createWindowsOrt({ id: 'ort-npu-fp16', provider: 'VitisAIExecutionProvider', dtype: 'fp16', device: 'npu' }),
  ];
}

export const fingerprint = () => ({ host: hostname(), cpu: cpus()[0]?.model ?? 'unknown', threads: availableParallelism() });
const freeCores = () => Math.max(1, availableParallelism() - loadavg()[0]);
const ms = (f) => { const t = performance.now(); return Promise.resolve(f()).then((r) => [r, performance.now() - t]); };

export function createPlanner({ backends = defaultBackends(), cachePath = defaultCachePath(), maxAgeMs = 24 * 3600e3, retryUnavailableMs = 15 * 60e3, tolerance = {}, log = () => {} } = {}) {
  const byId = new Map(backends.map((b) => [b.id, b]));
  const tol = { ...DEFAULT_TOLERANCE, ...tolerance };
  const warm = new Set(); const failed = new Map(); const refs = new Map();
  let cache = { schema: 1, fingerprint: fingerprint(), entries: {} };
  try { const c = JSON.parse(readFileSync(cachePath, 'utf8')); if (c.schema === 1 && JSON.stringify(c.fingerprint) === JSON.stringify(cache.fingerprint)) cache = c; } catch { /* no cache */ }
  const save = () => { if (!cachePath) return; try { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, `${JSON.stringify(cache, null, 1)}\n`); } catch { /* read-only cache dir */ } };

  async function measure(kernelId, backend) {
    const k = KERNELS[kernelId]; const [n1, n2] = CALIBRATION[kernelId];
    const b1 = k.make(n1, { seed: 101 }); const b2 = k.make(n2, { seed: 202 });
    if (!refs.has(kernelId)) refs.set(kernelId, k.reference(b2));
    const e = { kernel: kernelId, backend: backend.id, device: backend.device, precision: backend.precision, measuredAt: Date.now(), freeCores: freeCores() };
    if (!backend.kernels.has(kernelId)) return { ...e, available: false, reason: 'kernel not implemented by this backend' };
    let probe; let startupMs;
    try { [probe, startupMs] = await ms(() => backend.probe()); } catch (err) { return { ...e, available: false, reason: String(err.message ?? err).split('\n')[0] }; }
    if (!probe.ok) return { ...e, available: false, reason: probe.reason, info: probe.info };
    try {
      const [, firstMs] = await ms(() => backend.run(kernelId, b1)); // warm-up: shader compile, JIT, allocator
      const best = async (batch) => { let t = Infinity; let out; for (let i = 0; i < 2; i += 1) { const [o, d] = await ms(() => backend.run(kernelId, batch)); if (d < t) t = d; out = o; } return [out, t]; };
      const [, t1] = await best(b1); const [got, t2] = await best(b2);
      const w1 = k.work(b1); const w2 = k.work(b2);
      const unitMs = Math.max((t2 - t1) / (w2 - w1), 1e-9);
      const fixedMs = Math.max(0, t1 - unitMs * w1);
      warm.add(backend.id);
      return { ...e, available: true, info: probe.info, software: Boolean(probe.info?.software), startupMs, firstCallMs: firstMs, fixedMs, unitMs, error: k.error(got, refs.get(kernelId)), timesMs: { [n1]: t1, [n2]: t2 } };
    } catch (err) { return { ...e, available: false, reason: `calibration run failed: ${String(err.message ?? err).split('\n')[0]}` }; }
  }

  const key = (kernelId, id) => `${kernelId}/${id}`;

  /** Measure (sequentially: one heavy benchmark at a time) every backend for each kernel; cached entries fresh enough are reused. */
  async function calibrate({ kernels = Object.keys(KERNELS), force = false } = {}) {
    for (const kernelId of kernels) for (const backend of byId.values()) {
      const old = cache.entries[key(kernelId, backend.id)];
      if (!force && old && Date.now() - old.measuredAt < (old.available ? maxAgeMs : retryUnavailableMs)) continue; // a transient failure must not bar a backend for a day
      const entry = await measure(kernelId, backend);
      cache.entries[key(kernelId, backend.id)] = entry; log(entry); save();
    }
    return cache.entries;
  }

  const shapeOf = (kernelId, x) => (x?.items !== undefined ? x : { items: KERNELS[kernelId].size(x), work: KERNELS[kernelId].work(x) });

  function place(kernelId, batchOrShape, { tolerance: tolerance_ = tol[kernelId] } = {}) {
    const { work } = shapeOf(kernelId, batchOrShape); const now = freeCores(); const considered = [];
    for (const backend of byId.values()) {
      const e = cache.entries[key(kernelId, backend.id)];
      if (!e) { considered.push({ id: backend.id, ok: false, why: 'not calibrated' }); continue; }
      if (!e.available) { considered.push({ id: backend.id, ok: false, why: `unavailable: ${e.reason}` }); continue; }
      if (failed.has(backend.id)) { considered.push({ id: backend.id, ok: false, why: `failed at run time: ${failed.get(backend.id)}` }); continue; }
      const cpuBound = e.device === 'cpu' || e.software;
      const loadFactor = cpuBound && e.backend !== 'cpu-inline' ? Math.min(8, Math.max(1, e.freeCores / now)) : 1; // fewer free cores now than when measured
      const est = (warm.has(backend.id) ? 0 : e.startupMs) + e.fixedMs + e.unitMs * work * loadFactor;
      if (e.error > tolerance_) { considered.push({ id: backend.id, ms: est, error: e.error, ok: false, why: `measured error ${e.error.toExponential(1)} > tolerance ${tolerance_.toExponential(1)} (${e.precision})` }); continue; }
      considered.push({ id: backend.id, ms: est, error: e.error, ok: true, loadFactor, why: 'within tolerance' });
    }
    const ok = considered.filter((c) => c.ok).sort((a, b) => a.ms - b.ms);
    const floor = ok.length ? null : considered.find((c) => c.id === 'cpu-pool' && c.ok) ?? { id: 'cpu-inline', ms: NaN, ok: true, why: 'no calibrated backend qualifies; CPU floor' };
    const pick = ok[0] ?? floor;
    const runnerUp = ok[1];
    const reason = ok.length
      ? `${pick.id} fastest within tolerance ${tolerance_.toExponential(0)}: ~${pick.ms.toFixed(0)} ms${runnerUp ? ` vs ${runnerUp.id} ~${runnerUp.ms.toFixed(0)} ms` : ''}${pick.loadFactor > 1 ? ` (CPU load factor x${pick.loadFactor.toFixed(1)})` : ''}`
      : floor.why;
    return { kernel: kernelId, backend: pick.id, estimatedMs: pick.ms, tolerance: tolerance_, reason, considered, ranked: ok.map((c) => c.id) };
  }

  /** place + execute; a backend that throws is struck off and the next-best (finally cpu-inline) runs. */
  async function run(kernelId, batch, opts = {}) {
    const decision = place(kernelId, batch, opts); const order = [...decision.ranked];
    if (!order.includes('cpu-inline')) order.push('cpu-inline');
    if (!order.includes(decision.backend)) order.unshift(decision.backend);
    const fellBack = [];
    for (const id of order) {
      const backend = byId.get(id);
      try {
        const [result, elapsedMs] = await ms(() => backend.run(kernelId, batch)); warm.add(id);
        return { result, elapsedMs, decision: { ...decision, backend: id, fellBack, reason: fellBack.length ? `${decision.reason}; fell back to ${id} after ${fellBack.map((f) => `${f.id} (${f.error})`).join(', ')}` : decision.reason } };
      } catch (err) { failed.set(id, String(err.message ?? err).split('\n')[0]); fellBack.push({ id, error: failed.get(id) }); }
    }
    throw new Error(`no backend could run ${kernelId}`);
  }

  async function close() { await Promise.all([...byId.values()].map((b) => b.close().catch(() => {}))); }

  return { calibrate, place, run, close, backends: byId, table: () => cache.entries, cache: () => cache };
}

/** Re-price a batch of parlays (K1) wherever it is fastest within tolerance. */
export const priceBatch = (planner, batch, opts) => planner.run('mvn-orthant', batch, opts);
