#!/usr/bin/env node
/**
 * Climate-report meter: the NWS Daily Climate Reports (CLI) that settle Kalshi's temperature markets, against the
 * station's own readings.
 *
 * For every station in temperature-markets.json it reads the CLI products NWS still lists (about ten days), parses
 * each report's maximum and minimum, and for each final report (the one issued after the climate day ends) compares:
 *   - the afternoon report's maximum (valid as of about 5 PM local) with the final one: can the final fall below it?
 *   - the final whole-degree K with the day's readings (station-observations, inside NWS's retention): K minus the
 *     hourly maximum, and whether K ever falls below the precise floor (or above the precise ceiling for lows).
 *
 *   node scripts/climate-report-meter.mjs [--out file.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { observedExtremes, NWS_API, NWS_USER_AGENT } from '../src/station-observations.mjs';
import { parseClimateReport } from '../src/climate-report.mjs';

const CONFIG = JSON.parse(readFileSync(new URL('../content/config/temperature-markets.json', import.meta.url), 'utf8'));
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const get = async (url) => { const res = await fetch(url, { headers: { 'user-agent': NWS_USER_AGENT, accept: 'application/ld+json' } }); if (!res.ok) throw new Error(`${url}: ${res.status}`); return res.json(); };

const stations = [...new Map(CONFIG.series.map((s) => [s.station, s])).values()];
const rows = [];
for (const s of stations) {
  const location = s.climateReport.replace(/^CLI/u, '');
  let listing;
  try { listing = await get(`${NWS_API}/products/types/CLI/locations/${location}`); } catch (error) { console.error(s.station, error.message); continue; }
  const reports = [];
  for (const item of listing['@graph'] ?? []) {
    try { const text = (await get(`${NWS_API}/products/${item.id}`)).productText; const r = parseClimateReport(text, item.issuanceTime); if (r) reports.push(r); } catch (error) { console.error(s.station, item.id, error.message); }
  }
  for (const date of new Set(reports.map((r) => r.date))) {
    const final = reports.filter((r) => r.date === date && r.final).sort((a, b) => b.issued.localeCompare(a.issued))[0];
    const afternoon = reports.filter((r) => r.date === date && !r.final).sort((a, b) => b.issued.localeCompare(a.issued))[0];
    if (!final) continue;
    let obs = null;
    try { obs = await observedExtremes({ station: s.station, date, timeZone: s.timeZone, now: Date.now() }); } catch {}
    rows.push({
      station: s.station, date, finalMax: final.max, finalMin: final.min, afternoonMax: afternoon?.max ?? null, afternoonMin: afternoon?.min ?? null, afternoonIssued: afternoon?.issued ?? null,
      obsCount: obs?.count ?? 0, obsMax: obs?.maxF ?? null, obsMin: obs?.minF ?? null, floorPrecise: obs?.floorPrecise ?? null, ceilingPrecise: obs?.ceilingPrecise ?? null,
    });
  }
  process.stderr.write(`${s.station} ${reports.length} reports\n`);
}

const withObs = rows.filter((r) => r.obsCount > 200);
const hist = (xs) => xs.reduce((h, x) => ({ ...h, [x]: (h[x] ?? 0) + 1 }), {});
const report = {
  at: new Date().toISOString(), days: rows.length, daysWithFullReadings: withObs.length,
  afternoonMaxAboveFinal: rows.filter((r) => r.afternoonMax !== null && r.afternoonMax > r.finalMax).map((r) => `${r.station} ${r.date}`),
  finalMaxRoseAfterAfternoon: rows.filter((r) => r.afternoonMax !== null && r.finalMax > r.afternoonMax).length,
  afternoonPairs: rows.filter((r) => r.afternoonMax !== null).length,
  highBelowPreciseFloor: withObs.filter((r) => r.floorPrecise !== null && r.finalMax < r.floorPrecise).map((r) => `${r.station} ${r.date} K=${r.finalMax} floor=${r.floorPrecise}`),
  lowAbovePreciseCeiling: withObs.filter((r) => r.ceilingPrecise !== null && r.finalMin > r.ceilingPrecise).map((r) => `${r.station} ${r.date} K=${r.finalMin} ceiling=${r.ceilingPrecise}`),
  highMinusObsMax: hist(withObs.map((r) => Math.round((r.finalMax - r.obsMax) * 2) / 2)),
  lowMinusObsMin: hist(withObs.map((r) => Math.round((r.finalMin - r.obsMin) * 2) / 2)),
};
console.log(JSON.stringify(report, null, 2));
const out = arg('out', null);
if (out) writeFileSync(out, JSON.stringify({ ...report, rows }, null, 2));
