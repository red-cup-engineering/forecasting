// WebGPU (Dawn) device code and WGSL kernels. Self-contained (no imports from the repo) so the same file
// runs in-process under WSL (Dawn -> Vulkan: llvmpipe) and, staged beside a Windows node.exe, on the real
// GPU through Dawn -> D3D12. Precision is fp32; all branchy / O(n^3) work stays on the host (kernels.prepareMvn).

const NMAX = 9;

const WGSL_PHI = /* wgsl */ `
fn Phi(x: f32) -> f32 {
  let z = abs(x);
  var p: f32 = 0.0;
  if (z <= 37.0) {
    let e = exp(-z * z / 2.0);
    if (z < 7.07106781186547) {
      var n = 3.52624965998911e-2 * z + 0.700383064443688;
      n = n * z + 6.37396220353165; n = n * z + 33.912866078383; n = n * z + 112.079291497871;
      n = n * z + 221.213596169931; n = n * z + 220.206867912376;
      var d = 8.83883476483184e-2 * z + 1.75566716318264;
      d = d * z + 16.064177579207; d = d * z + 86.7807322029461; d = d * z + 296.564248779674;
      d = d * z + 637.333633378831; d = d * z + 793.826512519948; d = d * z + 440.413735824752;
      p = e * n / d;
    } else {
      var b = z + 0.65; b = z + 4.0 / b; b = z + 3.0 / b; b = z + 2.0 / b; b = z + 1.0 / b;
      p = e / b / 2.506628274631;
    }
  }
  if (x > 0.0) { return 1.0 - p; }
  return p;
}

fn PhiInv(p: f32) -> f32 {
  var x: f32;
  if (p < 0.02425) {
    let q = sqrt(-2.0 * log(p));
    x = (((((-7.784894002430293e-03 * q - 3.223964580411365e-01) * q - 2.400758277161838) * q - 2.549732539343734) * q + 4.374664141464968) * q + 2.938163982698783) / ((((7.784695709041462e-03 * q + 3.224671290700398e-01) * q + 2.445134137142996) * q + 3.754408661907416) * q + 1.0);
  } else if (p > 1.0 - 0.02425) {
    let q = sqrt(-2.0 * log(1.0 - p));
    x = -(((((-7.784894002430293e-03 * q - 3.223964580411365e-01) * q - 2.400758277161838) * q - 2.549732539343734) * q + 4.374664141464968) * q + 2.938163982698783) / ((((7.784695709041462e-03 * q + 3.224671290700398e-01) * q + 2.445134137142996) * q + 3.754408661907416) * q + 1.0);
  } else {
    let q = p - 0.5; let r = q * q;
    x = (((((-3.969683028665376e+01 * r + 2.209460984245205e+02) * r - 2.759285104469687e+02) * r + 1.383577518672690e+02) * r - 3.066479806614716e+01) * r + 2.506628277459239) * q / (((((-5.447609879822406e+01 * r + 1.615858368580409e+02) * r - 1.556989798598866e+02) * r + 6.680131188771972e+01) * r - 1.328068155288572e+01) * r + 1.0);
  }
  let e = Phi(x) - p; let u = e * 2.5066282746 * exp(x * x / 2.0);
  return x - u / (1.0 + x * u / 2.0);
}`;

