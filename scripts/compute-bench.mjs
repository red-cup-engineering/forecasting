#!/usr/bin/env node
// Throughput per backend per kernel per batch size, then one end-to-end: re-price N parlays (K1)
// single-threaded (the house reference, mvnLowerProb) versus the planner's placement.
//   node scripts/compute-bench.mjs [--parlays 20000] [--recalibrate] [--skip-throughput] [--skip-e2e] [--json]
// Run one at a time: it is a heavy benchmark. Windows-side backends need COMPUTE_WINDOWS_DIR / COMPUTE_WEBGPU_DIR
// (see src/compute/README.md); absent backends are reported as unavailable with their reason.
import { KERNELS } from '../src/compute/kernels.mjs';
import { createPlanner } from '../src/compute/planner.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? dflt : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]); };
const parlays = Number(arg('parlays', 20000));
const SIZES = { 'mvn-orthant': [64, 512, 4096], 'brier-grad': [64, 1024, 16384] };
const out = { measuredAt: new Date().toISOString(), throughput: [], e2e: null };
const planner = createPlanner();
await planner.calibrate({ force: Boolean(arg('recalibrate', false)) });
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '-');

if (!arg('skip-throughput', false)) {
  for (const kernelId of Object.keys(KERNELS)) {
    const k = KERNELS[kernelId];
    console.log(`\n${kernelId}  (items/s; ms per call; max abs error vs the float64 reference)`);
    console.log('backend'.padEnd(16), 'prec'.padEnd(5), 'size'.padStart(7), 'ms'.padStart(10), 'items/s'.padStart(12), 'error'.padStart(10));
    for (const size of SIZES[kernelId]) {
      const batch = k.make(size, { seed: 4242 });
      let ref = null; // the pool is bit-identical to the reference; reuse it instead of paying single-thread time
      for (const id of ['cpu-pool', ...[...planner.backends.keys()].filter((x) => x !== 'cpu-pool')]) {
        const b = planner.backends.get(id); const e = planner.table()[`${kernelId}/${id}`];
        if (!e?.available) { if (size === SIZES[kernelId][0]) console.log(id.padEnd(16), '-'.padEnd(5), 'unavailable:', e?.reason ?? 'not calibrated'); continue; }
        if (id === 'cpu-inline' && size > SIZES[kernelId][1] && kernelId === 'mvn-orthant') { console.log(id.padEnd(16), b.precision.padEnd(5), String(size).padStart(7), '(skipped: single-thread, see e2e)'); continue; }
        let best = Infinity; let res;
        for (let i = 0; i < (size >= 4096 ? 1 : 3); i += 1) { const t = performance.now(); res = await b.run(kernelId, batch); best = Math.min(best, performance.now() - t); }
        if (id === 'cpu-pool') ref = res;
        const err = ref ? k.error(res, ref) : NaN;
        out.throughput.push({ kernel: kernelId, backend: id, precision: b.precision, size, ms: best, itemsPerSec: size / (best / 1000), error: err });
        console.log(id.padEnd(16), b.precision.padEnd(5), String(size).padStart(7), fmt(best).padStart(10), fmt(size / (best / 1000), 0).padStart(12), (Number.isFinite(err) ? err.toExponential(1) : '-').padStart(10));
      }
    }
  }
}

if (!arg('skip-e2e', false)) {
  console.log(`\nEnd to end: re-price ${parlays} parlays (K1, dimension 2..9, 4000 samples each)`);
  const batch = KERNELS['mvn-orthant'].make(parlays, { seed: 20261007 });
  const decision = planner.place('mvn-orthant', batch);
  console.log('placement:', decision.backend, '-', decision.reason);
  for (const c of decision.considered) console.log('  ', c.id.padEnd(16), c.ok ? `~${fmt(c.ms, 0)} ms` : '-', c.why);
  const t0 = performance.now(); const ref = KERNELS['mvn-orthant'].reference(batch); const single = performance.now() - t0;
  const { result, elapsedMs, decision: used } = await planner.run('mvn-orthant', batch);
  const err = KERNELS['mvn-orthant'].error(result, ref);
  out.e2e = { parlays, singleThreadMs: single, plannerMs: elapsedMs, backend: used.backend, speedup: single / elapsedMs, maxAbsError: err, reason: used.reason };
  console.log(`single-thread reference: ${fmt(single / 1000, 2)} s (${fmt(parlays / (single / 1000), 0)} parlays/s)`);
  console.log(`planner on ${used.backend}: ${fmt(elapsedMs / 1000, 2)} s (${fmt(parlays / (elapsedMs / 1000), 0)} parlays/s), speedup x${fmt(single / elapsedMs, 1)}, max abs error ${err.toExponential(1)}`);
  // the same work on each remaining CPU alternative, so the table shows what the planner chose between
  for (const id of ['cpu-pool']) { const t = performance.now(); await planner.backends.get(id).run('mvn-orthant', batch); const d = performance.now() - t; out.e2e[`${id}Ms`] = d; console.log(`${id}: ${fmt(d / 1000, 2)} s, speedup x${fmt(single / d, 1)}`); }
}

if (arg('json', false)) console.log(JSON.stringify(out));
await planner.close();
process.exit(0);
