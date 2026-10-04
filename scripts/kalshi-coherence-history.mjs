#!/usr/bin/env node
// Historical coherence over settled daily-temperature ladders: hourly candlestick bid/ask closes,
// per event-hour gluing (ladder) and per station-day-hour gluing (high x low joint).
//   node scripts/kalshi-coherence-history.mjs [--days 14]
// Public data only. Quotes are the last bid/ask seen in each hour (not simultaneous across markets); sizes are
// unknown, so profits are per one contract of each leg with the linear fee 0.07*P*(1-P) (no cent rounding).
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gluingMargin, solveDutchBook } from '../src/coherence.mjs';
import { BASE, getJson } from '../src/coherence-scan.mjs';
import { buildLadder, ladderFamily, stationDayFamily, ladderGroups } from '../src/coherence-families.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const days = Number(opt('days', 14));
const dir = fileURLToPath(new URL('../data/records/2026-10-04-kalshi-coherence/data/', import.meta.url));
mkdirSync(dir, { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

const allSeries = (await getJson(`${BASE}/series`)).series.filter((s) => /^KX(HIGH|LOWT)/u.test(s.ticker) && /temperature/iu.test(s.title) && s.frequency === 'daily');
console.error('series', allSeries.length);
const minClose = Math.floor(Date.now() / 1000) - days * 86400;
const markets = [];
for (const s of allSeries) {
  let cursor = '';
  for (let p = 0; p < 10; p += 1) {
    const d = await getJson(`${BASE}/markets?series_ticker=${s.ticker}&status=settled&limit=1000&min_close_ts=${minClose}${cursor ? `&cursor=${cursor}` : ''}`);
    for (const m of d.markets) markets.push({ ticker: m.ticker, event_ticker: m.event_ticker, series: s.ticker, strike_type: m.strike_type, floor_strike: m.floor_strike, cap_strike: m.cap_strike, result: m.result, open: Date.parse(m.open_time) / 1000, close: Date.parse(m.close_time) / 1000, rules_primary: m.rules_primary, theta: 0.07 * (num(s.fee_multiplier) ?? 1) });
    cursor = d.cursor; if (!cursor || !d.markets.length) break;
    await pause(60);
  }
}
console.error('markets', markets.length);
const candles = new Map();
const byDate = new Map();
for (const m of markets) { const k = /-(\d\d[A-Z]{3}\d\d)$/u.exec(m.event_ticker)?.[1] ?? '?'; if (!byDate.has(k)) byDate.set(k, []); byDate.get(k).push(m); }
for (const group of byDate.values()) {
  for (let i = 0; i < group.length; i += 50) {
    const ch = group.slice(i, i + 50);
    const st = Math.min(...ch.map((m) => m.open)); const en = Math.max(...ch.map((m) => m.close));
    try {
      const r = await getJson(`${BASE}/markets/candlesticks?market_tickers=${ch.map((m) => m.ticker).join(',')}&start_ts=${st}&end_ts=${en}&period_interval=60`);
      for (const mk of r.markets ?? []) candles.set(mk.market_ticker, mk.candlesticks);
    } catch (e) { console.error('candle batch failed', String(e).slice(0, 80)); }
    await pause(80);
  }
}
const byEvent = new Map();
for (const m of markets) { if (!byEvent.has(m.event_ticker)) byEvent.set(m.event_ticker, []); byEvent.get(m.event_ticker).push(m); }

const stationOf = (m) => /\((CLI[A-Z0-9]+)\)/u.exec(m.rules_primary ?? '')?.[1];
const ladders = new Map();
for (const [et, ms] of byEvent) {
  const ev = { event_ticker: et, series_ticker: ms[0].series, markets: ms };
  const g = ladderGroups(ev);
  if (g.length !== 1) continue;
  const l = buildLadder(ev, g[0][0], g[0][1], { fee_multiplier: ms[0].theta / 0.07 });
  if (l.skipped) continue;
  l.station = stationOf(ms[0]); l.extreme = /maximum/u.test(ms[0].rules_primary ?? '') ? 'high' : 'low';
  l.dateTok = /-(\d\d[A-Z]{3}\d\d)$/u.exec(et)?.[1];
  ladders.set(et, l);
}
const pairs = new Map();
for (const l of ladders.values()) { const k = `${l.station}|${l.dateTok}`; if (!pairs.has(k)) pairs.set(k, {}); pairs.get(k)[l.extreme] = l; }

const hourly = (ticker) => { const m = new Map(); for (const c of candles.get(ticker) ?? []) m.set(c.end_period_ts, c); return m; };
const quote = (c) => {
  const bid = num(c?.yes_bid?.close_dollars); const ask = num(c?.yes_ask?.close_dollars);
  return { bids: bid && bid > 0 ? [{ price: bid, size: 1 }] : [], asks: ask && ask > 0 && ask < 1 ? [{ price: ask, size: 1 }] : [] };
};
const mk = () => ({ fam: 0, hours: 0, raw: 0, net: 0, netSum: 0, netMax: 0, netVals: [], runs: [] });
const stats = { ladder: mk(), stationDay: mk() };
const examples = [];
function scan(kind, fam, ladderSet, bucket) {
  const hs = ladderSet.flatMap((l) => l.quotes.map((q) => hourly(q.id)));
  const times = [...hs[0].keys()].filter((t) => hs.every((h) => h.has(t))).sort((a, b) => a - b);
  bucket.fam += 1;
  let run = 0;
  for (const t of times) {
    const f = { ...fam, markets: fam.markets.map((m, i) => ({ ...m, ...quote(hs[i].get(t)) })) };
    bucket.hours += 1;
    const margin = gluingMargin(f);
    if (margin !== null && margin < -1e-9) {
      bucket.raw += 1;
      const net = solveDutchBook(f, { fees: true, capUnit: true });
      if (net.profit > 0.0005) {
        bucket.net += 1; bucket.netSum += net.profit; bucket.netMax = Math.max(bucket.netMax, net.profit); bucket.netVals.push(net.profit);
        run += 1;
        if (net.profit > 0.01 && examples.length < 40) examples.push({ kind, family: fam.id, t: new Date(t * 1000).toISOString(), margin, unitNet: net.profit, legs: net.legs.map((x) => [f.markets[x.leg.market].id, x.leg.side, x.leg.price, x.qty]) });
        continue;
      }
    }
    if (run) { bucket.runs.push(run); run = 0; }
  }
  if (run) bucket.runs.push(run);
}
for (const l of ladders.values()) scan('ladder', ladderFamily(l), [l], stats.ladder);
for (const p of pairs.values()) if (p.high && p.low) scan('stationDay', stationDayFamily(p.high, p.low), [p.high, p.low], stats.stationDay);
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const out = { days, markets: markets.length, events: byEvent.size, ladders: ladders.size, stationDays: [...pairs.values()].filter((p) => p.high && p.low).length, stats: {}, examples };
for (const [k, b] of Object.entries(stats)) out.stats[k] = { families: b.fam, familyHours: b.hours, rawViolationHours: b.raw, netViolationHours: b.net, netShare: b.net / Math.max(1, b.hours), netPerUnitMean: b.net ? b.netSum / b.net : 0, netPerUnitMedian: q(b.netVals, 0.5), netPerUnitP90: q(b.netVals, 0.9), netPerUnitMax: b.netMax, runs: b.runs.length, runHoursMedian: q(b.runs, 0.5), runHoursMax: Math.max(0, ...b.runs) };
writeFileSync(`${dir}history-${days}d.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, examples: out.examples.length }, null, 1));
