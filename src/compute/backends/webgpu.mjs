// WebGPU backends (WGSL kernels, fp32). Two hosts, same device code (webgpu-device.mjs):
//   host 'wsl'     in-process Dawn under WSL. WSL has /dev/dxg but no Mesa d3d12/dozen Vulkan driver, so Dawn
//                  lands on llvmpipe (software Vulkan on the CPU). It is probed and measured like any backend
//                  and is flagged `software` so the planner reports it honestly.
//   host 'windows' node.exe over WSL interop, running webgpu-serve.mjs beside a Windows build of the `webgpu`
//                  package: Dawn -> D3D12 -> the Radeon 860M. Frames over stdio.
// Locations (override by env): COMPUTE_WEBGPU_DIR = a directory whose node_modules/webgpu is the Linux build;
// COMPUTE_WINDOWS_DIR = the Windows scratch dir (WSL path) holding wgpu/node_modules/webgpu (win32-x64).
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { bridge } from './bridge.mjs';
import { openGpu, gpuMvn, gpuGrad, closeGpu } from './webgpu-device.mjs';
import { prepareMvn } from '../kernels.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const SUPPORTED = new Set(['mvn-orthant', 'brier-grad']);

export function findWindowsDir(env = process.env) {
  if (env.COMPUTE_WINDOWS_DIR) return env.COMPUTE_WINDOWS_DIR;
  try {
    for (const u of readdirSync('/mnt/c/Users')) {
      const d = `/mnt/c/Users/${u}/AppData/Local/Temp/bcf-compute`;
      if (existsSync(join(d, 'wgpu/node_modules/webgpu/index.js'))) return d;
    }
  } catch { /* not WSL */ }
  return null;
}

export function createWebgpuWsl({ dir = process.env.COMPUTE_WEBGPU_DIR } = {}) {
  let g = null;
  const open = async () => g ?? (g = await openGpu(dir ? pathToFileURL(join(dir, 'node_modules/webgpu/index.js')).href : 'webgpu'));
  return {
    id: 'webgpu-wsl', device: 'gpu', precision: 'fp32', kernels: SUPPORTED,
    async probe() { const x = await open(); return { ok: true, info: { ...x.info, software: x.info.software } }; },
    async run(kernelId, batch) {
      const x = await open();
      if (kernelId === 'mvn-orthant') return Float64Array.from(await gpuMvn(x, prepareMvn(batch)));
      return Float64Array.from(await gpuGrad(x, batch));
    },
    async close() { if (g) closeGpu(g); g = null; },
  };
}

export function createWebgpuWindows({ dir = findWindowsDir(), node = 'node.exe' } = {}) {
  let br = null;
  const open = async () => {
    if (br) return br;
    if (!dir) throw new Error('no Windows scratch dir with wgpu/node_modules/webgpu (see compute/README.md)');
    const wdir = join(dir, 'wgpu'); mkdirSync(wdir, { recursive: true });
    for (const f of ['frame.mjs', 'webgpu-device.mjs', 'webgpu-serve.mjs']) copyFileSync(join(here, f), join(wdir, f)); // stage
    br = bridge(node, ['webgpu-serve.mjs'], { cwd: wdir });
    return br;
  };
  return {
    id: 'webgpu-windows', device: 'gpu', precision: 'fp32', kernels: SUPPORTED,
    async probe() { const b = await open(); const [h] = await b.call({ op: 'hello' }); return { ok: true, info: h.info }; },
    async run(kernelId, batch) {
      const b = await open();
      if (kernelId === 'mvn-orthant') {
        const p = prepareMvn(batch);
        const [, out] = await b.call({ op: 'k1', P: p.P, samples: p.samples, seed: p.seed }, [['mode', p.mode], ['dims', p.dims], ['fixed', p.fixed], ['L', p.L], ['b', p.b]]);
        return Float64Array.from(new Float32Array(out.out));
      }
      const [, out] = await b.call({ op: 'k2', B: batch.B, C: batch.C, K: batch.K }, [['A', batch.A], ['r', batch.r]]);
      return Float64Array.from(new Float32Array(out.out));
    },
    async close() { br?.close(); br = null; },
  };
}
