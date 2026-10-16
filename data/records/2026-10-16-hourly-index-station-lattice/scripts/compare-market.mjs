#!/usr/bin/env node
/**
 * The station-lattice model against the market, trade by trade, out of sample.
 *
 * October is replayed in time order. The tracker sees each station's record for a minute when Kalshi received it
 * (received_at_ms; a missing record when the minute became official), and the LAMP bulletins once posted, as the
 * live market maker would. At each trade the model's P(index > strike at the settlement minute) is set beside the
 * traded YES price, and both are scored on the settled outcome (log loss and Brier, per contract). The maker column
 * is what taking the other side of each taker would have earned, only where the model disagreed with the taker's
 * price by at least the margin: an upper bound on a model-informed maker's opportunity (it ignores whether our quote
 * would have been first in the queue).
 *   node scripts/compare-market.mjs --city nyc --series KXTEMPNYCHS --from 2026-10-01 --to 2026-10-17
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createIndexTracker } from '../../../../src/weather-index-lattice.mjs';
import { loadMinutes, loadGuidance, loadCalibrations, localHourOf } from './history.mjs';

const { values } = parseArgs({ options: { city: { type: 'string' }, series: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } });
const here = dirname(fileURLToPath(import.meta.url)), data = join(here, '..', 'data');
const fit = JSON.parse(await readFile(join(here, '..', 'results', `lattice-${values.city}.json`), 'utf8'));
const localHour = localHourOf(values.city);
const from = Date.parse(`${values.from}T00:00:00Z`), to = Date.parse(`${values.to}T00:00:00Z`);

// Each station's record, available when Kalshi received it.
const arrivals = [];
for (const m of await loadMinutes(values.city)) {
  if (m.t < from - 86_400_000 || m.t >= to) continue;
  for (const r of m.records) arrivals.push({ at: r.code === 'ok' ? r.received : m.t + 300_000, t: m.t, r });
}
arrivals.sort((a, b) => a.at - b.at || a.t - b.t);

// Settled markets and their trades.
const markets = new Map();
for (const line of (await readFile(join(data, 'events', `${values.series}.jsonl`), 'utf8')).split('\n').filter(Boolean)) {
  const event = JSON.parse(line);
  for (const m of event.markets) if (m.strike_type === 'greater' && (m.result === 'yes' || m.result === 'no')) markets.set(m.ticker, { strike: Number(m.floor_strike), settle: Date.parse(m.close_time), yes: m.result === 'yes' ? 1 : 0 });
}
const trades = [];
for (const name of (await readdir(join(data, 'trades'))).filter((n) => n.startsWith(values.series + '-'))) {
  for (const line of (await readFile(join(data, 'trades', name), 'utf8')).split('\n').filter(Boolean)) {
    const trade = JSON.parse(line), market = markets.get(trade.ticker), at = Date.parse(trade.created_time);
    if (!market || at < from || at >= to) continue;
    trades.push({ at, market, price: Number(trade.yes_price_dollars), count: Number(trade.count_fp), taker: trade.taker_side });
  }
}
trades.sort((a, b) => a.at - b.at);

const tracker = createIndexTracker({ params: fit.params, climate: fit.climateDriftCPerMinuteByLocalHour, localHour, calibrations: await loadCalibrations(values.city), guidance: await loadGuidance() });
const clip = (p) => Math.min(0.995, Math.max(0.005, p));
const buckets = [5, 10, 20, 30, 45, 61], margins = [0, 1, 2, 3, 5];
const rows = Object.fromEntries(buckets.map((b) => [b, { trades: 0, contracts: 0, modelLog: 0, marketLog: 0, modelBrier: 0, marketBrier: 0, maker: Object.fromEntries(margins.map((m) => [m, { contracts: 0, pnl: 0 }])) }]));
const reliability = {};
let next = 0, cache = new Map();
for (const trade of trades) {
  while (next < arrivals.length && arrivals[next].at <= trade.at) { const a = arrivals[next]; tracker.observe(a.r.id, a.t, a.r); cache = new Map(); next += 1; }
  const { market } = trade;
  if (tracker.lastMinute() === null) continue;
  if (!cache.has(market.settle)) cache.set(market.settle, tracker.distribution(market.settle));
  const distribution = cache.get(market.settle);
  if (!distribution) continue;
  let q = 0; for (const d of distribution) if (d.value > market.strike) q += d.p;
  const lead = (market.settle - trade.at) / 60_000, bucket = buckets.find((b) => lead < b) ?? 61, row = rows[bucket], y = market.yes, w = trade.count;
  const bin = `${lead < 20 ? 'short' : 'long'}:${Math.min(9, Math.floor(q * 10))}`, rel = (reliability[bin] ??= { n: 0, q: 0, y: 0, p: 0 });
  rel.n += w; rel.q += w * q; rel.y += w * y; rel.p += w * trade.price;
  row.trades += 1; row.contracts += w;
  row.modelLog -= w * (y ? Math.log(clip(q)) : Math.log(1 - clip(q))); row.marketLog -= w * (y ? Math.log(clip(trade.price)) : Math.log(1 - clip(trade.price)));
  row.modelBrier += w * (q - y) ** 2; row.marketBrier += w * (trade.price - y) ** 2;
  // A maker on the other side of this taker: sold YES at the price if the taker bought YES, else bought YES.
  for (const m of margins) {
    const edge = trade.taker === 'yes' ? trade.price - q : q - trade.price; // the maker's expected gain per contract under the model
    if (edge * 100 < m) continue;
    const pnl = trade.taker === 'yes' ? trade.price - y : y - trade.price;
    row.maker[m].contracts += w; row.maker[m].pnl += w * pnl;
  }
}
const report = { city: values.city, series: values.series, window: [values.from, values.to], params: fit.params, byLeadMinutes: {},
  reliability: Object.fromEntries(Object.entries(reliability).sort().map(([k, v]) => [k, { contracts: Math.round(v.n), model: v.q / v.n, realized: v.y / v.n, market: v.p / v.n }])) };
for (const [b, r] of Object.entries(rows)) {
  if (!r.contracts) continue;
  report.byLeadMinutes[`<${b}`] = { trades: r.trades, contracts: Math.round(r.contracts), modelLogLoss: r.modelLog / r.contracts, marketLogLoss: r.marketLog / r.contracts, modelBrier: r.modelBrier / r.contracts, marketBrier: r.marketBrier / r.contracts,
    makerAgainstTakers: Object.fromEntries(Object.entries(r.maker).map(([m, v]) => [`margin${m}c`, { contracts: Math.round(v.contracts), pnlUsd: Math.round(v.pnl * 100) / 100, perContractCents: v.contracts ? Math.round((10000 * v.pnl) / v.contracts) / 100 : null }])) };
}
await writeFile(join(here, '..', 'results', `market-${values.city}.json`), JSON.stringify(report, null, 2) + '\n');
for (const [k, v] of Object.entries(report.reliability)) process.stdout.write(`${k} n ${v.contracts} model ${v.model.toFixed(3)} realized ${v.realized.toFixed(3)} market ${v.market.toFixed(3)}\n`);
for (const [lead, r] of Object.entries(report.byLeadMinutes)) process.stdout.write(`lead ${lead.padStart(3)} contracts ${String(r.contracts).padStart(7)} logloss model ${r.modelLogLoss.toFixed(3)} market ${r.marketLogLoss.toFixed(3)} | brier model ${r.modelBrier.toFixed(4)} market ${r.marketBrier.toFixed(4)} | maker@2c ${JSON.stringify(r.makerAgainstTakers.margin2c)}\n`);
