import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KERNELS } from '../src/compute/kernels.mjs';
import { createCpuInline } from '../src/compute/backends/cpu-pool.mjs';
import { createPlanner, fingerprint } from '../src/compute/planner.mjs';

const kernels = new Set(Object.keys(KERNELS));
const fake = (id, over = {}) => ({ id, device: 'gpu', precision: 'fp32', kernels, probe: async () => ({ ok: true, info: {} }), run: async (kid, batch) => KERNELS[kid].reference(batch), close: async () => {}, ...over });

// A cache with injected measurements, so placement logic is tested without timing noise.
function plannerWith(entries, backends, extra = {}) {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'plan-')), 'cal.json');
  const now = Date.now();
  const full = {};
  for (const [k, e] of Object.entries(entries)) full[k] = { kernel: k.split('/')[0], backend: k.split('/')[1], device: 'gpu', precision: 'fp32', measuredAt: now, freeCores: 100, available: true, startupMs: 0, fixedMs: 0, ...e };
  writeFileSync(cachePath, JSON.stringify({ schema: 1, fingerprint: fingerprint(), entries: full }));
  return createPlanner({ backends, cachePath, ...extra });
}
const K = 'mvn-orthant';
const cpu = { 'mvn-orthant/cpu-inline': { device: 'cpu', precision: 'fp64', unitMs: 1e-3, error: 0 } };

test('picks the fastest backend within tolerance, with reasons', () => {
  const p = plannerWith({ ...cpu, 'mvn-orthant/gpu': { unitMs: 1e-5, error: 1e-7 } }, [createCpuInline(), fake('gpu')]);
  const batch = KERNELS[K].make(10);
  const d = p.place(K, batch);
  assert.equal(d.backend, 'gpu'); assert.match(d.reason, /gpu fastest within tolerance/u);
  assert.equal(d.considered.length, 2);
});

test('a backend whose measured error exceeds the tolerance is passed over', () => {
  const p = plannerWith({ ...cpu, 'mvn-orthant/gpu': { unitMs: 1e-5, error: 3e-3, precision: 'fp16' } }, [createCpuInline(), fake('gpu')]);
  const batch = KERNELS[K].make(10);
  assert.equal(p.place(K, batch).backend, 'cpu-inline');
  const loose = p.place(K, batch, { tolerance: 1e-2 });
  assert.equal(loose.backend, 'gpu');
  assert.match(p.place(K, batch).considered.find((c) => c.id === 'gpu').why, /measured error .* > tolerance/u);
});

test('an unavailable backend falls back to the CPU and says why', () => {
  const p = plannerWith({ ...cpu, 'mvn-orthant/npu': { available: false, reason: 'VitisAIExecutionProvider not in ONNX Runtime providers' } }, [createCpuInline(), fake('npu', { device: 'npu' })]);
  const d = p.place(K, KERNELS[K].make(5));
  assert.equal(d.backend, 'cpu-inline');
  assert.match(d.considered.find((c) => c.id === 'npu').why, /unavailable: VitisAI/u);
});

test('startup cost is charged until a backend is warm: small batches stay on the CPU, large ones move', () => {
  const p = plannerWith({ ...cpu, 'mvn-orthant/gpu': { unitMs: 1e-5, error: 1e-7, startupMs: 500, fixedMs: 5 } }, [createCpuInline(), fake('gpu')]);
  assert.equal(p.place(K, { items: 2, work: 1000 }).backend, 'cpu-inline'); // 1 ms of CPU work vs 505 ms to start
  assert.equal(p.place(K, { items: 20000, work: 2e8 }).backend, 'gpu');
});

test('a backend that throws at run time is struck off and the next best runs, ending at the CPU', async () => {
  const boom = fake('gpu', { run: async () => { throw new Error('device lost'); } });
  const p = plannerWith({ ...cpu, 'mvn-orthant/gpu': { unitMs: 1e-6, error: 1e-7 } }, [createCpuInline(), boom]);
  const batch = KERNELS[K].make(6, { samples: 200 });
  const out = await p.run(K, batch);
  assert.equal(out.decision.backend, 'cpu-inline');
  assert.match(out.decision.reason, /fell back to cpu-inline after gpu \(device lost\)/u);
  assert.deepEqual([...out.result], [...KERNELS[K].reference(batch)]);
  assert.equal(p.place(K, batch).backend, 'cpu-inline'); // and stays struck off
});

test('calibration measures real backends against the reference and records error', async () => {
  const cachePath = join(mkdtempSync(join(tmpdir(), 'plan-')), 'cal.json');
  const lossy = fake('lossy', { run: async (kid, batch) => Float64Array.from(KERNELS[kid].reference(batch), (x) => x + 1e-3) });
  const p = createPlanner({ backends: [createCpuInline(), lossy, fake('absent', { probe: async () => ({ ok: false, reason: 'no adapter' }) })], cachePath });
  await p.calibrate({ kernels: ['brier-grad'] });
  const t = p.table();
  assert.equal(t['brier-grad/cpu-inline'].error, 0);
  assert.ok(Math.abs(t['brier-grad/lossy'].error - 1e-3) < 1e-9);
  assert.equal(t['brier-grad/absent'].available, false);
  assert.equal(p.place('brier-grad', KERNELS['brier-grad'].make(8)).backend, 'cpu-inline');
});
