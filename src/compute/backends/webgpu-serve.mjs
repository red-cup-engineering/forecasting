// Windows-side WebGPU worker: run by node.exe beside a Windows build of the `webgpu` npm package
// (Dawn -> D3D12 -> the real Radeon). Speaks the frame protocol on stdio; see webgpu.mjs for the client.
import { encodeFrame, frameReader } from './frame.mjs';
import { openGpu, gpuMvn, gpuGrad } from './webgpu-device.mjs';

let gpuP = null;
const gpu = () => (gpuP ??= openGpu(new URL('./node_modules/webgpu/index.js', import.meta.url).href, { powerPreference: 'high-performance' }));
const send = (header, bufs) => process.stdout.write(encodeFrame(header, bufs));
let chain = Promise.resolve();

process.stdin.on('data', frameReader((h, p) => {
  chain = chain.then(async () => {
    try {
      const g = await gpu(); const t = performance.now();
      if (h.op === 'hello') return send({ id: h.id, ok: true, info: g.info });
      if (h.op === 'k1') {
        const prep = { P: h.P, samples: h.samples, seed: h.seed, mode: new Uint32Array(p.mode), dims: new Uint32Array(p.dims), fixed: new Float32Array(p.fixed), L: new Float32Array(p.L), b: new Float32Array(p.b) };
        const out = await gpuMvn(g, prep); return send({ id: h.id, ok: true, ms: performance.now() - t }, [['out', out]]);
      }
      if (h.op === 'k2') {
        const out = await gpuGrad(g, { B: h.B, C: h.C, K: h.K, A: new Uint8Array(p.A), r: new Float64Array(p.r) });
        return send({ id: h.id, ok: true, ms: performance.now() - t }, [['out', out]]);
      }
      send({ id: h.id, ok: false, error: `unknown op ${h.op}` });
    } catch (e) { send({ id: h.id, ok: false, error: String(e?.stack ?? e) }); }
  });
}));
process.stdin.on('end', () => process.exit(0));
