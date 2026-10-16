// Pure helpers for the weather-vs-sports-totals study (data/records/2026-10-07-weather-totals/README.md).
// No I/O here: ladder -> implied median, forecast window features, fee, clustered OLS, rule P&L.

/** Taker fee per contract in dollars at price p (large-size limit, no cent rounding). */
import { feePerContract as unroundedFee } from '@red-cup-engineering/forecasting/fees';
export const feePerContract = (p, mult = 1) => unroundedFee(p, { multiplier: mult });

/** "KXMLBTOTAL-26OCT071600CLECWS-14" -> { series, event, suffix, date: '2026-10-07', hhmm|null, codes } */
export function parseTicker(ticker) {
  const m = /^(KX[A-Z]+TOTAL)-(\d\d)([A-Z]{3})(\d\d)(\d{4})?([A-Z0-9]+)-(\d+)$/.exec(ticker);
  if (!m) return null;
  const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  const mo = MON[m[3]]; if (!mo) return null;
  const date = `20${m[2]}-${String(mo).padStart(2, '0')}-${m[4]}`;
  return { series: m[1], event: `${m[1]}-${m[2]}${m[3]}${m[4]}${m[5] ?? ''}${m[6]}`, suffix: Number(m[7]), date, hhmm: m[5] ?? null, codes: m[6] };
}

/**
 * ladder: [{ strike, mid }] with mid = P(total > strike). Drops one-sided/NaN, forces non-increasing in strike
 * (running min from low strikes), returns the strike where P crosses 0.5 by linear interpolation, or null if the
 * ladder does not bracket 0.5 or has < 3 rungs.
 */
export function impliedMedian(ladder) {
  const L = ladder.filter((r) => Number.isFinite(r.strike) && Number.isFinite(r.mid)).sort((a, b) => a.strike - b.strike);
  if (L.length < 3) return null;
  let run = 1; const mono = L.map((r) => { run = Math.min(run, r.mid); return { strike: r.strike, p: run }; });
  if (mono[0].p < 0.5 || mono[mono.length - 1].p > 0.5) return null;
  for (let i = 0; i + 1 < mono.length; i++) {
    const a = mono[i], b = mono[i + 1];
    if (a.p >= 0.5 && b.p <= 0.5) return a.p === b.p ? (a.strike + b.strike) / 2 : a.strike + ((a.p - 0.5) / (a.p - b.p)) * (b.strike - a.strike);
  }
  return null;
}

/** Rung whose raw mid is closest to 0.5. */
export const nearestRung = (rungs) => rungs.reduce((best, r) => (best == null || Math.abs(r.mid - 0.5) < Math.abs(best.mid - 0.5) ? r : best), null);

/** Hourly series {time:[ 'YYYY-MM-DDTHH:00' ], vars:{name:[..]}}; window of nHours starting at the hour containing startMs (UTC). */
export function windowFeatures(hourly, startMs, nHours, names) {
  const t0 = Math.floor(startMs / 3600000) * 3600000;
  const idx = new Map(hourly.time.map((t, i) => [Date.parse(t + 'Z'), i]));
  const out = {};
  for (const [key, spec] of Object.entries(names)) {
    const vals = [];
    for (let h = 0; h < nHours; h++) { const i = idx.get(t0 + h * 3600000); const v = i == null ? null : hourly[spec.src][i]; if (v != null) vals.push(v); }
    if (vals.length < Math.max(1, nHours - 1)) { out[key] = null; continue; }
    out[key] = spec.agg === 'sum' ? vals.reduce((s, x) => s + x, 0) : vals.reduce((s, x) => s + x, 0) / vals.length;
  }
  return out;
}

/** Solve A x = b (small, Gauss-Jordan with partial pivoting). */
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const inv = (A) => { const n = A.length, cols = []; for (let j = 0; j < n; j++) { const e = Array(n).fill(0); e[j] = 1; const x = solve(A, e); if (!x) return null; cols.push(x); } return A.map((_, i) => cols.map((c) => c[i])); };

/**
 * OLS y ~ 1 + X with cluster-robust (CR1) covariance. rows: [{ y, x:[...], g }]. Returns { names?, b, se, t, n, G, r2 }.
 */
export function olsCluster(rows) {
  const n = rows.length, k = rows[0].x.length + 1;
  const X = rows.map((r) => [1, ...r.x]), y = rows.map((r) => r.y);
  const XtX = Array.from({ length: k }, () => Array(k).fill(0)), Xty = Array(k).fill(0);
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { Xty[a] += X[i][a] * y[i]; for (let c = 0; c < k; c++) XtX[a][c] += X[i][a] * X[i][c]; }
  const A = inv(XtX); if (!A) return null;
  const b = A.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const e = y.map((yi, i) => yi - X[i].reduce((s, v, j) => s + v * b[j], 0));
  const meat = Array.from({ length: k }, () => Array(k).fill(0)), groups = new Map();
  for (let i = 0; i < n; i++) { const s = groups.get(rows[i].g) ?? Array(k).fill(0); for (let a = 0; a < k; a++) s[a] += X[i][a] * e[i]; groups.set(rows[i].g, s); }
  for (const s of groups.values()) for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) meat[a][c] += s[a] * s[c];
  const G = groups.size, adj = G > 1 && n > k ? (G / (G - 1)) * ((n - 1) / (n - k)) : 1;
  const V = A.map((_, a) => A.map((__, c) => { let s = 0; for (let p = 0; p < k; p++) for (let q = 0; q < k; q++) s += A[a][p] * meat[p][q] * A[q][c]; return s * adj; }));
  const se = V.map((r, i) => Math.sqrt(Math.max(0, r[i])));
  const my = y.reduce((s, v) => s + v, 0) / n, sst = y.reduce((s, v) => s + (v - my) ** 2, 0), sse = e.reduce((s, v) => s + v * v, 0);
  return { b, se, t: b.map((v, i) => (se[i] ? v / se[i] : null)), n, G, r2: sst ? 1 - sse / sst : null };
}

/** Rule outcome for one game given the entry quote. side 'NO'|'YES'. Returns net P&L per contract. */
export function tradePnl({ side, yesBid, yesAsk, resolvedYes }) {
  const ask = side === 'NO' ? 1 - yesBid : yesAsk;
  if (!(ask > 0 && ask < 1)) return null;
  const win = side === 'NO' ? !resolvedYes : resolvedYes;
  return { ask, gross: (win ? 1 : 0) - ask, net: (win ? 1 : 0) - ask - feePerContract(ask) };
}

/** mean and SE of per-game values (one trade per game, so game-clustered SE = sd/sqrt(n)). */
export function meanSE(v) {
  const n = v.length; if (!n) return { n: 0, mean: null, se: null };
  const m = v.reduce((s, x) => s + x, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : null;
  return { n, mean: m, se: sd == null ? null : sd / Math.sqrt(n) };
}