// mulberry32 is counter-based (state_k = seed + (k+1)*C), so draw k of the reference stream is random-access.
const WGSL_K1 = /* wgsl */ `
${WGSL_PHI}
struct Params { P: u32, half: u32, seed: u32, nwx: u32 };
@group(0) @binding(0) var<uniform> prm: Params;
@group(0) @binding(1) var<storage, read> dims: array<u32>;
@group(0) @binding(2) var<storage, read> mode: array<u32>;
@group(0) @binding(3) var<storage, read> fixedP: array<f32>;
@group(0) @binding(4) var<storage, read> Lm: array<f32>;
@group(0) @binding(5) var<storage, read> bv: array<f32>;
@group(0) @binding(6) var<storage, read_write> outp: array<f32>;
var<workgroup> part: array<f32, 64>;

fn rnd(k: u32) -> f32 {
  var t = prm.seed + (k + 1u) * 0x6D2B79F5u;
  t = (t ^ (t >> 15u)) * (t | 1u);
  t = t ^ (t + (t ^ (t >> 7u)) * (t | 61u));
  let r = t ^ (t >> 14u);
  return f32(r >> 8u) * (1.0 / 16777216.0);
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wid: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let pi = wid.x + wid.y * prm.nwx;
  let valid = pi < prm.P;
  var acc: f32 = 0.0;
  if (valid && mode[pi] == 1u) {
    let n = dims[pi]; let lb = pi * ${NMAX * NMAX}u; let bb = pi * ${NMAX}u;
    var s = li;
    loop {
      if (s >= prm.half) { break; }
      var w: array<f32, ${NMAX}>;
      for (var i = 0u; i + 1u < n; i = i + 1u) { w[i] = rnd(s * (n - 1u) + i); }
      for (var flip = 0u; flip < 2u; flip = flip + 1u) {
        var prod: f32 = 1.0; var y: array<f32, ${NMAX}>;
        for (var i = 0u; i < n; i = i + 1u) {
          var m: f32 = 0.0;
          for (var j = 0u; j < i; j = j + 1u) { m = m + Lm[lb + i * ${NMAX}u + j] * y[j]; }
          let e = Phi((bv[bb + i] - m) / Lm[lb + i * ${NMAX}u + i]);
          prod = prod * e;
          if (i + 1u < n) {
            var u = w[i]; if (flip == 1u) { u = 1.0 - u; }
            y[i] = PhiInv(min(1.0 - 1e-7, max(1e-12, u * e)));
          }
        }
        acc = acc + prod;
      }
      s = s + 64u;
    }
  }
  part[li] = acc;
  workgroupBarrier();
  for (var st = 32u; st > 0u; st = st >> 1u) {
    if (li < st) { part[li] = part[li] + part[li + st]; }
    workgroupBarrier();
  }
  if (li == 0u && valid) {
    if (mode[pi] == 1u) { outp[pi] = part[0] / (2.0 * f32(prm.half)); } else { outp[pi] = fixedP[pi]; }
  }
}`;

const WGSL_K2 = /* wgsl */ `
struct Params { B: u32, C: u32, K: u32, nx: u32 };
@group(0) @binding(0) var<uniform> prm: Params;
@group(0) @binding(1) var<storage, read> A: array<f32>;
@group(0) @binding(2) var<storage, read> r: array<f32>;
@group(0) @binding(3) var<storage, read_write> g: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x + gid.y * prm.nx;
  if (idx >= prm.B * prm.C) { return; }
  let f = idx / prm.C; let row = idx * prm.K; var s: f32 = 0.0;
  for (var k = 0u; k < prm.K; k = k + 1u) { s = s + A[row + k] * r[f * prm.K + k]; }
  g[idx] = s;
}`;

export async function openGpu(indexUrl, { powerPreference } = {}) {
  const { create, globals } = await import(indexUrl);
  Object.assign(globalThis, globals);
  const gpu = create([]);
  const adapter = await gpu.requestAdapter(powerPreference ? { powerPreference } : {});
  if (!adapter) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  const i = adapter.info;
  const info = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description };
  info.software = /software|llvmpipe|swiftshader|warp/iu.test(`${info.architecture} ${info.device} ${info.description}`);
  // `gpu` (the Dawn instance) must stay referenced: if it is collected, mapAsync/onSubmittedWorkDone crash natively.
  return { gpu, device, adapter, info, pipelines: new Map() };
}

const BU = () => globalThis.GPUBufferUsage;
const MU = () => globalThis.GPUMapMode;

function pipeline(g, name, code) {
  if (!g.pipelines.has(name)) g.pipelines.set(name, g.device.createComputePipeline({ layout: 'auto', compute: { module: g.device.createShaderModule({ code }), entryPoint: 'main' } }));
  return g.pipelines.get(name);
}

