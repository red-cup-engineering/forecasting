#!/usr/bin/env node
/**
 * Dead-bracket meter: how much Kalshi daily-temperature volume trades on brackets the station's own
 * observations have already ruled out, and which observation rule is safe to call a bracket dead.
 *
 * For every settled KXHIGH / KXLOW event whose climate day is inside NWS's observation retention (about
 * seven days), it reads the station's observations (station-observations.mjs), the settled bracket (the
 * report's whole-degree value K), and every trade on every bracket of the event. Per candidate rule:
 *   - violations: brackets the rule called dead that settled YES (the rule's risk);
 *   - opportunity: contracts printed after the rule called a bracket dead, at YES price p, i.e. what a
 *     seller of YES (a buyer of NO at 1 - p) could have filled, gross p per contract and net of the taker
 *     fee at a 100-lot.
 * It also prints K minus the observed hourly extreme, the gap every rule rests on.
 *
 *   node scripts/dead-bracket-meter.mjs [--days 6] [--series KXHIGHTTTN,...] [--out file.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { observedExtremes, preciseBounds } from '../src/station-observations.mjs';
import { feePerContract } from '../src/fees.mjs';

const API = 'https://api.elections.kalshi.com/trade-api/v2';
const CONFIG = JSON.parse(readFileSync(new URL('../content/config/temperature-markets.json', import.meta.url), 'utf8'));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const DAYS = Number(arg('days', 6));
const LAGS = [0, 2, 5, 10, 15, 30];
const ONLY = arg('series', null)?.split(',');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const eventDate = (t) => { const m = /-(\d{2})([A-Z]{3})(\d{2})$/u.exec(t); return m ? `20${m[1]}-${MONTHS[m[2]]}-${m[3]}` : null; };

async function get(path) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await pause(130);
    const res = await fetch(`${API}${path}`, { headers: { accept: 'application/json' } });
    if (res.status === 429) { await pause(1000 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }
  throw new Error(`${path}: rate limited`);
}
async function trades(ticker) {
  const out = []; let cursor = '';
  do {
    const page = await get(`/markets/trades?ticker=${ticker}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...page.trades); cursor = page.cursor;
  } while (cursor);
  return out;
}

// Rules for "the report's extreme is at least L" from the running observed maximum M (mirror for lows).
const RULES = {
  'floor(M)-1': (m) => Math.floor(m) - 1,
  'floor(M)': (m) => Math.floor(m),
  'round(M)': (m) => Math.round(m),
  precise: null,
};
const bounds = (m) => m.strike_type === 'less' ? [-Infinity, m.cap_strike - 0.5] : m.strike_type === 'greater' ? [m.floor_strike + 0.5, Infinity] : [m.floor_strike - 0.5, m.cap_strike + 0.5];

const cutoff = Date.now() - DAYS * 86400000;
const rows = [], gaps = [];
for (const series of CONFIG.series.filter((s) => !ONLY || ONLY.includes(s.seriesTicker))) {
  const { events } = await get(`/events?series_ticker=${series.seriesTicker}&status=settled&with_nested_markets=true&limit=${DAYS + 3}`);
  for (const event of events ?? []) {
    const date = eventDate(event.event_ticker);
    if (!date || Date.parse(`${date}T12:00:00Z`) < cutoff) continue;
    let obs;
    try { obs = await observedExtremes({ station: series.station, date, timeZone: series.timeZone, now: Date.now() }); } catch (e) { console.error(series.station, date, e.message); continue; }
    if (!obs.count) continue;
    const high = series.kind === 'high';
    const markets = event.markets.filter((m) => ['yes', 'no'].includes(m.result));
    const won = markets.find((m) => m.result === 'yes');
    if (!won) continue;
    const [wlo, whi] = bounds(won);
    const observed = high ? obs.maxF : obs.minF;
    // K lies in (wlo, whi); record the integer interval against the observed extreme.
    gaps.push({ series: series.seriesTicker, date, observed, kLow: Math.ceil(wlo), kHigh: Number.isFinite(whi) ? Math.floor(whi) : null, kind: series.kind });
    for (const m of markets) {
      const [lo, hi] = bounds(m);
      const tape = (await trades(m.ticker)).map((t) => ({ at: Date.parse(t.created_time), p: Number(t.yes_price_dollars), n: Number(t.count_fp), takerYes: t.taker_side === 'yes' }));
      for (const [rule, f] of Object.entries(RULES)) {
        // The first reading after which the rule calls this bracket impossible.
        let deadAt = null, running = high ? -Infinity : Infinity;
        for (const [i, r] of obs.readings.entries()) {
          running = high ? Math.max(running, r.temperatureF) : Math.min(running, r.temperatureF);
          let bound;
          if (rule === 'precise') { const pb = preciseBounds(obs.readings.slice(0, i + 1), obs.synoptic.filter((s) => s.at <= r.at)); bound = high ? pb.floorPrecise : pb.ceilingPrecise; }
          else bound = high ? f(running) : -f(-running);
          if (high ? hi <= bound : lo >= bound) { deadAt = Date.parse(r.at); break; }
        }
        if (deadAt === null) continue;
        // Readings reach the API some minutes after they are taken: the opportunity by how fast we act after the reading.
        const byLag = Object.fromEntries(LAGS.map((lag) => { const w = tape.filter((t) => t.at >= deadAt + lag * 60000);
          return [lag, { contracts: w.reduce((s, t) => s + t.n, 0), net: w.reduce((s, t) => s + t.n * Math.max(0, t.p - feePerContract(1 - t.p)), 0), over1c: w.filter((t) => t.p > 0.015).reduce((s, t) => s + t.n, 0) }]; }));
        const after = tape.filter((t) => t.at >= deadAt + 15 * 60000);
        const contracts = after.reduce((s, t) => s + t.n, 0);
        const gross = after.reduce((s, t) => s + t.n * t.p, 0);
        const net = after.reduce((s, t) => s + t.n * Math.max(0, t.p - feePerContract(1 - t.p)), 0);
        rows.push({ byLag, series: series.seriesTicker, date, ticker: m.ticker, rule, result: m.result, deadAt: new Date(deadAt).toISOString(), contracts, gross, net, trades: after.length, maxP: Math.max(0, ...after.map((t) => t.p)) });
      }
    }
    process.stderr.write(`${series.seriesTicker} ${date} obs ${observed.toFixed(1)} K ${gaps.at(-1).kLow}..${gaps.at(-1).kHigh}\n`);
  }
}

const summary = {};
for (const rule of Object.keys(RULES)) {
  const r = rows.filter((x) => x.rule === rule);
  const days = new Set(r.map((x) => x.date)).size;
  summary[rule] = {
    deadBrackets: r.length, violations: r.filter((x) => x.result === 'yes').map((x) => x.ticker),
    contracts: Math.round(r.reduce((s, x) => s + x.contracts, 0)),
    grossUsd: +r.reduce((s, x) => s + x.gross, 0).toFixed(2), netUsd: +r.filter((x) => x.result === 'no').reduce((s, x) => s + x.net, 0).toFixed(2),
    byLag: Object.fromEntries(LAGS.map((lag) => { const ok = r.filter((x) => x.result === 'no'); return [lag, { netUsd: +ok.reduce((s, x) => s + x.byLag[lag].net, 0).toFixed(2), contractsOver1c: Math.round(ok.reduce((s, x) => s + x.byLag[lag].over1c, 0)) }]; })),
    days, netUsdPerDay: +(r.filter((x) => x.result === 'no').reduce((s, x) => s + x.net, 0) / Math.max(1, days)).toFixed(2),
  };
}
const gapHist = {};
for (const g of gaps) { const d = g.kind === 'high' ? g.kLow - Math.floor(g.observed) : Math.floor(g.observed) - (g.kHigh ?? g.kLow); gapHist[d] = (gapHist[d] ?? 0) + 1; }
const report = { at: new Date().toISOString(), days: DAYS, events: gaps.length, gapHistogram: gapHist, summary };
console.log(JSON.stringify(report, null, 2));
const out = arg('out', null);
if (out) writeFileSync(out, JSON.stringify({ ...report, rows, gaps }, null, 2));
