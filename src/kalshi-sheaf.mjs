// Cellular sheaf over a market graph, its weighted sheaf Laplacian, and harmonic extension.
//
// House vocabulary (Obsmetrologia): a sheaf assigns a stalk to each cell and a restriction map
// along each incidence; the global sections are the degree-0 cohomology H^0 = ker(delta) = ker(L)
// (QEnriched.h0_laplacian_fixed_points, Debye/TopologicalWaveSheaf: "ker L = H^0"); the failure of
// a local assignment to glue is the coboundary delta x, its norm the Dirichlet energy x^T L x;
// the cokernel of delta is H^1, the gluing obstruction. Edge stalks carry a metric W (the
// inverse residual covariance of the calibration link kappa between the two vertex fibers).
//
// This module is the real-valued, finite-dimensional face of that structure: numerics only, with
// the sheaf definition kept literal. Dense linear algebra by hand (Cholesky, Jacobi); no deps.

// ---- small dense helpers (row-major arrays of arrays) -------------------------------------------
export const zeros = (n, m = n) => Array.from({ length: n }, () => new Array(m).fill(0));
export const matVec = (A, x) => A.map((r) => r.reduce((s, a, j) => s + a * x[j], 0));
export const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
export const transpose = (A) => (A.length ? A[0].map((_, j) => A.map((r) => r[j])) : []);
export const matMul = (A, B) => {
  const Bt = transpose(B);
  return A.map((r) => Bt.map((c) => dot(r, c)));
};

/** Solve A X = B for symmetric positive definite A by Cholesky. B is a matrix (columns = rhs). */
export function choleskySolve(A, B) {
  const n = A.length;
  const L = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 1e-12) throw new Error(`not positive definite at ${i} (pivot ${s})`);
        L[i][i] = Math.sqrt(s);
      } else L[i][j] = s / L[j][j];
    }
  }
  const m = B[0]?.length ?? 0;
  const X = zeros(n, m);
  for (let c = 0; c < m; c++) {
    const y = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = B[i][c];
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k][i] * X[k][c];
      X[i][c] = s / L[i][i];
    }
  }
  return X;
}

/** Eigenvalues (ascending) and eigenvectors (columns of V) of a symmetric matrix, cyclic Jacobi. */
export function jacobiEigen(S, maxSweeps = 60, tol = 1e-12) {
  const n = S.length;
  const A = S.map((r) => r.slice());
  const V = zeros(n);
  for (let i = 0; i < n; i++) V[i][i] = 1;
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < tol) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const idx = A.map((_, i) => i).sort((a, b) => A[a][a] - A[b][b]);
  return { values: idx.map((i) => A[i][i]), vectors: idx.map((i) => V.map((r) => r[i])) };
}

// ---- the cellular sheaf --------------------------------------------------------------------------
/**
 * @param {{id:string, dim:number}[]} vertices   stalks F(v) = R^dim
 * @param {{id:string, u:string, v:string, Fu:number[][], Fv:number[][], W:number[][]}[]} edges
 *   edge stalk F(e) = R^k; Fu: F(u) -> F(e), Fv: F(v) -> F(e) restriction maps (k x dim);
 *   W: k x k symmetric positive definite metric on F(e).  delta x (e) = Fv x_v - Fu x_u.
 */
export function buildSheaf(vertices, edges) {
  const offset = new Map();
  let n = 0;
  for (const v of vertices) { offset.set(v.id, n); n += v.dim; }
  const L = zeros(n);
  for (const e of edges) {
    const ou = offset.get(e.u), ov = offset.get(e.v);
    if (ou === undefined || ov === undefined) throw new Error(`edge ${e.id} has unknown endpoint`);
    const Fu = e.Fu, Fv = e.Fv, W = e.W;
    const FuT = transpose(Fu), FvT = transpose(Fv);
    const FuTW = matMul(FuT, W), FvTW = matMul(FvT, W);
    const Luu = matMul(FuTW, Fu), Lvv = matMul(FvTW, Fv), Luv = matMul(FuTW, Fv); // L_uv = -Luv
    const du = Fu[0].length, dv = Fv[0].length;
    for (let i = 0; i < du; i++) for (let j = 0; j < du; j++) L[ou + i][ou + j] += Luu[i][j];
    for (let i = 0; i < dv; i++) for (let j = 0; j < dv; j++) L[ov + i][ov + j] += Lvv[i][j];
    for (let i = 0; i < du; i++) for (let j = 0; j < dv; j++) { L[ou + i][ov + j] -= Luv[i][j]; L[ov + j][ou + i] -= Luv[i][j]; }
  }
  return { vertices, edges, offset, n, L };
}

