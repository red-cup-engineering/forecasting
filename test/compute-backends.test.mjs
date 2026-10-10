import test from 'node:test';
import assert from 'node:assert/strict';
import { KERNELS } from '../src/compute/kernels.mjs';
import { createCpuInline, createCpuPool, poolSize } from '../src/compute/backends/cpu-pool.mjs';
import { defaultBackends } from '../src/compute/planner.mjs';

// Per-backend absolute tolerance on fixed seeds. fp32 devices: 1e-5; fp16 ONNX Runtime: 1e-2 (half precision).
const TOL = { 'cpu-inline': 0, 'cpu-pool': 0, 'webgpu-wsl': 1e-5, 'webgpu-windows': 1e-5, 'ort-dml-fp32': 1e-5, 'ort-dml-fp16': 1e-2, 'ort-npu-fp16': 1e-2 };
const SIZE = { 'mvn-orthant': 40, 'brier-grad': 50 };

test('pool size respects cores and available memory', () => {
  assert.equal(poolSize({ cores: 16, availMB: 4000 }), 16 > 4000 * 0.5 / 45 ? Math.floor(4000 * 0.5 / 45) : 16);
  assert.equal(poolSize({ cores: 16, availMB: 100 }), 1);
  assert.equal(poolSize({ cores: 4, availMB: 100000 }), 4);
});

for (const backend of [createCpuInline(), createCpuPool({ size: 2 }), ...defaultBackends().filter((b) => !['cpu-inline', 'cpu-pool'].includes(b.id))]) {
  for (const kernelId of Object.keys(KERNELS)) {
    test(`${backend.id} matches the reference on ${kernelId} (fixed seed)`, async (t) => {
      if (!backend.kernels.has(kernelId)) return t.skip('kernel not offered by this backend');
      let probe;
      try { probe = await backend.probe(); } catch (e) { await backend.close(); return t.skip(`unavailable: ${String(e.message).split('\n')[0]}`); }
      if (!probe.ok) { await backend.close(); return t.skip(`unavailable: ${probe.reason}`); }
      try {
        const k = KERNELS[kernelId]; const batch = k.make(SIZE[kernelId], { seed: 77 });
        const got = await backend.run(kernelId, batch);
        assert.equal(got.length, k.reference(batch).length);
        assert.ok(k.error(got, k.reference(batch)) <= TOL[backend.id], `${backend.id} error ${k.error(got, k.reference(batch))}`);
      } finally { await backend.close(); }
    });
  }
}
