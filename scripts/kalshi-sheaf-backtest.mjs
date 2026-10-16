// Point-in-time backtest of the sheaf-harmonic estimator for thin ladders.
// usage: node scripts/kalshi-sheaf-backtest.mjs <dataDir> <splitISO> [outDir]
// Reads fetched settled markets (kalshi-sheaf-fetch.mjs). Research only: no orders are placed.
import fs from "node:fs";
import path from "node:path";
import {
  STATIONS, assemble, bracketProb, dayISO, edgeTemplates, fitSheafMaps, ladderAt, loadEvents, neighbourPairs, snapshot, snapshotTimes, vid,
} from "../src/kalshi-sheaf-market.mjs";
import { partiallyIdentifiedHarmonicExtension, jacobiEigen } from "@red-cup-engineering/forecasting/kalshi-sheaf";
import {marketSheafDirichlet as dirichlet,marketSheafVertexTension as vertexTension} from "@red-cup-engineering/forecasting/kalshi-sheaf-signgraph";

const here = path.dirname(new URL(import.meta.url).pathname);
const rec = path.join(here, "../data/records/2026-10-04-kalshi-sheaf");
const dataDir = path.resolve(process.argv[2] || path.join(rec, "data"));
const split = Date.parse(process.argv[3] || "2026-09-08") / 86400000;
const outDir = path.resolve(process.argv[4] || path.join(rec, "results"));
fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, f))));
const events = loadEvents(files);
const days = [...new Set([...events.values()].map((e) => e.day))].sort((a, b) => a - b);
console.error("events", events.size, "days", dayISO(days[0]), dayISO(days.at(-1)), "split", dayISO(split));
const targets = days.filter((d) => d >= days[0] + 17 && d < days.at(-1) + 1);
const trainDays = targets.filter((d) => d < split), testDays = targets.filter((d) => d >= split);

// base log-sigma per station-kind from TRAIN days' lag-0 ladders only
const base = new Map();
{
  const acc = new Map();
  for (const d of trainDays) for (const station of Object.keys(STATIONS)) for (const kind of ["H", "L"]) {
    const ev = events.get(`${station}.${kind}.${d}`); if (!ev) continue;
    const l = ladderAt(ev, snapshotTimes.S1(d)); if (!l || l.sse > 0.02) continue;
    const a = acc.get(`${station}.${kind}`) ?? [0, 0]; a[0] += Math.log(l.sigma); a[1]++; acc.set(`${station}.${kind}`, a);
  }
  for (const [k, [s, n]] of acc) base.set(k, s / n);
}
const templates = edgeTemplates(neighbourPairs(3));
const fee10 = (p) => Math.ceil(0.07 * 10 * p * (1 - p) * 100 - 1e-9) / 100 / 10;
const rows = [], energyRows = [], edgeClassEnergy = [];
const inferenceCoverage = [];
let spectrumNote = null, sampleTension = null;