/** Coboundary residual delta x per edge (length-k vector each). */
export function coboundary(sheaf, x) {
  return sheaf.edges.map((e) => {
    const xu = x.slice(sheaf.offset.get(e.u), sheaf.offset.get(e.u) + e.Fu[0].length);
    const xv = x.slice(sheaf.offset.get(e.v), sheaf.offset.get(e.v) + e.Fv[0].length);
    const a = matVec(e.Fv, xv), b = matVec(e.Fu, xu);
    return a.map((t, i) => t - b[i]);
  });
}

/** Dirichlet energy x^T L x = sum_e r_e^T W_e r_e, and the per-edge decomposition. */
export function dirichlet(sheaf, x) {
  const r = coboundary(sheaf, x);
  const perEdge = sheaf.edges.map((e, i) => ({ id: e.id, u: e.u, v: e.v, energy: dot(r[i], matVec(e.W, r[i])), residual: r[i] }));
  return { energy: perEdge.reduce((s, e) => s + e.energy, 0), perEdge };
}

/** Per-vertex tension: half of the energy of each incident edge, attributed to each endpoint. */
export function vertexTension(sheaf, x) {
  const { perEdge } = dirichlet(sheaf, x);
  const t = new Map(sheaf.vertices.map((v) => [v.id, 0]));
  for (const e of perEdge) { t.set(e.u, t.get(e.u) + e.energy / 2); t.set(e.v, t.get(e.v) + e.energy / 2); }
  return t;
}

/**
 * Harmonic extension: minimise x^T L x with the observed coordinates clamped.
 *
 * The free coordinates are IDENTIFIED only if the unregularized Dirichlet
 * Hessian L_FF is positive definite. A disconnected component, an unanchored
 * global section, or a free gauge direction makes the answer non-unique.
 * Adding a ridge would choose an arbitrary representative, not infer it from
 * evidence. Therefore test the unregularized Hessian BEFORE an optional ridge.
 *
 * A positive ridge is allowed only as numerical regularization AFTER uniqueness
 * has been established. It slightly changes the minimizer; it does not supply
 * missing observations or prove a probabilistic forecast.
 */
export function harmonicExtension(sheaf, x, free, ridge = 1e-9) {
  if (!sheaf || !Number.isSafeInteger(sheaf.n) ||
      !Array.isArray(x) || x.length !== sheaf.n ||
      x.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
      !Array.isArray(free) || free.length !== sheaf.n ||
      free.some((v) => typeof v !== 'boolean') ||
      typeof ridge !== 'number' || !Number.isFinite(ridge) || ridge < 0)
    throw new TypeError('bounded sheaf coordinates, free mask and nonnegative finite ridge required');
  const F = [], B = [];
  free.forEach((f, i) => (f ? F : B).push(i));
  if (!F.length) return x.slice();
  const L = sheaf.L;
  const raw = F.map((i) => F.map((j) => L[i][j]));
  const rhs = F.map((i) => [-B.reduce((s, j) => s + L[i][j] * x[j], 0)]);
  // Positive definiteness of L_FF is the uniqueness condition for a
  // convex quadratic energy; a ridge must never obscure a null direction.
  const identifiedSolution = choleskySolve(raw, rhs);
  const sol = ridge === 0 ? identifiedSolution : choleskySolve(
    raw.map((row, i) => row.map((v, j) => v + (i === j ? ridge : 0))), rhs);
  const out = x.slice();
  F.forEach((i, k) => { out[i] = sol[k][0]; });
  return out;
}

/** Spectrum of L (ascending). The multiplicity of zero is dim H^0 (global sections). */

/**
 * Recover the identifiable coordinates of a PARTIALLY constrained cellular
 * sheaf without asserting a fictitious unique global harmonic section.
 *
 * The previous harmonicExtension remains the strict all-or-nothing solver.
 * Here the free-coordinate Hessian is decomposed into independent blocks.
 * Positive-definite blocks are solved exactly; singular blocks are analyzed
 * spectrally, so only coordinates invariant along EVERY null direction are
 * reported as estimates. Unknown coordinates become null, never zero-filled
 * predictions. This is finite-dimensional numerical sheaf analysis, not a
 * Bayesian posterior or a separately defined SignGraph.
 *
 * maxSpectralDimension caps the expensive Jacobi fallback for singular blocks;
 * an oversized singular block is explicitly withheld instead of guessed.
 */
