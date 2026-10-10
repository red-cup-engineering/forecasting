// CPU backends. `cpu-inline` is the single-thread reference itself (the baseline and the fallback of last
// resort: always available, zero error by definition). `cpu-pool` runs the same reference code in
// worker_threads, sized to cores and to the memory actually available.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFileSync } from 'node:fs';
import { KERNELS } from '../kernels.mjs';

const WORKER_MB = 45; // measured resident cost of an idle node worker, rounded up

export function memAvailableMB() {
  try { return Number(/MemAvailable:\s+(\d+)/u.exec(readFileSync('/proc/meminfo', 'utf8'))[1]) / 1024; } catch { return 512; }
}

/** Pool size: all hardware threads, but never more workers than half of available memory can hold. */
export function poolSize({ cores = availableParallelism(), availMB = memAvailableMB(), memShare = 0.5, max = 16 } = {}) {
  return Math.max(1, Math.min(cores, max, Math.floor((availMB * memShare) / WORKER_MB)));
}

export function createCpuInline() {
  return {
    id: 'cpu-inline', device: 'cpu', precision: 'fp64', kernels: new Set(Object.keys(KERNELS)),
    probe: async () => ({ ok: true, info: { threads: 1 } }),
    run: async (kernelId, batch) => KERNELS[kernelId].reference(batch),
    close: async () => {},
  };
}

export function createCpuPool({ size = poolSize() } = {}) {
  let workers = null; let idle = [];
  const waiting = [];
  const start = () => {
    workers = Array.from({ length: size }, () => new Worker(new URL('./cpu-worker.mjs', import.meta.url)));
    idle = [...workers];
  };
  const acquire = () => (idle.length ? Promise.resolve(idle.pop()) : new Promise((res) => waiting.push(res)));
  const release = (w) => { const next = waiting.shift(); if (next) next(w); else idle.push(w); };
  const exec = async (kernelId, batch) => {
    const w = await acquire();
    try {
      return await new Promise((resolve, reject) => {
        const onMsg = (m) => { w.off('error', onErr); if (m.error) reject(new Error(m.error)); else resolve(m.result); };
        const onErr = (e) => { w.off('message', onMsg); reject(e); };
        w.once('message', onMsg); w.once('error', onErr);
        w.postMessage({ kernelId, batch });
      });
    } finally { release(w); }
  };
  return {
    id: 'cpu-pool', device: 'cpu', precision: 'fp64', kernels: new Set(Object.keys(KERNELS)), size,
    probe: async () => { if (!workers) start(); await exec('brier-grad', KERNELS['brier-grad'].make(1, { cells: 2, markets: 2 })); return { ok: true, info: { threads: size, availMB: Math.round(memAvailableMB()) } }; },
    async run(kernelId, batch) {
      if (!workers) start();
      const k = KERNELS[kernelId]; const n = k.size(batch);
      const chunks = Math.min(n, size * 4); const per = Math.ceil(n / chunks); const parts = [];
      for (let lo = 0; lo < n; lo += per) parts.push(exec(kernelId, k.slice(batch, lo, Math.min(n, lo + per))));
      return k.concat(await Promise.all(parts));
    },
    async close() { const ws = workers ?? []; workers = null; idle = []; await Promise.all(ws.map((w) => w.terminate())); },
  };
}
