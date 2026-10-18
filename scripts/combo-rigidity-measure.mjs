#!/usr/bin/env node
/**
 * Replay the combo shadow lane's tape through the rigidity pricer: for every executed combo print whose
 * legs were all booked at most --max-age seconds before it, the parlay's flex interval from the freshest
 * leg books (games pinned independent, and games free), where the print fell against it, and what it
 * paid at settlement.
 *
 *   node scripts/combo-rigidity-measure.mjs [--state <combo state dir>] [--max-age 900] [--out report.json]
 *
 * Books are read at executable prices: a bid net of the taker fee, an ask plus it (theta 0.07), so a
 * hedge certificate's value is what the hedge would cost to take.
 *
 * Books per game: a game holding one parlay leg is read from that leg's own event; a game holding two or
 * more is read from every score-line event of the game the lane snapshotted (winner, spread, total, team
 * total, BTTS), since those are what can pin or brace the cluster.
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { comboStateDir, legMeta } from '../src/combo-pricer.mjs';
import { parlayInterval, scoreRegion } from '../src/combo-rigidity.mjs';
import { KALSHI_THETA, unitFee } from '../src/coherence.mjs';
import { jsonlRows } from '../src/jsonl-file.mjs';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const dir = arg('state', comboStateDir());
const maxAge = Number(arg('max-age', 900)) * 1000;
const out = arg('out', null);
const rowsOut = arg('rows', null); // JSONL of every priced print, so a report can be re-tallied without a replay
const limit = Number(arg('limit', Infinity));

const lines = (file) => jsonlRows(join(dir, file)); // sealed (.jsonl.gz) and plain parts, one stream (src/jsonl-file.mjs)

const trades = [];
for await (const t of lines('trades.jsonl')) trades.push({ ticker: t.ticker, at: Date.parse(t.created_time), price: Number(t.yes_price_dollars), count: Number(t.count_fp), taker: t.taker_outcome_side });
trades.sort((a, b) => a.at - b.at);
const wanted = new Set(trades.map((t) => t.ticker));
const legsOf = new Map();
for await (const r of lines('rfqs.jsonl')) if (r.k === 'rfq' && wanted.has(r.ticker) && !legsOf.has(r.ticker)) legsOf.set(r.ticker, r.legs.map(([ticker, side]) => ({ ticker, side })));
const result = new Map();
for await (const r of lines('results.jsonl')) if (r.k === 'res') result.set(r.ticker, r.result);

const outcomeOf = (ticker, legs) => {
  const own = result.get(ticker); if (own === 'yes' || own === 'no') return own === 'yes' ? 1 : 0;
  let all = 1;
  for (const l of legs) { const r = result.get(l.ticker); if (r !== 'yes' && r !== 'no') return null; if (r !== l.side) all = 0; }
  return all;
};

const latest = new Map(); // event ticker -> {t, markets}
const byGame = new Map(); // game code -> Set(event tickers)
const rows = []; const skipped = { noLegs: 0, stale: 0, error: 0 };
const cache = new Map();
const incoherent = [];

function priceTrade(tr) {
  const legs = legsOf.get(tr.ticker);
  if (!legs) { skipped.noLegs += 1; return; }
  const metas = legs.map((l) => legMeta(l.ticker));
  const perGame = new Map();
  metas.forEach((m, i) => (perGame.get(m.game) ?? perGame.set(m.game, []).get(m.game)).push(i));
  const booksByGame = new Map(); let age = 0; let version = '';
  for (const [game, idx] of perGame) {
    const events = idx.length > 1 ? [...(byGame.get(game) ?? [])].filter((e) => { const s = latest.get(e); return s && s.markets.some((m) => scoreRegion(legMeta(m.ticker, e))); }) : [];
    for (const i of idx) if (!events.includes(metas[i].event)) events.push(metas[i].event);
    const books = [];
    for (const e of events) {
      const s = latest.get(e);
      if (!s || tr.at - s.t > maxAge) { if (idx.some((i) => metas[i].event === e)) { skipped.stale += 1; return; } continue; }
      age = Math.max(age, tr.at - s.t); version += `${e}@${s.t};`;
      for (const m of s.markets) books.push({ ticker: m.ticker, event: e, bid: m.bid > 0 ? m.bid - unitFee(KALSHI_THETA, m.bid) : null, ask: m.ask > 0 && m.ask < 1 ? m.ask + unitFee(KALSHI_THETA, m.ask) : null });
    }
    booksByGame.set(game, books);
  }
  const key = `${legs.map((l) => `${l.ticker}:${l.side}`).sort().join(',')}|${version}`;
  let iv = cache.get(key);
  if (!iv) {
    let full;
    try { full = parlayInterval(legs, booksByGame); } catch (e) { skipped.error += 1; return; }
    iv = full;
    if (!full.coherent && incoherent.length < 25) incoherent.push({ legs, parts: full.parts.filter((p) => !p.coherent).map((p) => ({ game: p.game, books: booksByGame.get(p.game) })) });
    iv = { coherent: iv.coherent, games: iv.games, pinned: iv.pinned, free: iv.free, cluster: iv.parts.some((p) => p.modelled + p.free > 1), maxCells: Math.max(...iv.parts.map((p) => p.nCells ?? 0)), unpinnedCluster: iv.parts.some((p) => p.modelled > 1 && p.rigidity && !p.rigidity.targetPinned) };
    cache.set(key, iv);
  }
  rows.push({ ticker: tr.ticker, at: tr.at, price: tr.price, count: tr.count, taker: tr.taker, legs: legs.length, ageS: age / 1000, ...iv, gameCodes: [...perGame.keys()], outcome: outcomeOf(tr.ticker, legs) });
}

let ti = 0;
for await (const s of lines('legs.jsonl')) {
  while (ti < trades.length && trades[ti].at < s.t) priceTrade(trades[ti++]);
  if (ti >= limit) break;
  latest.set(s.event, { t: s.t, markets: s.markets });
  const game = legMeta(s.markets[0]?.ticker ?? `${s.event}-X`, s.event).game;
  (byGame.get(game) ?? byGame.set(game, new Set()).get(game)).add(s.event);
}
while (ti < Math.min(trades.length, limit)) priceTrade(trades[ti++]);

if (rowsOut) writeFileSync(rowsOut, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

// ---------------------------------------------------------------- report
const zone = (r, [lo, hi]) => (!r.coherent ? 'incoherent legs' : r.price > hi + 1e-9 ? 'above' : r.price < lo - 1e-9 ? 'below' : 'inside');
/** Maker P&L per contract: the maker took the side opposite the taker. */
const makerPnl = (r) => (r.taker === 'yes' ? r.price - r.outcome : r.outcome - r.price);
/**
 * Mean maker P&L per contract, with a delete-a-game jackknife standard error: parlays sharing a game
 * share its outcome, so prints are not independent trials; dropping every print that touches one game
 * at a time measures the spread the shared outcomes actually produce.
 */