export function partiallyIdentifiedHarmonicExtension(
  sheaf, x, free, {maxSpectralDimension = 96} = {},
) {
  if (!Number.isInteger(maxSpectralDimension) ||
      maxSpectralDimension < 2 || maxSpectralDimension > 512)
    throw new TypeError('bounded singular-component dimension required');
  let fullyIdentified = null;
  try {
    fullyIdentified = harmonicExtension(sheaf, x, free, 0);
  } catch (error) {
    if (!/not positive definite/.test(error.message)) throw error;
  }
  if (fullyIdentified !== null) return {
    kind: 'identified-cellular-sheaf-extension-v1',
    status: 'fully-identified',
    values: fullyIdentified,
    identified: new Array(sheaf.n).fill(true),
    withheldCoordinates: [],
    freeCount: free.filter(Boolean).length,
    identifiedFreeCount: free.filter(Boolean).length,
    unresolvedNullity: 0,
    numericalLimitations: [],
    tradeEligible: false, orderEffect: false,
  };

  const F = [];
  free.forEach((f, i) => {if (f) F.push(i);});
  const rhs = F.map(i => -sheaf.L[i].reduce((sum, a, j) =>
    sum + (free[j] ? 0 : a * x[j]), 0));
  const hessian = F.map(i => F.map(j => sheaf.L[i][j]));
  const values = x.slice(),identified = free.map(f => !f),withheld = [];
  const seen = new Set();
  let unresolvedNullity = 0, nullityKnown = true;

  // The free Hessian decomposes along zero off-diagonal incidences. A
  // connected block can itself have a gauge symmetry; connectivity is NOT
  // substituted for positive definiteness.
  for (let k = 0; k < F.length; k++) {
    if (seen.has(k)) continue;
    const pending = [k], component = [];
    seen.add(k);
    while (pending.length) {
      const i = pending.pop();
      component.push(i);
      for (let j = 0; j < F.length; j++) if (!seen.has(j) &&
          (hessian[i][j] !== 0 || hessian[j][i] !== 0)) {
        seen.add(j); pending.push(j);
      }
    }
    component.sort((a, b) => a - b);
    const H = component.map(i => component.map(j => hessian[i][j]));
    const b = component.map(i => rhs[i]);
    let blockValues = null,unknownLocal = [];
    try {
      blockValues = choleskySolve(H, b.map(v => [v])).map(v => v[0]);
    } catch (error) {
      if (!/not positive definite/.test(error.message)) throw error;
    }
    if (blockValues === null && component.length > maxSpectralDimension) {
      nullityKnown = false;
      unknownLocal = component.map((_, i) => i);
    } else if (blockValues === null) {
      const scale = Math.max(1, ...H.map((row, i) => Math.abs(row[i])));
      const {values: eigenvalues, vectors} = jacobiEigen(H, 100,
        Math.max(1e-28, (1e-12 * scale) ** 2));
      const cutoff = Math.max(1e-11, scale * 1e-10);
      if (eigenvalues.some(value => value < -cutoff))
        throw new RangeError('free sheaf Hessian is not positive semidefinite');
      const gauges = [],candidate = new Array(component.length).fill(0);
      for (let mode = 0; mode < eigenvalues.length; mode++) {
        const vector = vectors[mode];
        if (eigenvalues[mode] <= cutoff) {
          gauges.push(vector);
          continue;
        }
        const amplitude = vector.reduce((sum, v, i) => sum + v * b[i], 0) /
          eigenvalues[mode];
        for (let i = 0; i < candidate.length; i++)
          candidate[i] += amplitude * vector[i];
      }
      unresolvedNullity += gauges.length;
      const residual = H.map((row, i) =>
        row.reduce((sum, value, j) => sum + value * candidate[j], 0) - b[i]);
      const residualScale = Math.max(1, ...b.map(Math.abs));
      const unreliable = residual.some(v =>
        !Number.isFinite(v) || Math.abs(v) > 1e-7 * residualScale);
      for (let i = 0; i < component.length; i++) if (unreliable ||
          gauges.some(v => Math.abs(v[i]) > 1e-7))
        unknownLocal.push(i);
      blockValues = candidate;
    }
    for (let i = 0; i < component.length; i++) {
      const coord = F[component[i]];
      if (unknownLocal.includes(i) || blockValues === null ||
          !Number.isFinite(blockValues[i])) {
        values[coord] = null;
        withheld.push(coord);
      } else {
        values[coord] = blockValues[i];
        identified[coord] = true;
      }
    }
  }
  return {
    kind: 'identified-cellular-sheaf-extension-v1',
    status: withheld.length ? 'partially-identified' : 'fully-identified',
    values, identified,
    withheldCoordinates: withheld.sort((a, b) => a - b),
    freeCount: F.length,
    identifiedFreeCount: F.length - withheld.length,
    unresolvedNullity: nullityKnown ? unresolvedNullity : null,
    numericalLimitations: nullityKnown ? [] :
      ['oversized singular sheaf blocks withheld without spectral interpolation'],
    tradeEligible: false, orderEffect: false,
  };
}

export const sheafSpectrum = (sheaf) => jacobiEigen(sheaf.L);

