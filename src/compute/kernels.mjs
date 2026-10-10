// Typed compute kernels. Each kernel is a pure function over a packed batch (typed arrays), so any
// backend (worker thread, WebGPU, ONNX Runtime) receives the same bytes and is judged against the same
// pure reference implementation. A kernel is {id, reference, make, size, work, slice, concat, error}.
//
//   K1 'mvn-orthant'  batched P(X <= b), X ~ N(0, R), Genz SOV Monte Carlo (reference: mvnLowerProb)
//   K2 'brier-grad'   batched dense gradient A r of the Brier projection's Frank-Wolfe step
//                     (reference loop: the `grad` closure of brierProjection in combo-rigidity.mjs)
import { Phi, mulberry32, mvnLowerProb } from '../combo-pricer.mjs';

export const NMAX = 9; // parlay legs, dimension 2..9

// ---------------------------------------------------------------- K1

/** Packed K1 batch: P problems padded to NMAX. n[i] is the dimension, b is P*NMAX, R is P*NMAX*NMAX (row-major). */
export function packMvn(problems, { samples = 4000, seed = 20261004 } = {}) {
  const P = problems.length;
  const n = new Uint8Array(P); const b = new Float64Array(P * NMAX); const R = new Float64Array(P * NMAX * NMAX);
  problems.forEach((pr, i) => {
    const d = pr.b.length; if (d > NMAX) throw new RangeError(`dimension ${d} exceeds ${NMAX}`);
    n[i] = d;
    for (let j = 0; j < d; j += 1) { b[i * NMAX + j] = pr.b[j]; for (let k = 0; k < d; k += 1) R[i * NMAX * NMAX + j * NMAX + k] = pr.R[j][k]; }
  });
  return { P, n, b, R, samples, seed };
}

export function unpackMvn(batch, i) {
  const d = batch.n[i];
  const b = Array.from(batch.b.subarray(i * NMAX, i * NMAX + d));
  const R = Array.from({ length: d }, (_, j) => Array.from(batch.R.subarray(i * NMAX * NMAX + j * NMAX, i * NMAX * NMAX + j * NMAX + d)));
  return { b, R };
}

/** Pure reference: the house pricer, problem by problem, in float64. */
export function mvnReference(batch) {
  const out = new Float64Array(batch.P);
  for (let i = 0; i < batch.P; i += 1) { const { b, R } = unpackMvn(batch, i); out[i] = mvnLowerProb(b, R, { samples: batch.samples, seed: batch.seed }).p; }
  return out;
}

function cholLower(M, n) { // float64, same recurrence and threshold as combo-pricer.cholesky
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) for (let j = 0; j <= i; j += 1) {
    let s = M[i * n + j]; for (let k = 0; k < j; k += 1) s -= L[i * n + k] * L[j * n + k];
    if (i === j) { if (s <= 1e-9) return null; L[i * n + i] = Math.sqrt(s); } else L[i * n + j] = s / L[j * n + j];
  }
  return L;
}

/**
 * Host-side preparation for device backends: everything that is O(n^3) or branchy (early exits, shrink
 * toward identity, Cholesky) stays in float64 on the host, exactly as mvnLowerProb does it; the device
 * receives only the Monte Carlo loop. mode 1 = device computes; mode 0 = `fixed` is the answer.
 */
export function prepareMvn(batch) {
  const { P, n, samples, seed } = batch;
  const mode = new Uint32Array(P); const fixed = new Float32Array(P); const dims = new Uint32Array(P);
  const L = new Float32Array(P * NMAX * NMAX); const b = new Float32Array(P * NMAX);
  for (let i = 0; i < P; i += 1) {
    const d = n[i]; dims[i] = d;
    const bi = batch.b.subarray(i * NMAX, i * NMAX + d);
    if (d === 0) { fixed[i] = 1; continue; }
    if (bi.some((x) => x === -Infinity)) { fixed[i] = 0; continue; }
    if (d === 1) { fixed[i] = Phi(bi[0]); continue; }
    const R = new Float64Array(d * d);
    for (let j = 0; j < d; j += 1) for (let k = 0; k < d; k += 1) R[j * d + k] = batch.R[i * NMAX * NMAX + j * NMAX + k];
    let Lm = cholLower(R, d); let lam = 1;
    while (!Lm && lam > 0.02) { lam *= 0.8; const M = new Float64Array(d * d); for (let j = 0; j < d; j += 1) for (let k = 0; k < d; k += 1) M[j * d + k] = j === k ? 1 : R[j * d + k] * lam; Lm = cholLower(M, d); }
    if (!Lm) { fixed[i] = bi.reduce((acc, x) => acc * Phi(x), 1); continue; }
    mode[i] = 1;
    for (let j = 0; j < d; j += 1) { b[i * NMAX + j] = Math.max(-60, Math.min(60, bi[j])); for (let k = 0; k <= j; k += 1) L[i * NMAX * NMAX + j * NMAX + k] = Lm[j * d + k]; }
  }
  return { P, samples, seed, mode, dims, fixed, L, b };
}

