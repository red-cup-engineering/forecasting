/**
 * Mulberry32, a small deterministic pseudo-random generator (Tommy Ettinger 2017), so a derived table is reproducible from its inputs.
 * The constants are the algorithm's; this file is the one place they live.
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