function tally(subset) {
  const settled = subset.filter((r) => r.outcome !== null);
  const n = settled.length; const sum = settled.reduce((a, r) => a + makerPnl(r), 0); const mean = n ? sum / n : null;
  const byGame = new Map();
  for (const r of settled) for (const g of r.gameCodes) { const e = byGame.get(g) ?? byGame.set(g, { n: 0, s: 0 }).get(g); e.n += 1; e.s += makerPnl(r); }
  const G = byGame.size;
  const loo = [...byGame.values()].filter((e) => e.n < n).map((e) => (sum - e.s) / (n - e.n));
  const lm = loo.reduce((a, b) => a + b, 0) / (loo.length || 1);
  const se = loo.length > 1 ? Math.sqrt(((G - 1) / G) * loo.reduce((a, b) => a + (b - lm) ** 2, 0)) : null;
  return { prints: subset.length, settled: n, games: G, takerYes: subset.filter((r) => r.taker === 'yes').length, makerPnlPerContract: mean, seJackknifeByGame: se };
}
const report = { stateDir: dir, maxAgeS: maxAge / 1000, priced: rows.length, skipped, hinge: {} };
for (const hinge of ['pinned', 'free']) {
  const zones = {};
  for (const r of rows) (zones[zone(r, r[hinge])] ??= []).push(r);
  report.hinge[hinge] = Object.fromEntries(Object.entries(zones).map(([z, rs]) => [z, tally(rs)]));
}
const clustered = rows.filter((r) => r.cluster && r.coherent);
const widths = clustered.map((r) => r.pinned[1] - r.pinned[0]).sort((a, b) => a - b);
const cut = [widths[Math.floor(widths.length / 3)], widths[Math.floor((2 * widths.length) / 3)]];
report.sameGame = {
  prints: clustered.length,
  widthTerciles: cut,
  byWidth: Object.fromEntries([['narrow', (w) => w <= cut[0]], ['middle', (w) => w > cut[0] && w <= cut[1]], ['wide', (w) => w > cut[1]]].map(([k, f]) => [k, tally(clustered.filter((r) => f(r.pinned[1] - r.pinned[0])))])),
  unpinnedClusterShare: clustered.filter((r) => r.unpinnedCluster).length / (clustered.length || 1),
};
const above = rows.filter((r) => r.coherent && r.price > r.pinned[1] + 1e-9);
report.aboveSuperHedge = { prints: above.length, medianExcess: above.map((r) => r.price - r.pinned[1]).sort((a, b) => a - b)[Math.floor(above.length / 2)] ?? null, contracts: above.reduce((s, r) => s + r.count, 0) };
report.sample = rows.filter((r) => r.cluster).slice(0, 20);
report.incoherentSample = incoherent;
console.log(JSON.stringify({ ...report, sample: undefined }, null, 2));
if (out) writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