for (const S of ["S1", "S2"]) {
  const snaps = targets.map((d) => ({ d, V: snapshot(events, d, S, base) }));
  const train = snaps.filter((s) => s.d < split);
  const { maps, classFit } = fitSheafMaps(train, templates);
  console.error(S, "edges fitted", maps.size, "classes", [...classFit.keys()].join(","));
  fs.writeFileSync(path.join(outDir, `restriction-maps-${S}.json`), JSON.stringify({ classes: Object.fromEntries([...classFit].map(([k, v]) => [k, { B: v.Fu, cov: v.cov, n: v.n }])), edges: Object.fromEntries([...maps].map(([k, v]) => [k, { B: v.Fu, cov: v.cov, n: v.n }])) }));
  for (const { d, V } of snaps) {
    const split_ = d < split ? "train" : "test";
    const lag0 = [...V.entries()].filter(([, z]) => z.lag === 0);
    if (lag0.length < 20) continue;
    // global-section defect of the observed sections
    const full = assemble(V, templates, maps, d, new Set());
    const dir = dirichlet(full.sheaf, full.x0);
    energyRows.push({ S, day: dayISO(d), split: split_, vertices: V.size, edges: full.sheaf.edges.length, energy: dir.energy, perEdgeMean: dir.energy / full.sheaf.edges.length });
    const byCls = {};
    for (const e of dir.perEdge) { const c = full.sheaf.edges.find((x) => x.id === e.id).cls; (byCls[c] ??= [0, 0]); byCls[c][0] += e.energy; byCls[c][1]++; }
    edgeClassEnergy.push({ S, day: dayISO(d), split: split_, ...Object.fromEntries(Object.entries(byCls).map(([c, [s, n]]) => [c, s / n])) });
    // thin set per kind: bottom tercile of lag-0 ladders by cumulative volume
    const thin = new Set();
    for (const kind of ["H", "L"]) {
      const ks = lag0.filter(([, z]) => z.kind === kind).sort((a, b) => a[1].ladder.liq - b[1].ladder.liq);
      for (const [id] of ks.slice(0, Math.floor(ks.length / 3))) thin.add(id);
    }
    const solve = (freeIds) => {
      const a = assemble(V, templates, maps, d, freeIds);
      return { a, inference: partiallyIdentifiedHarmonicExtension(a.sheaf, a.x0, a.free) };
    };
    const modes = [["thin", solve(thin)]];
    // leave-one-out: each lag-0 ladder alone is inferred from everything else
    for (const [id] of lag0) modes.push([`loo`, solve(new Set([id])), id]);
    for (const [mode, { a, inference }, only] of modes) {
      const targetsIds = mode === "thin" ? thin : new Set([only]);
      let withheld = 0, available = 0;
      const xh = inference.values;
      for (const id of targetsIds) {
        const z = V.get(id), o = a.sheaf.offset.get(id);
        // A weakly connected but gauge-ambiguous stalk is still NOT an
        // identified market estimate. Retain identifiable other components.
        if (!inference.identified[o] || !inference.identified[o + 1]) {
          withheld++;
          continue;
        }
        const deg = a.sheaf.edges.filter((e) => e.u === id || e.v === id).length;
        if (!deg) { withheld++; continue; }
        available++;
        const mu = z.c + xh[o], sg = Math.exp(xh[o + 1] + base.get(`${z.station}.${z.kind}`));
        for (const b of z.ladder.brackets) {
          const outcome = b.result === "yes" ? 1 : 0;
          rows.push({
            S, day: dayISO(d), split: split_, mode, id, station: z.station, kind: z.kind, liq: Math.round(z.ladder.liq), ticker: b.ticker,
            val: z.ev.value, clim: z.c, lo: b.lo, hi: b.hi, bid: b.bid, ask: b.ask, mid: b.p, recent: Math.round(b.recent), y: outcome,
            pA: bracketProb(mu, sg, b.lo, b.hi), pB: bracketProb(mu, z.ladder.sigma, b.lo, b.hi), muH: mu, muM: z.ladder.mu, sgH: sg, sgM: z.ladder.sigma, deg,
            pM: bracketProb(z.ladder.mu, z.ladder.sigma, b.lo, b.hi),
          });
        }
      }
      inferenceCoverage.push({S, day:dayISO(d), split:split_, mode, target:only ?? null,
        available,withheld,freeCount:inference.freeCount,
        identifiedFreeCount:inference.identifiedFreeCount,
        unresolvedNullity:inference.unresolvedNullity});
    }
    if (S === "S1" && !sampleTension && d === targets.at(-1)) {
      const t = vertexTension(full.sheaf, full.x0), de = dir.perEdge.slice().sort((x, y) => y.energy - x.energy);
      sampleTension = { day: dayISO(d), energy: dir.energy, topEdges: de.slice(0, 15).map((e) => ({ id: e.id, energy: +e.energy.toFixed(3) })), topVertices: [...t].sort((x, y) => y[1] - x[1]).slice(0, 15).map(([id, v]) => ({ id, tension: +v.toFixed(3) })) };
      // spectrum on the observable coordinates only (settled vertices carry no log-scale datum)
      const keep = full.free.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
      const Lr = keep.map((i) => keep.map((j) => full.sheaf.L[i][j])), xr = keep.map((i) => full.x0[i]);
      const sp = jacobiEigen(Lr);
      spectrumNote = { day: dayISO(d), n: keep.length, lowestNonzero: sp.values.filter((v) => v > 1e-7).slice(0, 10).map((v) => +v.toFixed(4)), highest: sp.values.slice(-3).map((v) => +v.toFixed(2)), kernelDim: sp.values.filter((v) => Math.abs(v) < 1e-7).length, isolatedCoordinates: Lr.filter((r, i) => r.every((x, j) => Math.abs(x) < 1e-12)).length };
      // energy carried by the lowest eigenmodes of L: soft ("tension") directions are cheap to excite, so energy there is the persistent, non-local part of the defect
      const nz = sp.values.map((v, i) => i).filter((i) => sp.values[i] > 1e-7); const proj = nz.slice(0, 12).map((i) => sp.vectors[i]).map((ev, i) => { const c = ev.reduce((s, e, j) => s + e * xr[j], 0); return +(c * c * sp.values[nz[i]]).toFixed(3); });
      const totalE = xr.reduce((s, xi, i) => s + xi * Lr[i].reduce((t, l, j) => t + l * xr[j], 0), 0);
      spectrumNote.totalEnergyObservable = +totalE.toFixed(2);
      spectrumNote.energyInLowest12Nonzero = +proj.reduce((a, b) => a + b, 0).toFixed(2);
    }
  }
}
const cols = Object.keys(rows[0]);
fs.writeFileSync(path.join(outDir, "signals.csv"), [cols.join(","), ...rows.map((r) => cols.map((c) => (typeof r[c] === "number" ? +r[c].toFixed(5) : r[c])).join(","))].join("\n"));
fs.writeFileSync(path.join(outDir, "energy-by-day.json"), JSON.stringify({ energyRows, edgeClassEnergy, inferenceCoverage, sampleTension, spectrumNote }, null, 1));
console.error("rows", rows.length, "->", outDir);