// ---- calibration links: fitted restriction maps -------------------------------------------------
/**
 * Fit the restriction pair for a correlated link from paired vertex data:  x_v ~ B x_u + noise.
 * Returns Fu = B, Fv = I, and W = inverse residual covariance (the edge-stalk metric).
 * Ridge shrinks B toward `prior` (default 0 would flatten; we shrink toward the diagonal `shrinkTo`).
 */
export function fitCalibrationLink(pairs, { ridge = 1.0, shrinkTo = null, covRidge = 1e-3 } = {}) {
  const d = pairs[0].xu.length;
  const n = pairs.length;
  const B0 = shrinkTo ?? zeros(d);
  // normal equations with ridge toward B0:  B = (Y X^T + r B0)(X X^T + r I)^-1 , row-wise on centred? no: anomalies already.
  const XX = zeros(d), YX = zeros(d);
  for (const { xu, xv } of pairs) for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) { XX[i][j] += xu[i] * xu[j]; YX[i][j] += xv[i] * xu[j]; }
  for (let i = 0; i < d; i++) XX[i][i] += ridge;
  const rhs = YX.map((r, i) => r.map((y, j) => y + ridge * B0[i][j]));
  // B = rhs * XX^{-1}  => B^T = XX^{-1} rhs^T
  const Bt = choleskySolve(XX, transpose(rhs));
  const B = transpose(Bt);
  const C = zeros(d);
  for (const { xu, xv } of pairs) {
    const p = matVec(B, xu);
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) C[i][j] += (xv[i] - p[i]) * (xv[j] - p[j]);
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) C[i][j] /= Math.max(1, n - d);
  for (let i = 0; i < d; i++) C[i][i] += covRidge;
  const eye = zeros(d); for (let i = 0; i < d; i++) eye[i][i] = 1;
  const W = choleskySolve(C, eye);
  return { Fu: B, Fv: eye, W, cov: C, n };
}

// ---- ladder-implied local sections ---------------------------------------------------------------
const SQ2 = Math.SQRT2;
function erf(x) { // Abramowitz-Stegun 7.1.26, |err| < 1.5e-7
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normCdf = (z) => 0.5 * (1 + erf(z / SQ2));

/** P(settled integer value in bracket [lo,hi]) under Normal(mu,sigma) with continuity correction. lo/hi may be +-Infinity. */
export function bracketProb(mu, sigma, lo, hi) {
  const a = lo === -Infinity ? 0 : normCdf((lo - 0.5 - mu) / sigma);
  const b = hi === Infinity ? 1 : normCdf((hi + 0.5 - mu) / sigma);
  return Math.max(0, b - a);
}

/** Bracket integer bounds from a Kalshi market's strike fields (house reading: less X = K<=X-1, greater X = K>=X+1). */
export function bracketBounds({ strike, floor, cap }) {
  if (strike === "less") return [-Infinity, cap - 1];
  if (strike === "greater") return [floor + 1, Infinity];
  return [floor, cap];
}

/**
 * Fit the ladder-implied Normal section (mu, sigma) to normalised bracket probabilities by
 * least squares on the bracket masses (the local section: the ladder as a distribution).
 * brackets: [{lo,hi,p}]. Returns {mu, sigma, sse, mass}. The sse is the local (within-fibre) incoherence.
 */
export function fitLadder(brackets) {
  const mass = brackets.reduce((s, b) => s + b.p, 0);
  if (!(mass > 0)) return null;
  const q = brackets.map((b) => ({ ...b, p: b.p / mass }));
  const sse = (mu, sg) => q.reduce((s, b) => s + (bracketProb(mu, sg, b.lo, b.hi) - b.p) ** 2, 0);
  // initial: mean over finite bracket midpoints
  let m0 = 0, w0 = 0;
  for (const b of q) { const mid = b.lo === -Infinity ? b.hi - 1 : b.hi === Infinity ? b.lo + 1 : (b.lo + b.hi) / 2; m0 += mid * b.p; w0 += b.p; }
  let mu = m0 / w0, sg = 3, step = 2, sstep = 1, best = sse(mu, sg);
  for (let it = 0; it < 200 && (step > 1e-4 || sstep > 1e-4); it++) {
    let improved = false;
    for (const [dm, ds] of [[step, 0], [-step, 0], [0, sstep], [0, -sstep], [step, sstep], [-step, -sstep], [step, -sstep], [-step, sstep]]) {
      const m = mu + dm, s = Math.max(0.3, sg + ds), v = sse(m, s);
      if (v < best - 1e-15) { best = v; mu = m; sg = s; improved = true; }
    }
    if (!improved) { step /= 2; sstep /= 2; }
  }
  return { mu, sigma: sg, sse: best, mass };
}
