// Spot-driven joint model for Kalshi 15-minute crypto "up" markets (KX<ASSET>15M).
// Pure functions only. YES iff mean(RTI over the 60 s before close) >= mean(RTI over the 60 s before open).
import { Phi, PhiInv, mvnLowerProb } from './combo-pricer.mjs';

export const WINDOW_MIN = 15;
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** UTC offset hours of America/New_York for a wall-clock time (US rule: 2nd Sun Mar 02:00 -> 1st Sun Nov 02:00). */
function nyOffsetHours(y, mo, d, h) {
  const nthSunday = (month, n) => { const first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); };
  const start = Date.UTC(y, 2, nthSunday(2, 2), 2); // wall-clock ms (treated as UTC) of DST start
  const end = Date.UTC(y, 10, nthSunday(10, 1), 2);
  const wall = Date.UTC(y, mo, d, h);
  return wall >= start && wall < end ? 4 : 5;
}

/**
 * KXBTC15M-26OCT040045-45 -> {asset:'BTC', openMs, closeMs}. The event suffix YYMONDDHHMM is the CLOSE in
 * New York local time (EDT = UTC-4 / EST = UTC-5); the trailing -MM must equal the close minute.
 */
export function windowOf(legTicker) {
  const m = /^KX([A-Z0-9]+?)15M-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})(?:-(\d{2}))?$/u.exec(legTicker ?? '');
  if (!m || !(m[3] in MON)) return null;
  const y = 2000 + +m[2]; const mo = MON[m[3]]; const d = +m[4]; const h = +m[5]; const mi = +m[6];
  if (m[7] !== undefined && +m[7] !== mi) return null;
  const closeMs = Date.UTC(y, mo, d, h + nyOffsetHours(y, mo, d, h), mi);
  return { asset: m[1], openMs: closeMs - WINDOW_MIN * 60000, closeMs };
}

/**
 * P(YES) under driftless (zero log-drift) log-normal diffusion.
 *   ref        known 60-s average at open (proxy: mean of the 1-min bar's OHLC)
 *   S_t        spot at the evaluation time; minutesLeft = minutes until the close instant
 *   tau_eff    variance horizon in minutes. Closing average A_c = (1/1min) * integral over the last minute, so
 *              Var(A_c - S_t) = sigma^2 (L - 1 + 1/3) = sigma^2 (L - 2/3)  when ref is already known (refKnown, in-window).
 *              Before the open BOTH averages are in the future: Var(A_c - A_o) = sigma^2 (14 + 1/3 + 1/3) = sigma^2 (L - 1/3)
 *              with L = 15 (this is the "minutesLeft - 1/3" case; call with S_t = ref, refKnown = false).
 *              Inside the final minute the unobserved part contributes ~ L^3/3. Floored at 1e-6 minutes.
 */
export function spotMarginal({ S_t, ref, sigmaPerMin, minutesLeft, refKnown = true }) {
  const L = Math.max(0, minutesLeft);
  const tau = L >= 1 ? L - (refKnown ? 2 / 3 : 1 / 3) : (L ** 3) / 3;
  const x = Math.log(S_t / ref);
  if (L === 0) return x >= 0 ? 1 : 0;
  const sd = sigmaPerMin * Math.sqrt(Math.max(tau, 1e-6));
  if (!(sd > 0)) return x >= 0 ? 1 : 0;
  return Phi(x / sd);
}

/** Mean of OHLC for a bar [t,o,h,l,c] (proxy for the 60-s average inside that minute). */
export const barMean = (b) => (b[1] + b[2] + b[3] + b[4]) / 4;

/**
 * 1-min log-return correlation and sigma from bars that CLOSED at or before endMs (bar start + 60 s <= endMs).
 * series: {asset: [[tMs,o,h,l,c], ...]} sorted. Returns {assets, rho (n x n), sigma: {asset}, n}.
 */
export function correlationFromReturns(series, endMs, lookbackMin = 1440) {
  const assets = Object.keys(series);
  const startMs = endMs - lookbackMin * 60000;
  const ret = {};
  for (const a of assets) {
    const m = new Map(); const bars = series[a];
    // binary search for last bar with t+60000 <= endMs
    let lo = 0; let hi = bars.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (bars[mid][0] + 60000 <= endMs) lo = mid + 1; else hi = mid; }
    for (let i = lo - 1; i >= 1; i -= 1) {
      const t = bars[i][0];
      if (t < startMs) break;
      if (bars[i - 1][0] === t - 60000) m.set(t, Math.log(bars[i][4] / bars[i - 1][4]));
    }
    ret[a] = m;
  }
  const n = assets.length;
  const rho = Array.from({ length: n }, () => new Array(n).fill(0));
  const sigma = {};
  const sum = (a, b) => { let sxy = 0; let sxx = 0; let syy = 0; let k = 0; for (const [t, x] of ret[a]) { const y = ret[b].get(t); if (y === undefined) continue; sxy += x * y; sxx += x * x; syy += y * y; k += 1; } return { sxy, sxx, syy, k }; };
  for (let i = 0; i < n; i += 1) {
    const s = sum(assets[i], assets[i]); sigma[assets[i]] = s.k > 1 ? Math.sqrt(s.sxx / s.k) : NaN; rho[i][i] = 1;
    for (let j = 0; j < i; j += 1) { const c = sum(assets[i], assets[j]); const r = c.sxx > 0 && c.syy > 0 ? c.sxy / Math.sqrt(c.sxx * c.syy) : 0; rho[i][j] = rho[j][i] = r; }
  }
  return { assets, rho, sigma, n: ret[assets[0]]?.size ?? 0 };
}

/**
 * P(every leg lands on its side) under a Gaussian copula with latent up-move correlation rho.
 * legs: [{asset, side:'yes'|'no'}]; marginals: P(YES) per leg (same order); rho: {assets, rho}.
 * A yes leg is {-Z_i <= b_i}, a no leg {+Z_i <= b_i} with b_i = PhiInv(P(leg on its side)), so the
 * reduced matrix has entries s_i s_j rho_ij with s = +1 (yes) / -1 (no), exactly as priceCombo.
 */
export function jointFair(legs, marginals, rho, { samples = 8000 } = {}) {
  const p = legs.map((l, i) => Math.min(1 - 1e-9, Math.max(1e-9, l.side === 'yes' ? marginals[i] : 1 - marginals[i])));
  if (legs.length === 1) return p[0];
  const idx = legs.map((l) => rho.assets.indexOf(l.asset));
  const s = legs.map((l) => (l.side === 'yes' ? 1 : -1));
  const R = legs.map((_, i) => legs.map((__, j) => (i === j ? 1 : s[i] * s[j] * (idx[i] >= 0 && idx[j] >= 0 ? rho.rho[idx[i]][idx[j]] : 0))));
  const b = p.map((x) => PhiInv(x));
  return mvnLowerProb(b, R, { samples }).p;
}
