// Shadow read of the CURRENT market sections: energy, tension map, harmonic estimates for thin ladders.
// Reads open Kalshi temperature markets (public, read-only) + history from the fetch directory. No orders.
// usage: node scripts/kalshi-sheaf-live.mjs <historyDir> [outFile]
import fs from "node:fs";
import path from "node:path";
import { STATIONS, assemble, bracketProb, dayISO, edgeTemplates, eventDay, fitSheafMaps, loadEvents, neighbourPairs, snapshot, snapshotTimes } from "../src/kalshi-sheaf-market.mjs";
import { partiallyIdentifiedHarmonicExtension } from "../src/kalshi-sheaf.mjs";
import {marketSheafDirichlet as dirichlet,marketSheafVertexTension as vertexTension} from "../src/kalshi-sheaf-signgraph.mjs";

const here = path.dirname(new URL(import.meta.url).pathname);
const rec = path.join(here, "../data/records/2026-10-04-kalshi-sheaf");
const hist = path.resolve(process.argv[2] || path.join(rec, "data-long"));
const outFile = path.resolve(process.argv[3] || path.join(rec, "results", "live-shadow.md"));
const B = "https://api.elections.kalshi.com/trade-api/v2";
const UA = { accept: "application/json", "user-agent": "561-group research (ops@561.group)" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = fs.readdirSync(hist).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(hist, f))));
const events = loadEvents(files);
const now = Math.floor(Date.now() / 1000), num = (x) => (x == null ? null : Number(x));
// live (open) markets appended as single-quote candles
for (const f of files) {
  let cursor = "";
  for (;;) {
    await sleep(80);
    const q = new URLSearchParams({ series_ticker: f.series, status: "open", limit: "1000" }); if (cursor) q.set("cursor", cursor);
    const d = await (await fetch(`${B}/markets?${q}`, { headers: UA })).json();
    for (const m of d.markets || []) {
      const day = eventDay(m.event_ticker), kind = f.series.startsWith("KXHIGH") ? "H" : "L", key = `${f.station}.${kind}.${day}`;
      let e = events.get(key); if (!e) events.set(key, (e = { station: f.station, kind, day, value: null, markets: [] }));
      e.markets.push({ ticker: m.ticker, event: m.event_ticker, strike: m.strike_type, floor: m.floor_strike ?? null, cap: m.cap_strike ?? null, value: null, result: "", candles: [[now, num(m.yes_bid_dollars), num(m.yes_ask_dollars), num(m.last_price_dollars), num(m.volume_fp), num(m.open_interest_fp)]] });
    }
    cursor = d.cursor; if (!cursor || !(d.markets || []).length) break;
  }
}
const liveDays = [...new Set([...events.values()].filter((e) => e.value == null).map((e) => e.day))].sort();
const D = liveDays.at(-1);
const days = [...new Set([...events.values()].filter((e) => e.value != null).map((e) => e.day))].sort((a, b) => a - b);
const base = new Map();
{ // log-sigma base from all history lag-0 S2 ladders
  const acc = new Map();
  for (const d of days.filter((d) => d >= days[0] + 17)) for (const station of Object.keys(STATIONS)) for (const kind of ["H", "L"]) {
    const ev = events.get(`${station}.${kind}.${d}`); if (!ev) continue;
    const { ladderAt } = await import("../src/kalshi-sheaf-market.mjs");
    const l = ladderAt(ev, snapshotTimes.S2(d)); if (!l || l.sse > 0.02) continue;
    const a = acc.get(`${station}.${kind}`) ?? [0, 0]; a[0] += Math.log(l.sigma); a[1]++; acc.set(`${station}.${kind}`, a);
  }
  for (const [k, [s, n]] of acc) base.set(k, s / n);
}
const templates = edgeTemplates(neighbourPairs(3));
const train = days.filter((d) => d >= days[0] + 17).map((d) => ({ d, V: snapshot(events, d, "S2", base) }));
const { maps } = fitSheafMaps(train, templates);
const V = snapshot(events, D, now, base);
const lag0 = [...V.entries()].filter(([, z]) => z.lag === 0);
const thin = new Set();
for (const kind of ["H", "L"]) { const ks = lag0.filter(([, z]) => z.kind === kind).sort((a, b) => a[1].ladder.liq - b[1].ladder.liq); for (const [id] of ks.slice(0, Math.floor(ks.length / 3))) thin.add(id); }
const full = assemble(V, templates, maps, D, new Set());
const dir = dirichlet(full.sheaf, full.x0), tension = vertexTension(full.sheaf, full.x0);
const a = assemble(V, templates, maps, D, thin);
const inference = partiallyIdentifiedHarmonicExtension(a.sheaf, a.x0, a.free);
const xh = inference.values;
const L = [];
L.push(`# Live shadow read, target day ${dayISO(D)}, as of ${new Date(now * 1000).toISOString()}`, "");
L.push(`Graph: ${full.sheaf.vertices.length} vertices (${lag0.length} target-day ladders, ${[...V.values()].filter((z) => z.lag === 1).length} previous-day live ladders, ${[...V.values()].filter((z) => z.settled).length} settled), ${full.sheaf.edges.length} edges (fitted maps: ${maps.size} of ${templates.length} templates), stalk R^2, ${full.sheaf.n} coordinates.`);
L.push(`Global-section defect x^T L x = ${dir.energy.toFixed(1)}; per edge ${(dir.energy / full.sheaf.edges.length).toFixed(2)} (historical S2 daily per-edge mean: see energy-by-day.json).`, "");
L.push(`Identifiable harmonic coordinates: ${inference.identifiedFreeCount} / ${inference.freeCount} free; ${inference.withheldCoordinates.length} withheld, nullity ${inference.unresolvedNullity ?? 'unresolved'}. A disconnected or gauge-ambiguous component is NOT a prediction.`, "");
L.push("### Where tension concentrates (top edges)", "| edge | energy | residual (m, l) |", "|---|---|---|");
for (const e of dir.perEdge.slice().sort((x, y) => y.energy - x.energy).slice(0, 12)) L.push(`| ${e.id} | ${e.energy.toFixed(1)} | ${e.residual.map((v) => v.toFixed(2)).join(", ")} |`);
L.push("", "### Vertex tension (top 12)", "| ladder | tension | market mu | sigma |", "|---|---|---|---|");
for (const [id, t] of [...tension].sort((x, y) => y[1] - x[1]).slice(0, 12)) { const z = V.get(id); L.push(`| ${id} | ${t.toFixed(1)} | ${z.ladder ? z.ladder.mu.toFixed(1) : "settled " + (z.c + z.m).toFixed(0)} | ${z.ladder ? z.ladder.sigma.toFixed(2) : ""} |`); }
L.push("", `### Thin target-day ladders (${thin.size}): market vs harmonic (clamped: all liquid ladders, previous day, settled)`, "| ladder | cum vol | mu market | mu harmonic | sigma mkt | sigma harm | largest bracket residual (harm - mid) |", "|---|---|---|---|---|---|---|");
for (const id of thin) {
  const z = V.get(id), o = a.sheaf.offset.get(id);
  if(!inference.identified[o] || !inference.identified[o+1]) {
    L.push(`| ${id} | ${Math.round(z.ladder.liq)} | ${z.ladder.mu.toFixed(1)} | unidentified | ${z.ladder.sigma.toFixed(2)} | unidentified | withheld: insufficient independent sheaf constraints |`);
    continue;
  }
  const mu = z.c + xh[o], sg = Math.exp(xh[o + 1] + base.get(`${z.station}.${z.kind}`));
  let best = null; for (const b of z.ladder.brackets) { const r = bracketProb(mu, sg, b.lo, b.hi) - b.p; if (!best || Math.abs(r) > Math.abs(best.r)) best = { r, b }; }
  L.push(`| ${id} | ${Math.round(z.ladder.liq)} | ${z.ladder.mu.toFixed(1)} | ${mu.toFixed(1)} | ${z.ladder.sigma.toFixed(2)} | ${sg.toFixed(2)} | ${best.b.ticker} ${best.r.toFixed(3)} (mid ${best.b.p.toFixed(3)}) |`);
}
fs.writeFileSync(outFile, L.join("\n") + "\n");
console.log(L.join("\n"));
