// ONNX Runtime on Windows, reached from WSL through python.exe over stdio frames (bridge.mjs, ort-serve.py).
//   ort-dml-fp32 / ort-dml-fp16  DmlExecutionProvider: DirectML on the Radeon (pip onnxruntime-directml)
//   ort-npu-fp16                 VitisAIExecutionProvider: the XDNA 2 NPU. Present only when the AMD Ryzen AI
//                                Software build of ONNX Runtime is installed; probe() reports it unavailable,
//                                with the reason, otherwise. It never pretends.
// ONNX can express K2 (a batched MatMul). K1 needs an inverse normal CDF inside a sampling loop, which the
// ONNX operator set has no op for, so these backends do not offer K1.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridge } from './bridge.mjs';
import { findWindowsDir } from './webgpu.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const shared = new Map(); // one python.exe per Windows dir, shared by the dml/npu variants

function worker(dir, python) {
  const key = `${dir}|${python}`;
  if (!shared.has(key)) {
    mkdirSync(dir, { recursive: true }); copyFileSync(join(here, 'ort-serve.py'), join(dir, 'ort-serve.py'));
    shared.set(key, { br: bridge(python, ['ort-serve.py'], { cwd: dir }), users: 0, key });
  }
  const w = shared.get(key); w.users += 1; return w;
}

export function createWindowsOrt({ id = 'ort-dml-fp32', provider = 'DmlExecutionProvider', dtype = 'fp32', device = 'gpu', dir = findWindowsDir(), python = 'python.exe' } = {}) {
  let w = null;
  const open = () => {
    if (!dir) throw new Error('no Windows scratch dir with ort/ (see compute/README.md)');
    return (w ??= worker(dir, python)).br;
  };
  return {
    id, device, precision: dtype, kernels: new Set(['brier-grad']), provider,
    async probe() {
      const [h] = await open().call({ op: 'hello' });
      if (!h.info.providers.includes(provider)) return { ok: false, reason: `${provider} not in ONNX Runtime providers [${h.info.providers.join(', ')}]`, info: h.info };
      return { ok: true, info: h.info };
    },
    async run(kernelId, batch) {
      if (kernelId !== 'brier-grad') throw new Error(`${id} does not implement ${kernelId}`);
      const [, out] = await open().call({ op: 'k2', B: batch.B, C: batch.C, K: batch.K, provider, dtype }, [['A', batch.A], ['r', batch.r]]);
      return Float64Array.from(new Float32Array(out.out));
    },
    async close() { if (w && --w.users === 0) { w.br.close(); shared.delete(w.key); } w = null; },
  };
}
