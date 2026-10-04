#!/usr/bin/env node
// Model-free check: is the market quote itself miscalibrated by price band, in both time halves?
// Buys NO at its ask (1 - yes bid) for bands of the yes mid at T-1h; EV per contract after taker fee.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { quoteAt, tradeOutcome, clusterBootstrap } from '../src/earnings-mentions.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const cache = opt('cache', '/tmp/claude-1000/-home-emsenn-info/ff528934-809b-45da-8279-b7a50087597e/scratchpad/cache');
const rows = [];
for (const m of JSON.parse(readFileSync(join(cache, 'catalog.json'), 'utf8'))) {
  const p = join(cache, 'candles', `${m.ticker}.json`);
  if (!m.callStart || !existsSync(p) || !['yes', 'no'].includes(m.result)) continue;
  const q = quoteAt(JSON.parse(readFileSync(p, 'utf8')), m.callStart - 3600e3);
  if (q) rows.push({ event: m.event, callStart: m.callStart, y: m.result === 'yes' ? 1 : 0, q });
}
rows.sort((a, b) => a.callStart - b.callStart);
const evs = [...new Set(rows.map((r) => r.event))]; const half = new Set(evs.slice(evs.length >> 1));
const bands = [[0.02, 0.15], [0.15, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 0.99]];
const out = [];
for (const [lo, hi] of bands) for (const part of ['fit', 'test']) {
  const rs = rows.filter((r) => r.q.mid >= lo && r.q.mid < hi && half.has(r.event) === (part === 'test'));
  const yes = rs.map((r) => ({ ...r, t: tradeOutcome({ p: 1, bid: r.q.bid, ask: r.q.ask, yes: r.y }, -1) }));
  const no = rs.map((r) => ({ ...r, t: tradeOutcome({ p: 0, bid: r.q.bid, ask: r.q.ask, yes: r.y }, -1) })).filter((r) => r.t && r.t.side === 'no');
  const b = no.length ? clusterBootstrap(no, (r) => r.event, (r) => r.t.pnl, { draws: 1000 }) : null;
  out.push({ band: `${lo}-${hi}`, part, n: rs.length, meanMid: rs.reduce((s, r) => s + r.q.mid, 0) / Math.max(1, rs.length), freq: rs.reduce((s, r) => s + r.y, 0) / Math.max(1, rs.length), buyNoEv: b ? +b.mean.toFixed(4) : null, lo: b ? +b.lo.toFixed(4) : null, hi: b ? +b.hi.toFixed(4) : null });
}
const f = opt('out', null); if (f) writeFileSync(f, `${JSON.stringify(out, null, 2)}\n`);
for (const o of out) console.log(o.band.padEnd(10), o.part.padEnd(5), String(o.n).padStart(5), 'mid', o.meanMid.toFixed(3), 'freq', o.freq.toFixed(3), 'buyNO ev', o.buyNoEv, `[${o.lo}, ${o.hi}]`);