function upload(g, data, usage = BU().STORAGE) {
  const buf = g.device.createBuffer({ size: Math.max(16, Math.ceil(data.byteLength / 4) * 4), usage: usage | BU().COPY_DST });
  g.device.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength);
  return buf;
}

async function download(g, buf, bytes, Ctor) {
  const rb = g.device.createBuffer({ size: bytes, usage: BU().COPY_DST | BU().MAP_READ });
  const enc = g.device.createCommandEncoder(); enc.copyBufferToBuffer(buf, 0, rb, 0, bytes); g.device.queue.submit([enc.finish()]);
  await g.device.queue.onSubmittedWorkDone();
  await rb.mapAsync(MU().READ); const out = new Ctor(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy(); return out;
}

function dispatchDims(groups, perRow = 65535) { return [Math.min(groups, perRow), Math.ceil(groups / perRow)]; }

/** K1 on the device. `prep` is kernels.prepareMvn(batch). Returns Float32Array(P). Chunked so one dispatch stays short. */
export async function gpuMvn(g, prep, { chunk = 4096 } = {}) {
  const out = new Float32Array(prep.P); const pl = pipeline(g, 'k1', WGSL_K1);
  for (let lo = 0; lo < prep.P; lo += chunk) {
    const hi = Math.min(prep.P, lo + chunk); const P = hi - lo; const [nx, ny] = dispatchDims(P);
    const prm = new Uint32Array([P, Math.floor(prep.samples / 2), prep.seed >>> 0, nx]);
    const bufs = [upload(g, prm, BU().UNIFORM), upload(g, prep.dims.subarray(lo, hi)), upload(g, prep.mode.subarray(lo, hi)), upload(g, prep.fixed.subarray(lo, hi)),
      upload(g, prep.L.subarray(lo * NMAX * NMAX, hi * NMAX * NMAX)), upload(g, prep.b.subarray(lo * NMAX, hi * NMAX))];
    const ob = g.device.createBuffer({ size: Math.max(16, P * 4), usage: BU().STORAGE | BU().COPY_SRC });
    const bg = g.device.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [...bufs, ob].map((buffer, binding) => ({ binding, resource: { buffer } })) });
    const enc = g.device.createCommandEncoder(); const pass = enc.beginComputePass(); pass.setPipeline(pl); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(nx, ny); pass.end();
    g.device.queue.submit([enc.finish()]);
    out.set(await download(g, ob, P * 4, Float32Array), lo);
    for (const b of [...bufs, ob]) b.destroy();
  }
  return out;
}

/** K2 on the device. A is Uint8Array membership (converted to f32), r Float64Array (to f32). Returns Float32Array(B*C). */
export async function gpuGrad(g, { B, C, K, A, r }) {
  const pl = pipeline(g, 'k2', WGSL_K2); const total = B * C; const groups = Math.ceil(total / 64); const [nx, ny] = dispatchDims(groups);
  const A32 = Float32Array.from(A); const r32 = Float32Array.from(r);
  const bufs = [upload(g, new Uint32Array([B, C, K, nx * 64]), BU().UNIFORM), upload(g, A32), upload(g, r32)];
  const ob = g.device.createBuffer({ size: Math.max(16, total * 4), usage: BU().STORAGE | BU().COPY_SRC });
  const bg = g.device.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [...bufs, ob].map((buffer, binding) => ({ binding, resource: { buffer } })) });
  const enc = g.device.createCommandEncoder(); const pass = enc.beginComputePass(); pass.setPipeline(pl); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(nx, ny); pass.end();
  g.device.queue.submit([enc.finish()]);
  const out = await download(g, ob, total * 4, Float32Array);
  for (const b of [...bufs, ob]) b.destroy();
  return out;
}

export function closeGpu(g) { try { g.device.destroy(); } catch { /* already gone */ } }
