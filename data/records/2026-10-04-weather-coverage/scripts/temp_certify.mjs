// Replays the desk's temperature certification (production model: src/temperature-market-model.mjs) over settled markets and hourly candles.
// For each market and each in-window hour: model p from the newest NBS run issued >=2h earlier, candle bid/ask. Emits candidates with p <= 0.02 and a bid >= 2c.
// node temp_certify.mjs  -> data/temp-cert.ndjson
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { priceTemperatureBracket, temperatureSeries, eventDate } from '../../../../src/temperature-market-model.mjs';
const D = new URL('../data/', import.meta.url).pathname;
const mk = readFileSync(D + 'settled-TEMP.ndjson', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const candles = JSON.parse(readFileSync(D + 'candles-TEMP.json', 'utf8'));
// NBS: station -> sorted list of {runtime(ms), rows[]}
const nbs = new Map();
for (const f of readdirSync(D + 'nbs')) {
  const stn = f.replace('.csv', '');
  const lines = readFileSync(D + 'nbs/' + f, 'utf8').trim().split('\n');
  const hdr = lines[0].split(','); const ix = Object.fromEntries(hdr.map((h, i) => [h, i]));
  const runs = new Map();
  for (const l of lines.slice(1)) {
    const c = l.split(','); if (c[ix.txn] === '' || c[ix.txn] === undefined) continue;
    const rt = Date.parse(c[ix.runtime].replace(' ', 'T') + 'Z'); const ft = new Date(Date.parse(c[ix.ftime].replace(' ', 'T') + 'Z')).toISOString();
    if (!runs.has(rt)) runs.set(rt, []);
    runs.get(rt).push({ ftime: ft, txn: Number(c[ix.txn]), xnd: c[ix.xnd] === '' ? NaN : Number(c[ix.xnd]) });
  }
  nbs.set(stn, [...runs.entries()].sort((a, b) => a[0] - b[0]).map(([rt, rows]) => ({ rt, runtime: new Date(rt).toISOString(), rows })));
}
const localParts = (ms, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
const WIN = { high: { from: 12, untilSame: 11 }, low: { from: 12, untilDayBefore: 23 } };   // the desk's windows (weather-desk-policy.json)
const out = [];
for (const m of mk) {
  const series = temperatureSeries(m.series); if (!series) continue;
  const date = eventDate(m.event_ticker); const cs = (candles[m.ticker] ?? []).slice().sort((a, b) => a.end_period_ts - b.end_period_ts);
  const runs = nbs.get(series.station); if (!runs) continue;
  const dayBefore = new Date(Date.parse(date + 'T12:00:00Z') - 86400_000).toISOString().slice(0, 10);
  for (const c of cs) {
    const t = c.end_period_ts * 1000; const lp = localParts(t, series.timeZone); const day = `${lp.year}-${lp.month}-${lp.day}`; const hh = Number(lp.hour);
    const w = WIN[series.kind];
    const inWin = (day === dayBefore && hh >= w.from && (w.untilDayBefore === undefined || hh < w.untilDayBefore)) || (day === date && w.untilSame !== undefined && hh < w.untilSame);
    if (!inWin) continue;
    const bid = Number(c.yes_bid?.close_dollars ?? 0), ask = Number(c.yes_ask?.close_dollars ?? 1);
    if (!(bid >= 0.02 && bid <= 0.10)) continue;
    let run = null; for (const r of runs) { if (r.rt <= t - 2 * 3600_000) run = r; else break; }
    if (!run) continue;
    const guidance = { runtime: run.runtime, stations: { [series.station]: { rows: run.rows, runtime: run.runtime } } };
    const priced = priceTemperatureBracket({ seriesTicker: m.series, eventTicker: m.event_ticker, strikeType: m.strike_type, floorStrike: m.floor_strike, capStrike: m.cap_strike }, { guidance, now: t });
    if (!priced.priced || priced.probability > 0.02) continue;
    out.push({ ticker: m.ticker, series: m.series, kind: series.kind, date, t: new Date(t).toISOString(), p: priced.probability, bid, ask, y: m.result === 'yes' ? 1 : 0, close: m.close_time });
  }
}
writeFileSync(D + 'temp-cert.ndjson', out.map((r) => JSON.stringify(r)).join('\n'));
console.log(out.length, 'candidate rows', new Set(out.map((r) => r.ticker)).size, 'markets');
