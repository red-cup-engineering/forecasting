#!/usr/bin/env node
/**
 * Month-total probe: Kalshi's monthly precipitation ladders ("total precipitation at <site> in <month> is strictly
 * greater than X inches") against the month-to-date total the site's latest climate report states. Month-to-date
 * precipitation only rises, so a strike under it is a decided YES; this prints each such rung's live book.
 *
 *   node scripts/month-total-probe.mjs
 */
import { readFileSync } from 'node:fs';
import { NWS_API, NWS_USER_AGENT } from '../src/station-observations.mjs';

const RAIN = JSON.parse(readFileSync(new URL('../content/config/rain-markets.json', import.meta.url), 'utf8'));
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2';
const get = async (url, accept = 'application/json') => { const res = await fetch(url, { headers: { 'user-agent': NWS_USER_AGENT, accept } }); if (!res.ok) throw new Error(`${url}: ${res.status}`); return res.json(); };

/** Month-to-date precipitation in inches from a climate report's text, or null ("T" for trace is 0). */
export function monthToDatePrecip(text) {
  const block = text.split(/PRECIPITATION \(IN\)/u)[1] ?? '';
  const m = /^\s*MONTH TO DATE\s+([\d.]+|T|MM)/mu.exec(block);
  return !m || m[1] === 'MM' ? null : m[1] === 'T' ? 0 : Number(m[1]);
}

const series = (await get(`${KALSHI}/series?category=Climate%20and%20Weather`)).series ?? [];
const monthly = series.filter((s) => /^KXRAIN[A-Z]+M$/u.test(s.ticker));
for (const s of monthly) {
  const code = s.ticker.slice('KXRAIN'.length, -1);
  const city = RAIN.cities[code];
  if (!city) { console.log(`${s.ticker}: no climate site for ${code}`); continue; }
  const site = city.cli.replace(/^CLI/u, '');
  let mtd = null, issued = null;
  try {
    const item = (await get(`${NWS_API}/products/types/CLI/locations/${site}`, 'application/ld+json'))['@graph'][0];
    mtd = monthToDatePrecip((await get(`${NWS_API}/products/${item.id}`, 'application/ld+json')).productText); issued = item.issuanceTime;
  } catch (error) { console.log(`${s.ticker}: ${error.message}`); continue; }
  const markets = (await get(`${KALSHI}/markets?series_ticker=${s.ticker}&status=open&limit=200`)).markets ?? [];
  const decided = markets.filter((m) => m.strike_type === 'greater' && Number.isFinite(m.floor_strike) && mtd !== null && mtd > m.floor_strike);
  console.log(`${s.ticker} ${site} month-to-date ${mtd} (report ${issued}) open ${markets.length}, decided ${decided.length}: ${decided.map((m) => `>${m.floor_strike} bid ${m.yes_bid_dollars} ask ${m.yes_ask_dollars}`).join('; ')}`);
}
