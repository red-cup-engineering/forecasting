#!/usr/bin/env node
// Live coherence scan (public data, shadow only). Usage:
//   node scripts/kalshi-coherence-scan.mjs [--no-depth] [--polymarket] [--cache file]
// Writes data/records/2026-10-04-kalshi-coherence/data/scan-<ts>.json and appends every post-fee Dutch book
// to data/records/2026-10-04-kalshi-coherence/data/shadow-log.ndjson (the would-take portfolio).
import { appendFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assessFamily } from '../src/coherence.mjs';
import { fetchUniverse, buildFamilies, redoWithDepth, riskFlags, signatureOf } from '../src/coherence-scan.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const dir = fileURLToPath(new URL('../data/records/2026-10-04-kalshi-coherence/data/', import.meta.url));
mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const ts = new Date().toISOString();

let universe;
const cache = opt('cache');
if (cache && existsSync(cache)) {
  const raw = JSON.parse(readFileSync(cache, 'utf8'));
  universe = { events: raw.events, series: new Map(raw.series) };
} else {
  universe = await fetchUniverse({ onPage: (p, n) => { if (p % 20 === 0) console.error(`page ${p} events ${n}`); } });
  if (cache) writeFileSync(cache, JSON.stringify({ events: universe.events, series: [...universe.series] }));
}
let extraByStationDay = new Map();
if (flag('polymarket')) extraByStationDay = await (await import('../src/coherence-polymarket.mjs')).polymarketExtras(universe);
const { families, skipped } = buildFamilies(universe, { extraByStationDay });
console.error(`families ${families.length} in ${Date.now() - t0}ms`);

const byKind = {};
const detections = [];
let tensions = 0;
let lpMs = 0;
for (const f of families) {
  const k = (byKind[f.kind] ??= { families: 0, markets: 0, glued: 0, tension: 0, dutchBook: 0, vanished: 0, postFee: 0, dollars: 0 });
  k.families += 1; k.markets += f.markets.length;
  const t1 = Date.now();
  let a = assessFamily(f);
  lpMs += Date.now() - t1;
  if (a.verdict === 'glued') { k.glued += 1; continue; }
  if (a.verdict === 'tension') { k.tension += 1; tensions += 1; continue; }
  if (a.verdict === 'unsolved') continue;
  k.dutchBook += 1;
  let depth = 'top-of-book';
  if (!flag('no-depth') && a.portfolioRaw) {
    const r = await redoWithDepth(f, a);
    a = r.assessed; depth = 'full-book';
    if (a.verdict !== 'dutch-book') k.vanished += 1;
  }
  const p = a.portfolio;
  const rec = { ts, family: f.id, kind: f.kind, margin: a.margin, unitProfitBeforeFees: a.unitProfitBeforeFees, depth, risks: riskFlags(f), venues: f.venues ?? ['kalshi'], portfolio: p };
  if (p) { k.postFee += 1; k.dollars += p.guaranteed; rec.sig = signatureOf(p); appendFileSync(`${dir}shadow-log.ndjson`, `${JSON.stringify({ type: 'detection', ...rec })}\n`); }
  detections.push(rec);
}
const summary = {
  ts, ms: Date.now() - t0, lpMs, events: universe.events.length, markets: universe.events.reduce((n, e) => n + e.markets.length, 0),
  families: families.length, skipped, byKind, tensions,
  postFeeDutchBooks: detections.filter((d) => d.portfolio).length,
  totalGuaranteed: detections.reduce((s, d) => s + (d.portfolio?.guaranteed ?? 0), 0),
  detections: detections.sort((a, b) => (b.portfolio?.guaranteed ?? 0) - (a.portfolio?.guaranteed ?? 0)),
};
writeFileSync(`${dir}scan-${ts.replace(/[:.]/g, '-')}.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ ...summary, detections: summary.detections.slice(0, 12).map((d) => ({ family: d.family, kind: d.kind, margin: d.margin, g: d.portfolio?.guaranteed, depth: d.depth })) }, null, 1));
