#!/usr/bin/env node
// Grade the shadow log at settlement: per distinct would-take portfolio (by signature), realized P&L from the
// markets' results vs guaranteed profit, with persistence (scans seen, first/last seen).
import { binarySettlement } from '../../../src/market-facts.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BASE } from '../src/coherence-scan.mjs';

const dir = fileURLToPath(new URL('../data/records/2026-10-04-kalshi-coherence/data/', import.meta.url));
const logPath = `${dir}shadow-log.ndjson`;
if (!existsSync(logPath)) { console.log('no shadow log'); process.exit(0); }
const rows = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'detection');
const bySig = new Map();
for (const r of rows) {
  const g = bySig.get(r.sig) ?? { sig: r.sig, family: r.family, kind: r.kind, risks: r.risks, first: r, scans: new Set(), lastTs: r.ts };
  g.scans.add(r.ts); g.lastTs = r.ts; bySig.set(r.sig, g);
}
const cache = new Map();
async function result(ticker) {
  if (cache.has(ticker)) return cache.get(ticker);
  const r = await fetch(`${BASE}/markets/${ticker}`, { headers: { accept: 'application/json' } });
  const v = r.ok ? (await r.json()).market : null;
  cache.set(ticker, v);
  await new Promise((s) => setTimeout(s, 80));
  return v;
}
const graded = [];
for (const g of bySig.values()) {
  const p = g.first.portfolio;
  let pnl = -p.fees; let settled = true; let gradable = true;
  for (const l of p.legs) {
    if (l.venue !== 'kalshi') { gradable = false; continue; }
    const m = await result(l.ticker);
    if (!binarySettlement(m) || Number(m.notional_value_dollars)!==1) { settled = false; continue; }
    const win = l.side === 'yes' ? m.result === 'yes' : m.result === 'no';
    pnl += l.qty * ((win ? 1 : 0) - l.price);
  }
  graded.push({
    sig: g.sig, family: g.family, kind: g.kind, risks: g.risks, firstSeen: g.first.ts, lastSeen: g.lastTs, scansSeen: g.scans.size,
    guaranteed: p.guaranteed, cost: p.cost, fees: p.fees, status: !gradable ? 'ungradable-venue' : settled ? 'settled' : 'pending',
    realizedPnl: settled && gradable ? Number(pnl.toFixed(2)) : null, shortfall: settled && gradable ? Number((pnl - p.guaranteed).toFixed(2)) : null,
  });
}
writeFileSync(`${dir}graded.json`, JSON.stringify(graded, null, 1));
const done = graded.filter((g) => g.status === 'settled');
console.log(JSON.stringify({ portfolios: graded.length, settled: done.length, pending: graded.filter((g) => g.status === 'pending').length, guaranteedSum: done.reduce((s, g) => s + g.guaranteed, 0), realizedSum: done.reduce((s, g) => s + g.realizedPnl, 0), breaches: done.filter((g) => g.shortfall < -0.01).length }, null, 1));
