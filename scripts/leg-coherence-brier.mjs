#!/usr/bin/env node
/**
 * How much Brier the coherence projection takes off Kalshi's own game-line mids, replayed from the combo
 * lane's leg snapshots. At every hour boundary, each game's freshest score-line books (winner, spread,
 * total, team total, BTTS; two-sided, snapped at most --max-age seconds earlier) are one family; its mids
 * are projected onto the coherent set (`brierProjection`) and both are scored on the markets that settled.
 * The projection's improvement is guaranteed outcome by outcome; this measures its size.
 *
 *   node scripts/leg-coherence-brier.mjs [--state <combo state dir>] [--max-age 900] [--limit-slices N] [--out report.json]
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { comboStateDir, legMeta } from '../src/combo-pricer.mjs';
import { brierProjection, scoreCells, scoreRegion } from '../src/combo-rigidity.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const dir = arg('state', comboStateDir());
const maxAge = Number(arg('max-age', 900)) * 1000;
const limitSlices = Number(arg('limit-slices', Infinity));
const out = arg('out', null);
const NO_DRAW = new Set(['NBA', 'WNBA', 'NCAAB', 'MLB', 'NHL']);
const lines = async function* (file) { for await (const l of createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity })) if (l) yield JSON.parse(l); };

const result = new Map();
for await (const r of lines('results.jsonl')) if (r.k === 'res' && (r.result === 'yes' || r.result === 'no')) result.set(r.ticker, r.result === 'yes' ? 1 : 0);

const latest = new Map(); // event -> {t, markets}
const gameEvents = new Map(); // game -> Set(event)
const slices = []; let hour = null;

function evaluate(at) {
  for (const [game, events] of gameEvents) {
    if (slices.length >= limitSlices) return;
    const quoted = [];
    for (const e of events) {
      const s = latest.get(e); if (!s || at - s.t > maxAge) continue;
      for (const m of s.markets) {
        if (!(m.bid > 0 && m.ask > 0 && m.ask < 1)) continue;
        const meta = legMeta(m.ticker, e); const region = scoreRegion(meta);
        if (region) quoted.push({ ticker: m.ticker, sport: meta.sport, region, mid: (m.bid + m.ask) / 2, outcome: result.get(m.ticker) });
      }
    }
    if (quoted.length < 2 || !quoted.some((q) => q.outcome !== undefined)) continue;
    const { cells, member } = scoreCells(quoted.map((q) => q.region), { noDraw: NO_DRAW.has(quoted[0].sport) });
    const p = brierProjection(cells.length, member, quoted.map((q) => q.mid), {});
    const scored = quoted.map((q, i) => ({ ...q, proj: p.prices[i], i })).filter((q) => q.outcome !== undefined);
    const brier = (f) => scored.reduce((s, q) => s + (q[f] - q.outcome) ** 2, 0);
    // is the settled outcome a world of the lattice? if no cell agrees with every settled market, the
    // regions misread the settlement rules and the dominance theorem does not apply to that slice
    const world = cells.findIndex((_, k) => scored.every((q) => member[q.i].includes(k) === (q.outcome === 1)));
    const misread = world < 0 ? scored.map((q) => `${q.ticker}=${q.outcome}`) : null;
    slices.push({ game, at, sport: quoted[0].sport, markets: quoted.length, scored: scored.length, complete: scored.length === quoted.length, world: world >= 0, misread, cells: cells.length, distance2: p.distance2, mid: brier('mid'), proj: brier('proj') });
  }
}

for await (const s of lines('legs.jsonl')) {
  const h = Math.floor(s.t / 3600e3);
  if (hour !== null && h > hour) evaluate(h * 3600e3);
  hour = h;
  if (slices.length >= limitSlices) break;
  latest.set(s.event, { t: s.t, markets: s.markets });
  const game = legMeta(s.markets[0]?.ticker ?? `${s.event}-X`, s.event).game;
  (gameEvents.get(game) ?? gameEvents.set(game, new Set()).get(game)).add(s.event);
}

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0);
const incoherent = slices.filter((s) => s.distance2 > 1e-6);
const bySport = {};
for (const s of slices) { const b = (bySport[s.sport] ??= { slices: 0, incoherent: 0, scored: 0, mid: 0, proj: 0 }); b.slices += 1; b.incoherent += s.distance2 > 1e-6 ? 1 : 0; b.scored += s.scored; b.mid += s.mid; b.proj += s.proj; }
const report = {
  slices: slices.length,
  games: new Set(slices.map((s) => s.game)).size,
  scoredForecasts: sum(slices, (s) => s.scored),
  incoherentSlices: incoherent.length,
  meanBrierMid: sum(slices, (s) => s.mid) / sum(slices, (s) => s.scored),
  meanBrierProjected: sum(slices, (s) => s.proj) / sum(slices, (s) => s.scored),
  worseSlices: slices.filter((s) => s.proj > s.mid + 1e-6).length,
  worseCompleteWorldSlices: slices.filter((s) => s.complete && s.world && s.proj > s.mid - s.distance2 + 1e-6).length,
  noWorldSlices: slices.filter((s) => !s.world).length,
  misreadSample: slices.filter((s) => !s.world).slice(0, 8).map((s) => ({ game: s.game, sport: s.sport, misread: s.misread })),
  bySport: Object.fromEntries(Object.entries(bySport).map(([k, b]) => [k, { ...b, meanMid: b.mid / b.scored, meanProj: b.proj / b.scored }])),
  largest: [...slices].sort((a, b) => (b.mid - b.proj) - (a.mid - a.proj)).slice(0, 10),
};
console.log(JSON.stringify(report, null, 2));
if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
