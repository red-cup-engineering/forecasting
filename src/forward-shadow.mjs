/**
 * Shared pure pieces of the forward shadow tests (claims C1, deep-terminal): Kalshi taker fee, delete-one-group
 * jackknife, t statistic, verdict, append-only JSONL, paced public GET. Shadow only: nothing here can place an order.
 */
import { orderFee as kalshiOrderFee } from '@red-cup-engineering/forecasting/fees';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
export const stateDir = (name, env = process.env) => env.FORWARD_SHADOW_DIR
  ? join(env.FORWARD_SHADOW_DIR, name)
  : join(env.HOME ?? homedir(), '.local', 'state', '561-group', 'settlements', 'forecasting-service', 'forward', name);

export const num = (x) => { if (x === undefined || x === null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

/**
 * The forward claims' registered taker fee for one order: ceil_to_cent(0.07 x multiplier x C x P x (1 - P)), as
 * pre-registered (content/hypotheses/claims-c1.json, fee.rounding "cent-per-order", commit d121ad0). The account
 * itself pays on the $0.0001 grid (fees.mjs), so the registered fee overstates its cost and a verdict on it is
 * conservative; changing it is a re-registration, not a fee fix.
 */
export const orderFee = (mult, p, count) => kalshiOrderFee(count, p, { multiplier: mult, gridCents: 1 });

/** Mean of x with delete-one-group jackknife SE; items [{g, x}]. */
export function jackknife(items) {
  const n = items.length;
  if (!n) return { n: 0, groups: 0, mean: NaN, se: NaN, t: NaN };
  const by = new Map(); let S = 0;
  for (const it of items) { const e = by.get(it.g) ?? { s: 0, n: 0 }; e.s += it.x; e.n += 1; by.set(it.g, e); S += it.x; }
  const mean = S / n; const G = by.size;
  if (G < 2) return { n, groups: G, mean, se: NaN, t: NaN };
  const reps = [...by.values()].map((e) => (S - e.s) / (n - e.n));
  const rbar = reps.reduce((a, b) => a + b, 0) / G;
  const se = Math.sqrt(((G - 1) / G) * reps.reduce((a, r) => a + (r - rbar) ** 2, 0));
  return { n, groups: G, mean, se, t: se > 0 ? mean / se : NaN };
}

/** Pre-registered verdict: at least `minGroups` groups, mean > 0 and t > 2. A zero-variance positive sample has t = Infinity. */
export function verdict(stats, minGroups) {
  if (stats.groups < minGroups) return `PENDING (${stats.groups}/${minGroups} ${minGroups === 12 ? 'events' : 'games'})`;
  const t = stats.se === 0 && stats.mean > 0 ? Infinity : stats.t;
  return stats.mean > 0 && t > 2 ? 'PASS' : 'FAIL';
}

export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
export function appendJsonl(file, rows) {
  mkdirSync(join(file, '..'), { recursive: true });
  if (rows.length) appendFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

/** Paced public GET (>= 400 ms between calls, 429 backoff, gives up after 3 consecutive 429s or network errors). */
let last = 0; let bad = 0;
export async function pacedGet(url, { paceMs = 450 } = {}) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const wait = last + paceMs - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    let res;
    try { res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); } catch { bad += 1; await new Promise((r) => setTimeout(r, 2000)); continue; }
    if (res.status === 429) { bad += 1; await new Promise((r) => setTimeout(r, 5000 + Math.random() * 5000)); continue; }
    if (res.status === 404) return null;
    if (!res.ok) { await new Promise((r) => setTimeout(r, 2000)); continue; }
    bad = 0; return res.json();
  }
  throw new Error(`GET failed: ${url}`);
}