function sliceMvn(batch, lo, hi) {
  return {
    P: hi - lo, samples: batch.samples, seed: batch.seed, n: batch.n.slice(lo, hi),
    b: batch.b.slice(lo * NMAX, hi * NMAX), R: batch.R.slice(lo * NMAX * NMAX, hi * NMAX * NMAX),
  };
}

/** Deterministic synthetic parlays: dimension 2..9, correlations of the sort the house fits (mostly small, some strong). */
export function makeMvnBatch(P, { seed = 7, samples = 4000, minDim = 2, maxDim = NMAX } = {}) {
  const rnd = mulberry32(seed); const problems = [];
  for (let i = 0; i < P; i += 1) {
    const d = minDim + Math.floor(rnd() * (maxDim - minDim + 1));
    const b = Array.from({ length: d }, () => -0.6 + 2.2 * rnd()); // thresholds -> leg probs ~0.27..0.95
    const R = Array.from({ length: d }, (_, j) => Array.from({ length: d }, (_, k) => (j === k ? 1 : 0)));
    for (let j = 0; j < d; j += 1) for (let k = 0; k < j; k += 1) { const r = (rnd() < 0.25 ? 0.7 : 0.25) * (2 * rnd() - 0.6); R[j][k] = r; R[k][j] = r; }
    problems.push({ b, R }); // not necessarily PD: exercises the shrink path, as real fitted matrices do
  }
  return packMvn(problems, { samples, seed: 20261004 });
}

export const mvnOrthant = {
  id: 'mvn-orthant',
  reference: mvnReference,
  make: makeMvnBatch,
  size: (batch) => batch.P,
  /** floating-point-operation proxy: normal-CDF evaluations */
  work: (batch) => { let w = 0; for (let i = 0; i < batch.P; i += 1) w += batch.n[i] * batch.samples; return w; },
  slice: sliceMvn,
  concat: (parts) => { const out = new Float64Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; },
  /** worst absolute probability error */
  error: (got, ref) => { let m = 0; for (let i = 0; i < ref.length; i += 1) m = Math.max(m, Math.abs(got[i] - ref[i])); return m; },
};

// ---------------------------------------------------------------- K2

/** Packed K2 batch: B families, each C cells x K quoted markets. A is 0/1 membership (cell c in market k), r the residual Aq - m. */
export function makeGradBatch(B, { seed = 11, cells = 64, markets = 24 } = {}) {
  const rnd = mulberry32(seed); const A = new Uint8Array(B * cells * markets); const r = new Float64Array(B * markets);
  for (let i = 0; i < A.length; i += 1) A[i] = rnd() < 0.4 ? 1 : 0;
  for (let i = 0; i < r.length; i += 1) r[i] = rnd() - 0.5;
  return { B, C: cells, K: markets, A, r };
}

export function gradReference(batch) {
  const { B, C, K, A, r } = batch; const g = new Float64Array(B * C);
  for (let f = 0; f < B; f += 1) for (let c = 0; c < C; c += 1) {
    let s = 0; const row = (f * C + c) * K; for (let k = 0; k < K; k += 1) if (A[row + k]) s += r[f * K + k];
    g[f * C + c] = s;
  }
  return g;
}

export const brierGrad = {
  id: 'brier-grad',
  reference: gradReference,
  make: makeGradBatch,
  size: (batch) => batch.B,
  work: (batch) => batch.B * batch.C * batch.K,
  slice: (batch, lo, hi) => ({ B: hi - lo, C: batch.C, K: batch.K, A: batch.A.slice(lo * batch.C * batch.K, hi * batch.C * batch.K), r: batch.r.slice(lo * batch.K, hi * batch.K) }),
  concat: mvnOrthant.concat,
  error: mvnOrthant.error,
};

export const KERNELS = Object.freeze({ [mvnOrthant.id]: mvnOrthant, [brierGrad.id]: brierGrad });
